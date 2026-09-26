import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function slugify(s: string): string {
  return (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function fetchFeesOverview() {
  const r = await fetch('https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyFees');
  if (!r.ok) throw new Error(`fees HTTP ${r.status}`);
  return r.json();
}
async function fetchRevenueOverview() {
  const r = await fetch('https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyRevenue');
  if (!r.ok) throw new Error(`rev HTTP ${r.status}`);
  return r.json();
}
async function fetchTreasuries() {
  const r = await fetch('https://api.llama.fi/treasuries');
  if (!r.ok) throw new Error(`treas HTTP ${r.status}`);
  return r.json();
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
  const errors: string[] = [];
  const startedAt = Date.now();

  let feesProtocols: any[] = [];
  let revProtocols: any[] = [];
  let treasuries: any[] = [];
  try { feesProtocols = (await fetchFeesOverview())?.protocols ?? []; } catch (e) { errors.push('fees:' + String(e).slice(0, 100)); }
  try { revProtocols = (await fetchRevenueOverview())?.protocols ?? []; } catch (e) { errors.push('rev:' + String(e).slice(0, 100)); }
  try { treasuries = await fetchTreasuries(); } catch (e) { errors.push('treas:' + String(e).slice(0, 100)); }

  // Build index by slug variants
  const econMap = new Map<string, any>();
  const consider = (raw: any, kind: 'fees' | 'rev' | 'treas') => {
    const candidates = [raw.slug, raw.name, raw.parentProtocol].filter(Boolean).map(slugify);
    for (const slug of candidates) {
      if (!slug) continue;
      const e = econMap.get(slug) ?? { llama_id: raw.id || raw.protocolId };
      if (kind === 'fees') {
        e.fees_24h = raw.total24h ?? e.fees_24h;
        e.fees_7d = raw.total7d ?? e.fees_7d;
        e.fees_30d = raw.total30d ?? e.fees_30d;
        e.fees_1y = raw.total1y ?? e.fees_1y;
      } else if (kind === 'rev') {
        e.revenue_24h = raw.total24h ?? e.revenue_24h;
        e.revenue_7d = raw.total7d ?? e.revenue_7d;
        e.revenue_30d = raw.total30d ?? e.revenue_30d;
        e.revenue_1y = raw.total1y ?? e.revenue_1y;
      } else if (kind === 'treas') {
        e.treasury_usd = raw.tvl ?? raw.totalValueUSD ?? e.treasury_usd;
        if (raw.coreUsd != null) e.treasury_composition = { core_usd: raw.coreUsd, total_usd: raw.tvl };
      }
      if (raw.mcap != null) e.mcap = raw.mcap;
      if (raw.fdv != null) e.fdv = raw.fdv;
      econMap.set(slug, e);
    }
  };
  for (const p of feesProtocols) consider(p, 'fees');
  for (const p of revProtocols) consider(p, 'rev');
  for (const p of treasuries) consider(p, 'treas');

  // Only keep slugs that exist in our companies table
  const slugs = Array.from(econMap.keys());
  let known = new Set<string>();
  for (let i = 0; i < slugs.length; i += 1000) {
    const chunk = slugs.slice(i, i + 1000);
    const { data } = await sb.from('companies').select('slug').in('slug', chunk);
    for (const r of (data ?? []) as any[]) known.add(r.slug);
  }

  const rows = Array.from(econMap.entries())
    .filter(([s]) => known.has(s))
    .map(([slug, e]) => ({
      company_slug: slug,
      fees_24h: e.fees_24h ?? null,
      fees_7d: e.fees_7d ?? null,
      fees_30d: e.fees_30d ?? null,
      fees_1y: e.fees_1y ?? null,
      revenue_24h: e.revenue_24h ?? null,
      revenue_7d: e.revenue_7d ?? null,
      revenue_30d: e.revenue_30d ?? null,
      revenue_1y: e.revenue_1y ?? null,
      treasury_usd: e.treasury_usd ?? null,
      treasury_composition: e.treasury_composition ?? null,
      mcap: e.mcap ?? null,
      fdv: e.fdv ?? null,
      source: 'defillama',
      llama_id: e.llama_id ?? null,
      fetched_at: new Date().toISOString(),
    }));

  // Batch upsert
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await sb.from('protocol_economics').upsert(chunk, { onConflict: 'company_slug', ignoreDuplicates: false });
    if (error) errors.push('upsert:' + error.message.slice(0, 100));
    else inserted += chunk.length;
  }

  return new Response(JSON.stringify({
    ok: true,
    fees_count: feesProtocols.length,
    rev_count: revProtocols.length,
    treas_count: treasuries.length,
    candidates: econMap.size,
    matched: rows.length,
    upserted: inserted,
    elapsed_ms: Date.now() - startedAt,
    errors,
  }), { headers: { 'Content-Type': 'application/json' } });
});
