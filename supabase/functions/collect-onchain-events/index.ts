import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(status: number, body: unknown) { return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } }); }

const UNIBLOCK_RPC = "https://api.uniblock.dev/uni/v1/json-rpc";
// chain name (chain_addresses.chain) → EVM chainId (numeric only; non-EVM gets its own adapter)
const CHAIN_ID: Record<string, number> = {
  ethereum: 1, eth: 1, mainnet: 1,
  optimism: 10, op: 10,
  bsc: 56, binance: 56, bnb: 56,
  polygon: 137, matic: 137,
  base: 8453,
  arbitrum: 42161, "arbitrum-one": 42161, arb: 42161,
  avalanche: 43114, avax: 43114,
  fantom: 250, ftm: 250,
  gnosis: 100, xdai: 100,
  linea: 59144,
  scroll: 534352,
  zksync: 324, "zksync-era": 324,
  blast: 81457,
  mantle: 5000,
  celo: 42220,
  metis: 1088,
  mode: 34443,
  // === Added 2026-05-16 ===
  hyperliquid: 999, "hyperevm": 999, "hl": 999,    // HyperEVM L1 mainnet
  berachain: 80094, bera: 80094,
  sonic: 146,
  unichain: 130,
  ink: 57073,
  taiko: 167000,
  manta: 169,
  abstract: 2741,
  cronos: 25,
  kava: 2222,
  rootstock: 30, rsk: 30,
  bob: 60808,
  zircuit: 48900,
  swellchain: 1923,
  morph: 2818,
  worldchain: 480, world: 480,
  sei: 1329,                                       // Sei EVM (NOT Cosmos endpoint)
  monad: 41454,                                    // Monad testnet (mainnet ID may differ at launch)
};

const TOPICS = {
  Upgraded: "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b",
  Paused: "0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258",
  Unpaused: "0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa",
  AdminChanged: "0x7e644d79422f17c01e4894b5f4f588d331ebfa28653d42ae832dc59e38c9798f",
  OwnershipTransferred: "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0",
  SafeAddedOwner: "0x9465fa0c962cc76958e6373a993326400c1c94f8be2fe3a952adfa7f60b2ea26",
  SafeRemovedOwner: "0xf8d49fc529812e9a7c5c50e69c20f0dccc0db8fa95c98bc58cc9a4f1c1299eaf",
};
const ALL_TOPICS = Object.values(TOPICS);
const TOPIC_NAMES: Record<string, string> = Object.fromEntries(Object.entries(TOPICS).map(([k, v]) => [v, k]));

function signalKindFor(topicHash: string): { kind: string; subtype: string; priority: number } {
  const name = TOPIC_NAMES[topicHash] || "unknown";
  if (name === "Upgraded") return { kind: "onchain-upgrade", subtype: "proxy-upgrade", priority: 90 };
  if (name === "Paused") return { kind: "onchain-pause", subtype: "paused", priority: 95 };
  if (name === "Unpaused") return { kind: "onchain-pause", subtype: "unpaused", priority: 75 };
  if (name === "AdminChanged") return { kind: "onchain-admin", subtype: "proxy-admin-change", priority: 80 };
  if (name === "OwnershipTransferred") return { kind: "onchain-admin", subtype: "ownership-transferred", priority: 70 };
  if (name === "SafeAddedOwner") return { kind: "onchain-multisig", subtype: "signer-added", priority: 75 };
  if (name === "SafeRemovedOwner") return { kind: "onchain-multisig", subtype: "signer-removed", priority: 85 };
  return { kind: "onchain-other", subtype: name, priority: 50 };
}

function toHex(n: number | bigint): string { return "0x" + BigInt(n).toString(16); }
function fromHex(s: string | null | undefined): number { if (!s) return 0; return Number(BigInt(s)); }

const MAX_LOOKBACK_BLOCKS = 5000;
const INITIAL_LOOKBACK_BLOCKS = 5000;

async function uniblockRpc<T>(chainName: string, method: string, params: unknown[], apiKey: string): Promise<T> {
  const chainId = CHAIN_ID[chainName.toLowerCase()];
  if (!chainId) throw new Error(`Unsupported chain '${chainName}' — add to CHAIN_ID map`);
  const url = `${UNIBLOCK_RPC}?chainId=${chainId}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Uniblock ${chainName}(${chainId}).${method} HTTP ${r.status}: ${txt.slice(0, 250)}`);
  }
  const j = await r.json();
  if (j.error) throw new Error(`Uniblock ${chainName}.${method} error: ${JSON.stringify(j.error).slice(0, 300)}`);
  return j.result as T;
}

