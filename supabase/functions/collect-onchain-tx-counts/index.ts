import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s, b) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }
const UNIBLOCK_RPC = "https://api.uniblock.dev/uni/v1/json-rpc";
const Z = 2.5;
const MIN_DAILY_TX = 50;
const SUPPRESS_RECENT_DAYS = 3;
const CHAIN_ID = { ethereum: 1, optimism: 10, bsc: 56, polygon: 137, base: 8453, arbitrum: 42161, avalanche: 43114, fantom: 250, gnosis: 100, linea: 59144, scroll: 534352, zksync: 324, blast: 81457, mantle: 5000, celo: 42220, hyperliquid: 999, berachain: 80094, sonic: 146, sei: 1329 };
const BLOCKS_PER_DAY = { ethereum: 7200, optimism: 43200, bsc: 28800, polygon: 43200, base: 43200, arbitrum: 345600, avalanche: 43200, fantom: 28800, gnosis: 17280, linea: 28800, scroll: 28800, zksync: 86400, blast: 43200, mantle: 172800, celo: 17280, hyperliquid: 86400, berachain: 17280, sonic: 86400, sei: 86400 };
const MAX_BLOCKS_PER_GETLOGS = 9500;
function toHex(n) { return "0x" + BigInt(n).toString(16); }
function fromHex(s) { if (!s) return 0; return Number(BigInt(s)); }
async function uniRpc(chain, method, params, apiKey) {
  const chainId = CHAIN_ID[chain.toLowerCase()];
  if (!chainId) throw new Error(`Unsupported chain '${chain}'`);
  const r = await fetch(`${UNIBLOCK_RPC}?chainId=${chainId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`Uniblock ${chain}.${method} HTTP ${r.status}: ${t.slice(0, 200)}`); }
  const j = await r.json();
  if (j.error) throw new Error(`Uniblock ${chain}.${method} error: ${JSON.stringify(j.error).slice(0, 250)}`);
  return j.result;
}
function mean(arr) { return arr.length === 0 ? 0 : arr.reduce((s, x) => s + x, 0) / arr.length; }
function stdev(arr, mu) { if (arr.length < 2) return 0; const v = arr.reduce((s, x) => s + (x - mu) ** 2, 0) / (arr.length - 1); return Math.sqrt(v); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const uniKey = Deno.env.get("UNIBLOCK_API_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Missing supabase env" });
  if (!uniKey) return json(500, { error: "UNIBLOCK_API_KEY not set" });
  const cronKey = req.headers.get("x-cron-key") || "";
  const authHeader = req.headers.get("Authorization") || "";
  if (cronKey !== CRON_KEY) {
    if (!authHeader) return json(401, { error: "Unauthorized" });
    const u = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data } = await u.auth.getUser();
    if (!data?.user) return json(401, { error: "Unauthorized" });
  }
  const admin = createClient(supabaseUrl, serviceKey);
  let body = {};
  try { body = await req.json().catch(() => ({})); } catch {}
  const backfillDays = Math.min(Math.max(body.backfill_days || 30, 1), 60);
  const addressId = body.address_id;
  if (!addressId) return json(400, { error: "address_id required (one address per invocation to stay under memory limits)" });

  const { data: a, error } = await admin.from("chain_addresses").select("id,company_slug,chain,address,kind,label").eq("id", addressId).maybeSingle();
  if (error || !a) return json(404, { error: "chain_address not found" });
  const chain = a.chain.toLowerCase();
  const blocksPerDay = BLOCKS_PER_DAY[chain] || 7200;
  let currentBlock;
  try { currentBlock = fromHex(await uniRpc(chain, "eth_blockNumber", [], uniKey)); }
  catch (e) { return json(502, { error: "eth_blockNumber failed", details: String(e) }); }

  // Process day-by-day so memory stays bounded
  const dailyCounts = new Map();
  for (let dayOffset = backfillDays - 1; dayOffset >= 0; dayOffset--) {
    const dayEnd = currentBlock - dayOffset * blocksPerDay;
    const dayStart = Math.max(0, dayEnd - blocksPerDay + 1);
    if (dayStart > dayEnd) continue;

    let cursor = dayStart;
    let txs = new Set();
    while (cursor <= dayEnd) {
      const end = Math.min(dayEnd, cursor + MAX_BLOCKS_PER_GETLOGS - 1);
      try {
        const logs = await uniRpc(chain, "eth_getLogs", [{ address: a.address, fromBlock: toHex(cursor), toBlock: toHex(end) }], uniKey);
        for (const log of (logs || [])) txs.add(log.transactionHash);
      } catch (e) {
        const msg = String(e);
        if (/more than|too many|exceeds|range/i.test(msg) && end - cursor > 200) {
          // Halve the window and retry inline
          const mid = Math.floor((cursor + end) / 2);
          try {
            const part1 = await uniRpc(chain, "eth_getLogs", [{ address: a.address, fromBlock: toHex(cursor), toBlock: toHex(mid) }], uniKey);
            for (const log of (part1 || [])) txs.add(log.transactionHash);
            const part2 = await uniRpc(chain, "eth_getLogs", [{ address: a.address, fromBlock: toHex(mid + 1), toBlock: toHex(end) }], uniKey);
            for (const log of (part2 || [])) txs.add(log.transactionHash);
          } catch (e2) { return json(502, { error: "eth_getLogs fallback failed", details: String(e2) }); }
        } else {
          return json(502, { error: "eth_getLogs failed", details: msg, day_offset: dayOffset, range: [cursor, end] });
        }
      }
      cursor = end + 1;
    }
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const date = new Date(today.getTime() - dayOffset * 86400000).toISOString().slice(0, 10);
    dailyCounts.set(date, txs.size);
    txs.clear();
  }

  // Upsert daily counts
  const sortedDates = Array.from(dailyCounts.keys()).sort();
  for (const d of sortedDates) {
    const count = dailyCounts.get(d);
    await admin.from("protocol_metrics").upsert({
      company_slug: a.company_slug, defillama_slug: null, date: d,
      write_tx_count: count, tx_count: count, source: `onchain:${chain}`,
    }, { onConflict: "company_slug,date,source" });
  }

  // Anomaly detection
  let anomaliesInserted = 0;
  let suppressedLow = 0;
  let suppressedPersistent = 0;
  let lastFire = null;
  for (let i = 7; i < sortedDates.length; i++) {
    const td = sortedDates[i];
    const tdCount = dailyCounts.get(td) || 0;
    const window = sortedDates.slice(Math.max(0, i - 30), i).map((d) => dailyCounts.get(d) || 0).filter((c) => c > 0);
    if (window.length < 7) continue;
    const mu = mean(window);
    if (mu < MIN_DAILY_TX) { suppressedLow++; continue; }
    const sigma = stdev(window, mu);
    if (sigma <= 0) continue;
    const z = (tdCount - mu) / sigma;
    if (Math.abs(z) < Z) continue;
    if (lastFire && (new Date(td).getTime() - lastFire.date) <= SUPPRESS_RECENT_DAYS * 86400000 && Math.sign(lastFire.z) === Math.sign(z)) { suppressedPersistent++; continue; }
    const dir = z > 0 ? "up" : "down";
    const factor = mu > 0 ? (tdCount / mu).toFixed(1) : "?";
    const { error: insErr } = await admin.from("metric_anomalies").upsert({
      company_slug: a.company_slug, chain, metric_kind: "write_tx_count", audience: "both", date: td,
      value: tdCount, mean_30d: mu, stdev_30d: sigma, z_score: z, direction: dir,
      detail: `${a.company_slug} on ${chain} (${a.label || a.kind}): ${tdCount.toLocaleString()} write txs on ${td} vs 30d avg ${Math.round(mu).toLocaleString()} (${factor}x, z=${z.toFixed(2)}).`,
    }, { onConflict: "company_slug,chain,metric_kind,date" });
    if (!insErr) { anomaliesInserted++; lastFire = { date: new Date(td).getTime(), z }; }
  }

  return json(200, {
    ok: true,
    address_id: addressId,
    company_slug: a.company_slug,
    chain,
    address: a.address,
    backfill_days: backfillDays,
    days_with_data: dailyCounts.size,
    sample_counts: Array.from(dailyCounts.entries()).slice(-7),
    anomalies_inserted: anomaliesInserted,
    suppressed_low_baseline: suppressedLow,
    suppressed_persistent: suppressedPersistent,
  });
});
