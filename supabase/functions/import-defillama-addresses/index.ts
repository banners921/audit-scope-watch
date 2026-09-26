import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

// Normalize DefiLlama chain labels → our chain identifiers
const CHAIN_MAP: Record<string, string> = {
  "Ethereum": "ethereum", "Arbitrum": "arbitrum", "Optimism": "optimism", "Base": "base", "Polygon": "polygon",
  "BSC": "bsc", "Binance": "bsc", "BNB Chain": "bsc",
  "Avalanche": "avalanche", "Fantom": "fantom", "Solana": "solana", "Gnosis": "gnosis",
  "Mantle": "mantle", "Scroll": "scroll", "Linea": "linea", "zkSync Era": "zksync", "Blast": "blast",
  "Berachain": "berachain", "Sonic": "sonic", "Sei": "sei", "Celo": "celo",
  "Hyperliquid": "hyperliquid", "Hyperliquid L1": "hyperliquid", "Aptos": "aptos", "Sui": "sui",
  "Tron": "tron", "Cosmos": "cosmos", "Near": "near", "Cardano": "cardano",
};

function normalizeChain(s: string): string | null {
  if (!s) return null;
  if (CHAIN_MAP[s]) return CHAIN_MAP[s];
  const lc = s.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (CHAIN_MAP[s.trim()]) return CHAIN_MAP[s.trim()];
  for (const [k, v] of Object.entries(CHAIN_MAP)) if (k.toLowerCase().replace(/[^a-z0-9]/g, "") === lc) return v;
  return null;
}

function toSlug(s: string): string {
  return s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// DefiLlama address can be prefixed: "solana:...", "sui:...", "aptos:...", "0x..."
function parseAddress(raw: string, chains: string[]): { chain: string | null; address: string } | null {
  if (!raw || raw === "-" || raw.length < 6) return null;
  // Prefix form
  const m = raw.match(/^([a-z]+):(.+)$/i);
  if (m) {
    const chain = normalizeChain(m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()) || m[1].toLowerCase();
    return { chain, address: m[2].trim() };
  }
  // Plain hex → default to first chain or Ethereum
  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    const primaryChain = chains.find((c) => normalizeChain(c)) || "Ethereum";
    return { chain: normalizeChain(primaryChain) || "ethereum", address: raw.toLowerCase() };
  }
  // Plausible Solana base58 (32-44 chars no 0x, alphanumeric)
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw)) {
    return { chain: "solana", address: raw };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Missing env" });

  const cronKey = req.headers.get("x-cron-key") || "";
  const authHeader = req.headers.get("Authorization") || "";
  if (cronKey !== CRON_KEY) {
    if (!authHeader) return json(401, { error: "Unauthorized" });
    const u = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data } = await u.auth.getUser();
    if (!data?.user) return json(401, { error: "Unauthorized" });
  }
  const admin = createClient(supabaseUrl, serviceKey);

  // 1. Pull DefiLlama protocols
  const r = await fetch("https://api.llama.fi/protocols", { headers: { "User-Agent": "auditscope" } });
  if (!r.ok) return json(502, { error: `DefiLlama HTTP ${r.status}` });
  const protocols = await r.json() as any[];

  // 2. Load companies for matching
  const slugSet = new Set<string>();
  const nameMap = new Map<string, string>();
  let from = 0;
  while (true) {
    const { data } = await admin.from("companies").select("slug,name").range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const c of data as Array<{ slug: string; name: string }>) {
      if (c.slug) slugSet.add(c.slug);
      if (c.name) nameMap.set(c.name.toLowerCase().trim(), c.slug);
    }
    if (data.length < 1000) break;
    from += 1000;
  }

  function findCompanySlug(p: any): string | null {
    const llamaSlug = String(p.slug || "").toLowerCase();
    if (llamaSlug && slugSet.has(llamaSlug)) return llamaSlug;
    const nameLower = String(p.name || "").toLowerCase().trim();
    if (nameLower && nameMap.has(nameLower)) return nameMap.get(nameLower)!;
    const reslug = toSlug(p.name || "");
    if (reslug && slugSet.has(reslug)) return reslug;
    // Strip llama suffixes like "-v2", "-v3"
    const stripped = llamaSlug.replace(/-v\d+$/, "");
    if (stripped !== llamaSlug && slugSet.has(stripped)) return stripped;
    return null;
  }

  // 3. Load existing chain_addresses to avoid dup inserts
  const existing = new Set<string>();
  let from2 = 0;
  while (true) {
    const { data } = await admin.from("chain_addresses").select("company_slug,chain,address").range(from2, from2 + 999);
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ company_slug: string; chain: string; address: string }>) {
      existing.add(`${r.company_slug}::${r.chain}::${r.address.toLowerCase()}`);
    }
    if (data.length < 1000) break;
    from2 += 1000;
  }

  // 4. Walk protocols, build rows
  let candidates = 0, matched = 0, parsedOk = 0, dupesSkipped = 0;
  const newRows: any[] = [];
  const newCompanies = new Set<string>();
  for (const p of protocols) {
    if (!p.address || p.address === "-") continue;
    candidates++;
    const slug = findCompanySlug(p);
    if (!slug) continue;
    matched++;
    const chains = Array.isArray(p.chains) ? p.chains : [];
    const parsed = parseAddress(p.address, chains);
    if (!parsed || !parsed.chain) continue;
    parsedOk++;
    const key = `${slug}::${parsed.chain}::${parsed.address.toLowerCase()}`;
    if (existing.has(key)) { dupesSkipped++; continue; }
    existing.add(key);
    newCompanies.add(slug);
    newRows.push({
      company_slug: slug,
      chain: parsed.chain,
      address: parsed.address,
      kind: "token",
      label: `defillama:${p.slug || toSlug(p.name)}`,
      source: "defillama",
      enabled: true,
    });
  }

  // 5. Bulk insert in chunks of 500
  let inserted = 0, insertErrors = 0;
  for (let i = 0; i < newRows.length; i += 500) {
    const chunk = newRows.slice(i, i + 500);
    const { error } = await admin.from("chain_addresses").insert(chunk);
    if (error) insertErrors++;
    else inserted += chunk.length;
  }

  return json(200, {
    ok: true,
    protocols_with_address: candidates,
    matched_to_companies: matched,
    parsed_ok: parsedOk,
    dupes_skipped: dupesSkipped,
    inserted,
    insert_errors: insertErrors,
    new_companies_with_addresses: newCompanies.size,
  });
});
