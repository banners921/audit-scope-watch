import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CHAIN_MAP: Record<string, string> = {
  Ethereum: 'ethereum', BSC: 'bsc', Polygon: 'polygon', Arbitrum: 'arbitrum',
  Optimism: 'optimism', Avalanche: 'avalanche', Base: 'base', Fantom: 'fantom',
  Gnosis: 'gnosis', Celo: 'celo', Aurora: 'aurora', Cronos: 'cronos',
  Klaytn: 'klaytn', Metis: 'metis', Moonbeam: 'moonbeam', Moonriver: 'moonriver',
  Solana: 'solana', Tron: 'tron', Linea: 'linea', Scroll: 'scroll', Mantle: 'mantle',
  Blast: 'blast', Mode: 'mode', Manta: 'manta', Sei: 'sei', Sui: 'sui', Aptos: 'aptos',
  Starknet: 'starknet', zkSync: 'zksync', 'zkSync Era': 'zksync',
  'Polygon zkEVM': 'polygon-zkevm', 'Arbitrum Nova': 'arbitrum-nova',
  Sonic: 'sonic', Berachain: 'berachain', Unichain: 'unichain', Fraxtal: 'fraxtal',
  Plume: 'plume', Taiko: 'taiko', Hyperliquid: 'hyperliquid', Soneium: 'soneium',
};

const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const BAD = new Set(['0x0000000000000000000000000000000000000000']);
function slugify(s: string): string { return (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

// Strip common child-version suffixes to map to parent slug:  aave-v3 -> aave, compound-v3-lend -> compound
function stripVersion(s: string): string[] {
  const variants = new Set<string>([s]);
  // Strip trailing -vN, -vN-* etc.
  let cur = s;
  while (true) {
    const m = cur.match(/^(.*)-v\d+([-a-z]*)?$/i);
    if (!m) break;
    cur = m[1];
    variants.add(cur);
  }
  // Also strip last hyphenated segment as a fallback
  if (s.includes('-')) {
    const parts = s.split('-');
    variants.add(parts.slice(0, -1).join('-'));
  }
  return Array.from(variants).filter(Boolean);
}

// Auth: this endpoint runs service-role queries against the database, so it
// must never be anonymously callable.
const CRON_KEY = Deno.env.get("CRON_KEY") || "";
function authorised(req: Request): boolean {
  // An unset secret must not authorise everyone ("" === "" would).
  return CRON_KEY !== "" && req.headers.get("x-cron-key") === CRON_KEY;
}
const UNAUTH = () => new Response(JSON.stringify({ error: "Unauthorized" }), {
  status: 401, headers: { "Content-Type": "application/json" },
});

Deno.serve(async (req: Request) => {
  if (!authorised(req)) return UNAUTH();
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const dryRun = body.dry_run === true;
  const startedAt = Date.now();

  const r = await fetch('https://yields.llama.fi/pools');
  if (!r.ok) return new Response(JSON.stringify({ ok: false, error: `yields HTTP ${r.status}` }), { status: 500 });
  const j = await r.json();
  const pools: any[] = Array.isArray(j?.data) ? j.data : [];

  const allSlugs = new Set<string>();
  const nameToSlug = new Map<string, string>();
  {
    let from = 0;
    while (true) {
      const { data } = await sb.from('companies').select('slug,name').range(from, from + 999);
      if (!data || data.length === 0) break;
      for (const c of data as any[]) {
        if (c.slug) allSlugs.add(c.slug);
        if (c.name) nameToSlug.set(String(c.name).toLowerCase().trim(), c.slug);
      }
      if (data.length < 1000) break;
      from += 1000;
    }
  }

  const existingKey = new Set<string>();
  {
    let from = 0;
    while (true) {
      const { data } = await sb.from('chain_addresses').select('chain,address').range(from, from + 999);
      if (!data || data.length === 0) break;
      for (const r of data as any[]) existingKey.add(`${r.chain}|${(r.address || '').toLowerCase()}`);
      if (data.length < 1000) break;
      from += 1000;
    }
  }

  let matchedPools = 0;
  const rows: any[] = [];
  for (const p of pools) {
    const project = String(p.project || '').trim();
    if (!project) continue;

    // Try the project slug, then version-stripped variants
    let companySlug: string | null = null;
    const candidates = [project, slugify(project), ...stripVersion(project), ...stripVersion(slugify(project))];
    for (const c of candidates) {
      if (!c) continue;
      if (allSlugs.has(c)) { companySlug = c; break; }
    }
    if (!companySlug) {
      // last-resort name match
      const byName = nameToSlug.get(project.toLowerCase());
      if (byName) companySlug = byName;
    }
    if (!companySlug) continue;

    const poolAddr = String(p.pool || '').trim();
    if (!poolAddr) continue;
    const ethMatch = poolAddr.match(/^(0x[0-9a-fA-F]{40})/);
    const addr = ethMatch ? ethMatch[1] : poolAddr;
    if (!EVM_ADDR_RE.test(addr)) continue;
    if (BAD.has(addr.toLowerCase())) continue;
    const chain = CHAIN_MAP[p.chain] || String(p.chain || '').toLowerCase();
    if (!chain) continue;
    const key = `${chain}|${addr.toLowerCase()}`;
    if (existingKey.has(key)) continue;
    existingKey.add(key);
    matchedPools++;
    rows.push({
      company_slug: companySlug,
      chain, address: addr,
      kind: 'amm_pool',
      label: `${p.symbol || ''} ${p.poolMeta ? '(' + p.poolMeta + ')' : ''}`.trim() || null,
      source: 'defillama_yields',
      is_contract: true,
      enabled: true,
    });
  }

  if (dryRun) {
    return new Response(JSON.stringify({ ok: true, dry: true, total_pools: pools.length, matched_pools: matchedPools, elapsed_ms: Date.now() - startedAt }), { headers: { 'Content-Type': 'application/json' } });
  }

  let inserted = 0;
  const errors: string[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await sb.from('chain_addresses').insert(chunk);
    if (error) errors.push(error.message.slice(0, 100));
    else inserted += chunk.length;
  }
  return new Response(JSON.stringify({
    ok: true, total_pools: pools.length, matched_pools: matchedPools, inserted, errors, elapsed_ms: Date.now() - startedAt,
  }), { headers: { 'Content-Type': 'application/json' } });
});
