import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s, b) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }
const SOL_RPC = "https://api.uniblock.dev/uni/v1/json-rpc?chainId=solana";
const Z = 2.5;
const MIN_DAILY_TX = 100;
const SUPPRESS_RECENT_DAYS = 3;
const SLOT_SECONDS = 0.4; // ~2.5 slots/sec on Solana mainnet
const SLOTS_PER_DAY = Math.round(86400 / SLOT_SECONDS); // ~216,000

async function solRpc(apiKey: string, method: string, params: unknown[]) {
  const r = await fetch(SOL_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`Sol ${method} HTTP ${r.status}: ${t.slice(0, 200)}`); }
  const j = await r.json();
  if (j.error) throw new Error(`Sol ${method} error: ${JSON.stringify(j.error).slice(0, 250)}`);
  return j.result;
}
function mean(arr: number[]) { return arr.length === 0 ? 0 : arr.reduce((s, x) => s + x, 0) / arr.length; }
function stdev(arr: number[], mu: number) { if (arr.length < 2) return 0; const v = arr.reduce((s, x) => s + (x - mu) ** 2, 0) / (arr.length - 1); return Math.sqrt(v); }

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
  let body: { address_id?: string; backfill_days?: number } = {};
  try { body = await req.json().catch(() => ({})); } catch {}
  const backfillDays = Math.min(Math.max(body.backfill_days || 30, 1), 30);
  if (!body.address_id) return json(400, { error: "address_id required (one Solana program per invocation)" });

  const { data: a, error } = await admin.from("chain_addresses").select("id,company_slug,address,label").eq("id", body.address_id).eq("chain", "solana").maybeSingle();
  if (error || !a) return json(404, { error: "chain_address not found or not solana" });

  // Strategy: getSignaturesForAddress with `until` cursor, paginating until we cover ~30d.
  // Each call returns up to 1000 signatures sorted newest-first.
  // We stop when we've gone past `backfillDays * 86400` seconds ago.
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoffSec = nowSec - backfillDays * 86400;
  const dailyCounts = new Map<string, number>();

  let before: string | undefined = undefined;
  let pagesPulled = 0;
  const MAX_PAGES = 30; // 30 * 1000 = up to 30K txs over 30 days, sufficient for most programs
  while (pagesPulled < MAX_PAGES) {
    pagesPulled++;
    let sigs: Array<{ signature: string; slot: number; blockTime?: number | null; err: unknown }>;
    try {
      sigs = await solRpc(uniKey, "getSignaturesForAddress", [a.address, { limit: 1000, before }]) as typeof sigs;
    } catch (e) { return json(502, { error: "getSignaturesForAddress failed", details: String(e), pagesPulled }); }
    if (!sigs || sigs.length === 0) break;
    let oldestSeen = nowSec;
    for (const s of sigs) {
      if (s.err) continue;
      const ts = s.blockTime || 0;
      if (ts > 0 && ts < oldestSeen) oldestSeen = ts;
      if (ts < cutoffSec) continue;
      const dt = new Date(ts * 1000).toISOString().slice(0, 10);
      dailyCounts.set(dt, (dailyCounts.get(dt) || 0) + 1);
    }
    before = sigs[sigs.length - 1].signature;
    if (oldestSeen < cutoffSec) break;
    if (sigs.length < 1000) break; // last page
  }

  // Generate full 30-day date series (fill zeros for missing days)
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const dailySeries: Array<{ date: string; count: number }> = [];
  for (let d = backfillDays - 1; d >= 0; d--) {
    const dt = new Date(today.getTime() - d * 86400000);
    const dateStr = dt.toISOString().slice(0, 10);
    dailySeries.push({ date: dateStr, count: dailyCounts.get(dateStr) || 0 });
  }

  // Upsert daily counts
  for (const { date, count } of dailySeries) {
    await admin.from("protocol_metrics").upsert({
      company_slug: a.company_slug, defillama_slug: null, date,
      write_tx_count: count, tx_count: count, source: "onchain:solana",
    }, { onConflict: "company_slug,date,source" });
  }

  // Anomaly detection on the series
  let anomalies = 0, suppressedLow = 0, suppressedPersistent = 0;
  let lastFire: { date: number; z: number } | null = null;
  for (let i = 7; i < dailySeries.length; i++) {
    const target = dailySeries[i];
    const window = dailySeries.slice(Math.max(0, i - 30), i).map((x) => x.count).filter((c) => c > 0);
    if (window.length < 7) continue;
    const mu = mean(window);
    if (mu < MIN_DAILY_TX) { suppressedLow++; continue; }
    const sigma = stdev(window, mu);
    if (sigma <= 0) continue;
    const z = (target.count - mu) / sigma;
    if (Math.abs(z) < Z) continue;
    if (lastFire && (new Date(target.date).getTime() - lastFire.date) <= SUPPRESS_RECENT_DAYS * 86400000 && Math.sign(lastFire.z) === Math.sign(z)) { suppressedPersistent++; continue; }
    const dir = z > 0 ? "up" : "down";
    const factor = mu > 0 ? (target.count / mu).toFixed(1) : "?";
    const { error: insErr } = await admin.from("metric_anomalies").upsert({
      company_slug: a.company_slug, chain: "solana", metric_kind: "write_tx_count", audience: "both", date: target.date,
      value: target.count, mean_30d: mu, stdev_30d: sigma, z_score: z, direction: dir,
      detail: `${a.company_slug} on solana (${a.label || "program"}): ${target.count.toLocaleString()} signatures on ${target.date} vs 30d avg ${Math.round(mu).toLocaleString()} (${factor}x, z=${z.toFixed(2)}).`,
    }, { onConflict: "company_slug,chain,metric_kind,date" });
    if (!insErr) { anomalies++; lastFire = { date: new Date(target.date).getTime(), z }; }
  }

  return json(200, { ok: true, address_id: body.address_id, company_slug: a.company_slug,
    backfill_days: backfillDays, pages_pulled: pagesPulled, days_with_data: Array.from(dailyCounts.values()).filter((c) => c > 0).length,
    sample_counts: dailySeries.slice(-7), anomalies_inserted: anomalies,
    suppressed_low_baseline: suppressedLow, suppressed_persistent: suppressedPersistent });
});
