import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SAFE_BASES: Record<string, string> = {
  ethereum: 'https://safe-transaction-mainnet.safe.global',
  arbitrum: 'https://safe-transaction-arbitrum.safe.global',
  polygon: 'https://safe-transaction-polygon.safe.global',
  optimism: 'https://safe-transaction-optimism.safe.global',
  bsc: 'https://safe-transaction-bsc.safe.global',
  base: 'https://safe-transaction-base.safe.global',
  avalanche: 'https://safe-transaction-avalanche.safe.global',
  gnosis: 'https://safe-transaction-gnosis-chain.safe.global',
  zksync: 'https://safe-transaction-zksync.safe.global',
  scroll: 'https://safe-transaction-scroll.safe.global',
  linea: 'https://safe-transaction-linea.safe.global',
};

function chainSlug(chain: string): string {
  const c = (chain || '').toLowerCase().trim();
  if (c === 'eth' || c === 'mainnet') return 'ethereum';
  if (c === 'arb' || c === 'arbitrum-one' || c === 'arb-one') return 'arbitrum';
  if (c === 'op' || c === 'optimism-mainnet') return 'optimism';
  if (c === 'matic' || c === 'polygon-pos') return 'polygon';
  if (c === 'avax' || c === 'avalanche-c') return 'avalanche';
  if (c === 'gno') return 'gnosis';
  return c;
}

async function fetchSafe(chain: string, address: string): Promise<any | null> {
  const base = SAFE_BASES[chain];
  if (!base) return null;
  try {
    const r = await fetch(`${base}/api/v1/safes/${address}/`, { headers: { 'accept': 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
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
  const limit = Math.min(Number(body.limit || 30), 100);
  const explicitAddrs = (body.addresses as Array<{ address: string; chain: string; company_slug?: string }> | undefined) ?? null;
  const onlySlug = body.company_slug as string | undefined;

  let candidates: Array<{ address: string; chain: string; company_slug: string | null }> = [];

  if (explicitAddrs) {
    candidates = explicitAddrs.map(c => ({ address: c.address.toLowerCase(), chain: chainSlug(c.chain), company_slug: c.company_slug ?? null }));
  } else {
    let q = sb.from('chain_addresses').select('chain,admin_address,owner_address,address,kind,company_slug');
    if (onlySlug) q = q.eq('company_slug', onlySlug);
    const { data: rows } = await q.not('chain', 'eq', 'solana').limit(3000);
    const seen = new Set<string>();
    for (const r of (rows ?? []) as any[]) {
      const ch = chainSlug(r.chain);
      if (!SAFE_BASES[ch]) continue;
      const candList: string[] = [];
      if (r.admin_address && /^0x[0-9a-f]{40}$/i.test(r.admin_address)) candList.push(r.admin_address);
      if (r.owner_address && /^0x[0-9a-f]{40}$/i.test(r.owner_address)) candList.push(r.owner_address);
      if (r.kind === 'governance' && /^0x[0-9a-f]{40}$/i.test(r.address)) candList.push(r.address);
      for (const addr of candList) {
        const k = `${ch}|${addr.toLowerCase()}`;
        if (seen.has(k)) continue;
        seen.add(k);
        candidates.push({ address: addr.toLowerCase(), chain: ch, company_slug: r.company_slug });
      }
    }

    // Skip recently synced
    const cutoff = new Date(Date.now() - 6 * 86400 * 1000).toISOString();
    const { data: recent } = await sb.from('multisig_safes').select('chain,address').gte('last_synced_at', cutoff);
    const recentSet = new Set((recent ?? []).map((r: any) => `${r.chain}|${(r.address as string).toLowerCase()}`));
    candidates = candidates.filter(c => !recentSet.has(`${c.chain}|${c.address}`));
  }

  candidates = candidates.slice(0, limit);

  const results: any[] = [];
  for (const c of candidates) {
    const data = await fetchSafe(c.chain, c.address);
    if (!data || !Array.isArray(data.owners)) {
      results.push({ chain: c.chain, address: c.address, status: 'not_a_safe' });
      await new Promise(r => setTimeout(r, 200));
      continue;
    }
    const owners = (data.owners as string[]).map(o => o.toLowerCase()).sort();
    const threshold = Number(data.threshold) || null;

    const { data: prev } = await sb.from('multisig_safes')
      .select('id,owners,threshold')
      .eq('chain', c.chain)
      .eq('address', c.address)
      .maybeSingle();

    if (prev) {
      const prevOwners = ((prev.owners as string[]) || []).map(o => o.toLowerCase()).sort();
      const added = owners.filter(o => !prevOwners.includes(o));
      const removed = prevOwners.filter(o => !owners.includes(o));
      const changedThreshold = prev.threshold !== threshold;
      const changes: any[] = [];
      if (added.length > 0) changes.push({ kind: 'added', signers: added });
      if (removed.length > 0) changes.push({ kind: 'removed', signers: removed });
      if (changedThreshold) changes.push({ kind: 'threshold_changed', from: prev.threshold, to: threshold });
      if (changes.length > 0) {
        await sb.from('multisig_signer_changes').insert(changes.map(ch => ({
          company_slug: c.company_slug,
          chain: c.chain,
          safe_address: c.address,
          event_kind: ch.kind,
          details: ch,
        })));
      }
    } else {
      await sb.from('multisig_signer_changes').insert([{
        company_slug: c.company_slug,
        chain: c.chain,
        safe_address: c.address,
        event_kind: 'initial_observation',
        details: { owners_count: owners.length, threshold },
      }]);
    }

    const { error: upErr } = await sb.from('multisig_safes').upsert([{
      company_slug: c.company_slug,
      chain: c.chain,
      address: c.address,
      threshold,
      owners,
      nonce: data.nonce ?? null,
      master_copy: data.masterCopy ?? null,
      version: data.version ?? null,
      source: 'safe_global',
      last_synced_at: new Date().toISOString(),
    }], { onConflict: 'chain,address', ignoreDuplicates: false });
    if (upErr) results.push({ chain: c.chain, address: c.address, error: upErr.message.slice(0, 100) });
    else results.push({ chain: c.chain, address: c.address, owners: owners.length, threshold, status: 'synced' });
    await new Promise(r => setTimeout(r, 250));
  }

  return new Response(JSON.stringify({ ok: true, scanned: candidates.length, results }), { headers: { 'Content-Type': 'application/json' } });
});