type LogRow = {
  address: string; topics: string[]; data: string;
  blockNumber: string; transactionHash: string; logIndex: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const uniblockKey = Deno.env.get("UNIBLOCK_API_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Missing Supabase env" });
  if (!uniblockKey) return json(500, { error: "UNIBLOCK_API_KEY not set" });

  const cronKey = req.headers.get("x-cron-key") || "";
  const authHeader = req.headers.get("Authorization") || "";
  const isCron = cronKey === CRON_KEY;
  if (!isCron) {
    if (!authHeader) return json(401, { error: "Unauthorized" });
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json(401, { error: "Unauthorized" });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  let body: { company_slugs?: string[]; chains?: string[]; limit?: number; dry_run?: boolean } = {};
  try { body = await req.json().catch(() => ({})); } catch { /* */ }

  let q = admin.from("chain_addresses").select("id,company_slug,chain,address,kind,last_seen_block,label").eq("enabled", true);
  if (body.company_slugs && body.company_slugs.length > 0) q = q.in("company_slug", body.company_slugs);
  if (body.chains && body.chains.length > 0) q = q.in("chain", body.chains);
  q = q.limit(body.limit ?? 200);
  const { data: addrs, error: addrErr } = await q;
  if (addrErr) return json(500, { error: "chain_addresses query failed", details: addrErr.message });
  if (!addrs || addrs.length === 0) return json(200, { ok: true, scanned: 0, reason: "no_enabled_addresses" });

  // Group by chain; one block-height call per chain. Batch all addresses for that chain into a single eth_getLogs.
  const byChain = new Map<string, typeof addrs>();
  for (const a of addrs) {
    if (!byChain.has(a.chain)) byChain.set(a.chain, [] as typeof addrs);
    byChain.get(a.chain)!.push(a);
  }
  const slugSet = new Set<string>(addrs.map((a) => a.company_slug));
  const { data: companies } = await admin.from("companies").select("slug,name").in("slug", Array.from(slugSet));
  const nameBySlug = new Map((companies || []).map((c) => [c.slug, c.name]));

  const summary = { scanned_addresses: 0, chains_scanned: 0, logs_found: 0, signals_inserted: 0, errors: [] as Array<{ chain: string; address?: string; err: string }>, rpc_errors: 0 };

  for (const [chain, list] of byChain.entries()) {
    summary.chains_scanned++;
    let toBlockNum: number;
    try {
      const cur = await uniblockRpc<string>(chain, "eth_blockNumber", [], uniblockKey);
      toBlockNum = fromHex(cur);
    } catch (e) {
      summary.errors.push({ chain, err: String(e).slice(0, 250) });
      summary.rpc_errors++;
      continue;
    }

    // Bucket addresses by their from-block so we can batch addresses with same last_seen_block.
    // Simpler: per-address eth_getLogs preserves per-address last_seen_block tracking. Keep as-is.
    for (const a of list) {
      summary.scanned_addresses++;
      const fromBlockNum = a.last_seen_block
        ? Math.max(Number(a.last_seen_block) + 1, toBlockNum - MAX_LOOKBACK_BLOCKS)
        : Math.max(0, toBlockNum - INITIAL_LOOKBACK_BLOCKS);
      if (fromBlockNum > toBlockNum) continue;

      let logs: LogRow[] = [];
      try {
        logs = await uniblockRpc<LogRow[]>(chain, "eth_getLogs", [{
          address: a.address,
          fromBlock: toHex(fromBlockNum),
          toBlock: toHex(toBlockNum),
          topics: [ALL_TOPICS],
        }], uniblockKey);
      } catch (e) {
        summary.errors.push({ chain, address: a.address, err: String(e).slice(0, 250) });
        summary.rpc_errors++;
        continue;
      }
      summary.logs_found += logs.length;

      const companyName = nameBySlug.get(a.company_slug) || a.company_slug;
      for (const log of logs) {
        const topic0 = log.topics?.[0];
        if (!topic0 || !TOPIC_NAMES[topic0]) continue;
        const sig = signalKindFor(topic0);
        const evidence = `https://${chainExplorer(chain)}/tx/${log.transactionHash}`;
        const title = composeTitle(companyName, sig.subtype, a.label || a.kind, chain);
        const detail = composeDetail(sig.subtype, a.address, log);
        if (body.dry_run) continue;
        const { error: insErr } = await admin.from("account_signals").insert({
          company_slug: a.company_slug,
          signal_type: sig.kind,
          signal_subtype: sig.subtype,
          source: "onchain",
          title,
          detail,
          evidence_url: evidence,
          fired_at: new Date().toISOString(),
          score_boost: sig.priority,
          raw_data: { chain, chainId: CHAIN_ID[chain.toLowerCase()], address: a.address, kind: a.kind, topic0, tx: log.transactionHash, block: log.blockNumber, log_topics: log.topics, log_data: log.data },
        });
        if (!insErr) summary.signals_inserted++;
        else if (insErr.code !== "23505") summary.errors.push({ chain, address: a.address, err: `insert: ${insErr.message}` });
      }
      if (!body.dry_run) {
        await admin.from("chain_addresses").update({ last_seen_block: toBlockNum, updated_at: new Date().toISOString() }).eq("id", a.id);
      }
    }
  }

  return json(200, { ok: true, summary, signals_added: summary.signals_inserted });
});

