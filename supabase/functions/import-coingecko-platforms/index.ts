import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// CoinGecko platform name -> our canonical chain slug
const PLATFORM_MAP: Record<string, string> = {
  'ethereum': 'ethereum',
  'binance-smart-chain': 'bsc',
  'polygon-pos': 'polygon',
  'arbitrum-one': 'arbitrum',
  'arbitrum-nova': 'arbitrum-nova',
  'optimistic-ethereum': 'optimism',
  'avalanche': 'avalanche',
  'base': 'base',
  'fantom': 'fantom',
  'gnosis': 'gnosis',
  'xdai': 'gnosis',
  'celo': 'celo',
  'aurora': 'aurora',
  'cronos': 'cronos',
  'klay-token': 'klaytn',
  'metis-andromeda': 'metis',
  'moonbeam': 'moonbeam',
  'moonriver': 'moonriver',
  'okex-chain': 'okc',
  'harmony-shard-0': 'harmony',
  'zksync': 'zksync',
  'linea': 'linea',
  'scroll': 'scroll',
  'mantle': 'mantle',
  'blast': 'blast',
  'mode': 'mode',
  'manta-pacific': 'manta',
  'sui': 'sui',
  'aptos': 'aptos',
  'sei-network': 'sei',
  'solana': 'solana',
  'tron': 'tron',
  'near-protocol': 'near',
  'flow': 'flow',
  'algorand': 'algorand',
  'cardano': 'cardano',
  'cosmos': 'cosmos',
  'osmosis': 'osmosis',
  'kava': 'kava',
  'kujira': 'kujira',
  'injective': 'injective',
  'stellar': 'stellar',
  'tezos': 'tezos',
  'eos': 'eos',
  'hedera-hashgraph': 'hedera',
  'icp': 'icp',
  'starknet': 'starknet',
  'zora-network': 'zora',
  'sonic': 'sonic',
  'berachain': 'berachain',
  'unichain': 'unichain',
  'world-chain': 'worldchain',
  'monad': 'monad',
  'fraxtal': 'fraxtal',
  'taiko': 'taiko',
  'plume': 'plume',
  'hyperevm': 'hyperliquid',
  'merlin-chain': 'merlin',
  'soneium': 'soneium',
};

const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const BAD = new Set(['0x0000000000000000000000000000000000000000', '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef']);

function slugify(s: string): string { return (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

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
  // 1. Fetch all coins with platforms (this is a big single GET)
  const cgUrl = 'https://api.coingecko.com/api/v3/coins/list?include_platform=true';
  const r = await fetch(cgUrl);
  if (!r.ok) return new Response(JSON.stringify({ ok: false, error: `CG HTTP ${r.status}` }), { status: 500 });
  const coins = await r.json();
  if (!Array.isArray(coins)) return new Response(JSON.stringify({ ok: false, error: 'unexpected CG payload' }), { status: 500 });

  // 2. Build candidate inserts: index company slugs we know about
  const allSlugs = new Set<string>();
  const allNames = new Map<string, string>(); // lower-name -> slug
  {
    let from = 0;
    while (true) {
      const { data } = await sb.from('companies').select('slug,name').range(from, from + 999);
      if (!data || data.length === 0) break;
      for (const c of data as any[]) {
        if (c.slug) allSlugs.add(c.slug);
        if (c.name) allNames.set(String(c.name).toLowerCase().trim(), c.slug);
      }
      if (data.length < 1000) break;
      from += 1000;
    }
  }

  // Existing chain_addresses keys to dedup
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

  let matchedCoins = 0;
  let candidateRows = 0;
  const rows: any[] = [];

  for (const coin of coins) {
    const id = coin.id as string;
    const name = coin.name as string;
    const platforms = coin.platforms as Record<string, string> | undefined;
    if (!platforms || typeof platforms !== 'object') continue;

    // Match by slug (CG id often equals our slug) OR by name
    let companySlug: string | null = null;
    if (allSlugs.has(id)) companySlug = id;
    else {
      const byName = allNames.get(String(name).toLowerCase().trim());
      if (byName) companySlug = byName;
      else {
        const slugified = slugify(name);
        if (allSlugs.has(slugified)) companySlug = slugified;
      }
    }
    if (!companySlug) continue;
    matchedCoins++;

    for (const [platform, addr] of Object.entries(platforms)) {
      if (!addr || typeof addr !== 'string') continue;
      const cleanAddr = addr.trim();
      if (!EVM_ADDR_RE.test(cleanAddr)) {
        // Non-EVM (Solana, etc.) — only include if Solana-style alphanumeric
        if (platform === 'solana' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cleanAddr)) {
          // accept
        } else continue;
      }
      if (EVM_ADDR_RE.test(cleanAddr) && BAD.has(cleanAddr.toLowerCase())) continue;
      const ourChain = PLATFORM_MAP[platform] || platform;
      const key = `${ourChain}|${cleanAddr.toLowerCase()}`;
      if (existingKey.has(key)) continue;
      existingKey.add(key);
      rows.push({
        company_slug: companySlug,
        chain: ourChain,
        address: cleanAddr,
        kind: 'token',
        label: `${name} (${coin.symbol})`,
        source: 'coingecko_platforms',
        is_contract: true,
        enabled: true,
      });
      candidateRows++;
    }
  }

  if (dryRun) {
    return new Response(JSON.stringify({ ok: true, dry: true, total_coins: coins.length, matched_coins: matchedCoins, new_rows: candidateRows, elapsed_ms: Date.now() - startedAt }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Batch insert
  let inserted = 0;
  const errors: string[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await sb.from('chain_addresses').insert(chunk);
    if (error) errors.push(error.message.slice(0, 100));
    else inserted += chunk.length;
  }

  return new Response(JSON.stringify({
    ok: true,
    total_coins: coins.length,
    matched_coins: matchedCoins,
    new_rows: candidateRows,
    inserted,
    errors,
    elapsed_ms: Date.now() - startedAt,
  }), { headers: { 'Content-Type': 'application/json' } });
});
