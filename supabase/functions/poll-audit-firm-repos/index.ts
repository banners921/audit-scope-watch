// v7 — parallel detection + backgrounded parallel ingest.
// Fixes the sequential wall-clock starvation: v4-v6 awaited each bulk-ingest (up to 180s)
// inline in a for-loop, so the ~150s edge wall clock killed the run after 1-2 firms and the
// fleet rotated only ~2-4 firms/day (full pass ~2-3 weeks). Now: atom checks run pooled,
// fresh firms fire in a bounded pool via EdgeRuntime.waitUntil so ingests finish in the
// background while the cron gets a fast 200.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

// Bounded-concurrency map. Never rejects; per-item errors are captured.
async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results = new Array(items.length) as R[];
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) || 1 }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      try { results[idx] = await fn(items[idx], idx); }
      catch (e) { results[idx] = ({ __error: String(e).slice(0, 150) } as unknown) as R; }
    }
  });
  await Promise.all(workers);
  return results;
}

async function getRepoPushedAt(owner: string, repo: string, ghToken: string | null): Promise<{ at: string | null; reason: string }> {
  try {
    const r = await fetch(`https://github.com/${owner}/${repo}/commits.atom`, { headers: { "User-Agent": "AuditScope/1.0", Accept: "application/atom+xml" }, signal: AbortSignal.timeout(15_000) });
    if (r.ok) {
      const xml = await r.text();
      const m = xml.match(/<entry>[\s\S]*?<updated>([^<]+)<\/updated>/);
      if (m) return { at: m[1], reason: 'atom_ok' };
      const m2 = xml.match(/<updated>([^<]+)<\/updated>/);
      if (m2) return { at: m2[1], reason: 'atom_feed' };
      return { at: null, reason: 'atom_no_entries' };
    }
    if (r.status === 404) return { at: null, reason: 'atom_404' };
  } catch (e) { /* fall through to API */ }
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "AuditScope/1.0" };
    if (ghToken) headers.Authorization = `token ${ghToken}`;
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { at: null, reason: `api_${r.status}` };
    const j = await r.json();
    return { at: j.pushed_at || j.updated_at || null, reason: 'api_ok' };
  } catch (e) { return { at: null, reason: 'api_error' }; }
}

async function fireBulkIngest(supabaseUrl: string, anonKey: string, firmSlug: string): Promise<{ ok: boolean; result?: any; error?: string }> {
  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/bulk-ingest-firm-audits`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-key": CRON_KEY, "Authorization": `Bearer ${anonKey}` },
      body: JSON.stringify({ firm_slug: firmSlug }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok) { const t = await r.text().catch(() => ""); return { ok: false, error: `${r.status}: ${t.slice(0, 200)}` }; }
    return { ok: true, result: await r.json().catch(() => ({})) };
  } catch (e) { return { ok: false, error: String(e).slice(0, 150) }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const ghToken = Deno.env.get("GITHUB_TOKEN") || null;
  const cronKey = req.headers.get("x-cron-key") || "";
  if (cronKey !== CRON_KEY) return json(401, { error: "Unauthorized" });
  const admin = createClient(supabaseUrl, serviceKey);
  const body = (await req.json().catch(() => ({}))) as { force?: boolean; limit?: number; include_inactive?: boolean; detect_concurrency?: number; ingest_concurrency?: number };
  const force = !!body.force;
  const limit = Math.min(Math.max(body.limit ?? 200, 1), 200);
  const detectConc = Math.min(Math.max(body.detect_concurrency ?? 12, 1), 20);
  const ingestConc = Math.min(Math.max(body.ingest_concurrency ?? 6, 1), 10);

  let q = admin
    .from("audit_sources")
    .select("slug, firm_name, source_type, source_config, last_scraped_at, is_active")
    .in("source_type", ["github_dir", "github_nested_dir"]);
  if (!body.include_inactive) q = q.eq('is_active', true);
  q = q.order("last_scraped_at", { ascending: true, nullsFirst: true }).limit(limit);
  const { data: sources } = await q;
  if (!sources || sources.length === 0) return json(200, { ok: true, sources: 0, note: "no github sources" });

  const reasonCounts: Record<string, number> = {};
  let deactivated = 0, missing = 0;

  // Phase A — detect freshness in parallel (atom feed is cheap and not API-rate-limited).
  const checks = await mapPool(sources as any[], detectConc, async (s) => {
    const cfg = s.source_config as any;
    const owner = cfg?.owner, repo = cfg?.repo;
    if (!owner || !repo) return { s, fresh: false, reason: 'missing_owner_repo' };
    const { at: pushedAt, reason } = await getRepoPushedAt(owner, repo, ghToken);
    if (!pushedAt) {
      if (reason === 'atom_404') {
        await admin.from('audit_sources').update({ is_active: false, deactivated_reason: 'auto: atom_404' }).eq('slug', s.slug);
      }
      return { s, fresh: false, reason };
    }
    const lastScrape = s.last_scraped_at ? new Date(s.last_scraped_at).getTime() : 0;
    const isFresh = force || !lastScrape || new Date(pushedAt).getTime() > lastScrape;
    return { s, fresh: isFresh, reason, pushedAt };
  });

  for (const c of checks) {
    if (!c) continue;
    reasonCounts[c.reason] = (reasonCounts[c.reason] || 0) + 1;
    if (c.reason === 'atom_404') deactivated++;
    if (c.reason === 'missing_owner_repo') missing++;
  }

  const freshFirms = checks.filter((c: any) => c && c.fresh).map((c: any) => c.s);

  // Phase B — fire ingests in a bounded pool, in the BACKGROUND so the cron gets a fast 200
  // and one slow firm can't starve the rest. Each bulk-ingest stamps its own last_scraped_at,
  // so the fleet rotates every run instead of once every few weeks.
  const runIngests = async () => {
    await mapPool(freshFirms as any[], ingestConc, (s) => fireBulkIngest(supabaseUrl, anonKey, s.slug));
  };
  // @ts-ignore — EdgeRuntime is provided by the Supabase edge runtime.
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(runIngests());
  } else {
    runIngests(); // best-effort fallback; do not await so the response stays fast
  }

  return json(200, {
    ok: true,
    checked: sources.length,
    fresh: freshFirms.length,
    stale: sources.length - freshFirms.length,
    deactivated,
    missing,
    firing: freshFirms.slice(0, 60).map((f: any) => f.slug),
    reasons: reasonCounts,
    note: "ingests running in background",
  });
});
