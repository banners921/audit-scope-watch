// snapshot-company-signals — daily numeric snapshot per company so we can compute deltas (hiring/+/-, audits added, etc).
// Cron-fired every 12 hours. Idempotent per (slug, date).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-key', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Use POST' });
  if ((req.headers.get('x-cron-key') || '') !== CRON_KEY) return json(401, { error: 'Unauthorized' });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({})) as { limit?: number; slug?: string };
  const limit = Math.min(Math.max(body.limit ?? 1000, 1), 5000);
  const today = new Date().toISOString().slice(0, 10);

  // Single SQL roll-up via RPC-like SELECT: companies + their aggregates
  // We do it in JS to avoid creating a heavy SQL function for now.
  let q = supabase
    .from('companies')
    .select('slug,name,employee_count,audit_count,has_been_hacked,total_raised_usd,last_audit_date,last_audit_firm,x_posts_30d')
    .not('slug', 'is', null);
  if (body.slug) q = q.eq('slug', body.slug);
  else q = q.order('audit_count', { ascending: false, nullsFirst: false }).limit(limit);
  const { data: companies, error } = await q;
  if (error) return json(500, { error: error.message });
  if (!companies || companies.length === 0) return json(200, { ok: true, snapshotted: 0 });

  const slugs = companies.map((c: any) => c.slug);

  // Bulk pull aggregates in 3 queries
  const [auditCnt, hackCnt, fundingCnt, enrichments] = await Promise.all([
    supabase.from('audit_history').select('company_slug', { count: 'exact' }).in('company_slug', slugs),
    supabase.from('hacks').select('company_slug', { count: 'exact' }).in('company_slug', slugs),
    supabase.from('funding_rounds').select('company_slug', { count: 'exact' }).in('company_slug', slugs),
    supabase.from('company_enrichment').select('company_slug,signal_summary').in('company_slug', slugs),
  ]);

  // Tally per slug (Supabase exact-count is per-query not per-row, so we manually count)
  const auditBySlug = new Map<string, number>();
  for (const r of (auditCnt.data ?? []) as any[]) auditBySlug.set(r.company_slug, (auditBySlug.get(r.company_slug) ?? 0) + 1);
  const hackBySlug = new Map<string, number>();
  for (const r of (hackCnt.data ?? []) as any[]) hackBySlug.set(r.company_slug, (hackBySlug.get(r.company_slug) ?? 0) + 1);
  const fundBySlug = new Map<string, number>();
  for (const r of (fundingCnt.data ?? []) as any[]) fundBySlug.set(r.company_slug, (fundBySlug.get(r.company_slug) ?? 0) + 1);
  const enrBySlug = new Map<string, any>();
  for (const r of (enrichments.data ?? []) as any[]) enrBySlug.set(r.company_slug, r.signal_summary || {});

  const rows = companies.map((c: any) => {
    const s = enrBySlug.get(c.slug) || {};
    return {
      company_slug: c.slug,
      snapshot_date: today,
      employee_count: s.employee_count ?? c.employee_count ?? null,
      audit_count: auditBySlug.get(c.slug) ?? c.audit_count ?? 0,
      hack_count: hackBySlug.get(c.slug) ?? 0,
      funding_count: fundBySlug.get(c.slug) ?? 0,
      total_raised_usd: c.total_raised_usd,
      x_posts_30d: c.x_posts_30d ?? null,
      hunter_total_emails: s.hunter_total_emails ?? null,
      github_repos_count: s.github_repos_count ?? null,
      hiring_count: s.hiring_count ?? null,
      hiring_security_roles: s.hiring_security_roles ?? null,
      last_audit_date: c.last_audit_date,
      last_audit_firm: c.last_audit_firm,
    };
  });

  // Upsert in batches of 500
  let inserted = 0, errors = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error: e } = await supabase.from('company_signals_snapshot').upsert(batch, { onConflict: 'company_slug,snapshot_date' });
    if (e) errors++;
    else inserted += batch.length;
  }

  return json(200, { ok: true, snapshotted: inserted, errors, date: today });
});