function chainExplorer(chain: string): string {
  switch (chain.toLowerCase()) {
    case "ethereum": case "eth": case "mainnet": return "etherscan.io";
    case "optimism": case "op": return "optimistic.etherscan.io";
    case "arbitrum": case "arbitrum-one": case "arb": return "arbiscan.io";
    case "base": return "basescan.org";
    case "polygon": case "matic": return "polygonscan.com";
    case "bsc": case "binance": case "bnb": return "bscscan.com";
    case "avalanche": case "avax": return "snowtrace.io";
    case "fantom": case "ftm": return "ftmscan.com";
    case "gnosis": case "xdai": return "gnosisscan.io";
    case "linea": return "lineascan.build";
    case "scroll": return "scrollscan.com";
    case "zksync": case "zksync-era": return "explorer.zksync.io";
    case "blast": return "blastscan.io";
    case "mantle": return "mantlescan.xyz";
    case "celo": return "celoscan.io";
    case "hyperliquid": case "hyperevm": case "hl": return "hyperevmscan.io";
    case "berachain": case "bera": return "berascan.com";
    case "sonic": return "sonicscan.org";
    case "sei": return "seitrace.com";
    default: return `${chain.toLowerCase()}.scan`;
  }
}
function composeTitle(companyName: string, subtype: string, addrLabel: string | null, chain: string): string {
  const label = addrLabel ? ` (${addrLabel})` : "";
  const chainPretty = chain.charAt(0).toUpperCase() + chain.slice(1);
  switch (subtype) {
    case "proxy-upgrade": return `${companyName}: contract upgraded on ${chainPretty}${label}`;
    case "paused": return `${companyName}: contract PAUSED on ${chainPretty}${label}`;
    case "unpaused": return `${companyName}: contract resumed on ${chainPretty}${label}`;
    case "proxy-admin-change": return `${companyName}: proxy admin changed on ${chainPretty}${label}`;
    case "ownership-transferred": return `${companyName}: contract ownership transferred on ${chainPretty}${label}`;
    case "signer-added": return `${companyName}: multisig signer added on ${chainPretty}${label}`;
    case "signer-removed": return `${companyName}: multisig signer removed on ${chainPretty}${label}`;
    default: return `${companyName}: onchain event on ${chainPretty}${label}`;
  }
}
function composeDetail(subtype: string, address: string, log: LogRow): string {
  const block = fromHex(log.blockNumber);
  switch (subtype) {
    case "proxy-upgrade": return `New implementation deployed at proxy ${address}. Block ${block}. Fresh code on mainnet — audit moment.`;
    case "paused": return `Contract ${address} emitted Paused at block ${block}. Possible incident or planned maintenance.`;
    case "unpaused": return `Contract ${address} resumed at block ${block}.`;
    case "proxy-admin-change": return `Proxy admin change on ${address} at block ${block}. Governance-sensitive event.`;
    case "ownership-transferred": return `Ownership transferred on ${address} at block ${block}.`;
    case "signer-added": case "signer-removed": return `Multisig owner change at ${address} block ${block}. Security committee shift.`;
    default: return `Onchain event ${log.topics[0]} from ${address} at block ${block}.`;
  }
}
