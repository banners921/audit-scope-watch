import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const YEAR_MIN = 2017;
const YEAR_MAX = new Date().getUTCFullYear() + 1;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }
function dateStr(y: number, m: number, d: number) { return `${y}-${pad(m)}-${pad(d)}`; }
function validYear(y: number) { return y >= YEAR_MIN && y <= YEAR_MAX; }

function dateFromUrl(url: string): string | null {
  if (UUID_RE.test(url)) {
    const noUuid = url.replace(UUID_RE, "");
    return dateFromUrl(noUuid);
  }
  const u = url.toLowerCase();
  const iso = u.match(/(20\d{2})[-_\/]([0-1]?\d)[-_\/]([0-3]?\d)(?!\d)/);
  if (iso) {
    const y = +iso[1], mo = +iso[2], d = +iso[3];
    if (validYear(y) && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return dateStr(y, mo, d);
  }
  const ym = u.match(/(20\d{2})[-_\/]([0-1]?\d)(?!\d)/);
  if (ym) {
    const y = +ym[1], mo = +ym[2];
    if (validYear(y) && mo >= 1 && mo <= 12) return dateStr(y, mo, 15);
  }
  const my = u.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)[-_]?(20\d{2})/);
  if (my) {
    const mo = MONTHS[my[1]];
    const y = +my[2];
    if (mo && validYear(y)) return dateStr(y, mo, 15);
  }
  return null;
}

async function dateFromGithub(url: string, token: string | undefined): Promise<{ date: string | null; error?: string }> {
  let owner: string | undefined, repo: string | undefined, path: string | undefined;
  let m = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/(?:blob|raw)\/[^\/]+\/(.+?)(?:\?|#|$)/);
  if (m) { owner = m[1]; repo = m[2]; path = m[3]; }
  if (!owner) {
    m = url.match(/^https?:\/\/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/[^\/]+\/(.+?)(?:\?|#|$)/);
    if (m) { owner = m[1]; repo = m[2]; path = m[3]; }
  }
  if (!owner || !repo || !path) return { date: null, error: "unparseable" };
  const decodedPath = decodeURIComponent(path).replace(/^\.\//, "");
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "auditscope-backfill" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const probeUrl = `https://api.github.com/repos/${owner}/${repo}/commits?path=${encodeURIComponent(decodedPath)}&per_page=1`;
  const r1 = await fetch(probeUrl, { headers });
  if (r1.status === 404) return { date: null, error: "404" };
  if (r1.status === 403 || r1.status === 429) return { date: null, error: `rate ${r1.status}` };
  if (!r1.ok) return { date: null, error: `http ${r1.status}` };
  const link = r1.headers.get("link") || "";
  const lastMatch = link.match(/<([^>]+)>;\s*rel="last"/);
  if (!lastMatch) {
    const commits = await r1.json();
    if (!Array.isArray(commits) || !commits.length) return { date: null, error: "empty" };
    const d = commits[0]?.commit?.committer?.date || commits[0]?.commit?.author?.date;
    return d ? { date: d.slice(0, 10) } : { date: null, error: "no date" };
  }
  const r2 = await fetch(lastMatch[1], { headers });
  if (!r2.ok) return { date: null, error: `last ${r2.status}` };
  const lastCommits = await r2.json();
  if (!Array.isArray(lastCommits) || !lastCommits.length) return { date: null, error: "empty_last" };
  const oldest = lastCommits[lastCommits.length - 1];
  const d = oldest?.commit?.committer?.date || oldest?.commit?.author?.date;
  return d ? { date: d.slice(0, 10) } : { date: null, error: "no date oldest" };
}

// New: Cantina portfolio page returns <time dateTime="YYYY-MM-DD">19 June 2025</time> via SSR
async function dateFromCantinaPage(url: string): Promise<{ date: string | null; error?: string }> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; auditscope-backfill/1.0)" },
      redirect: "follow",
    });
    if (!r.ok) return { date: null, error: `http ${r.status}` };
    const html = await r.text();
    // Match <time dateTime="YYYY-MM-DD"> case-insensitive (React serializes as dateTime)
    const matches = [...html.matchAll(/<time[^>]*datetime="(20\d{2}-\d{2}-\d{2})"/gi)];
    if (matches.length === 0) return { date: null, error: "no time tag" };
    // Cantina shows start - end; use the LAST tag (audit completion / publish date)
    const last = matches[matches.length - 1][1];
    return { date: last };
  } catch (e) {
    return { date: null, error: `fetch err: ${String(e).slice(0, 80)}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const ghToken = Deno.env.get("GITHUB_TOKEN") || Deno.env.get("GITHUB_PAT");
  if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Missing supabase env" });

  const cronKey = req.headers.get("x-cron-key") || "";
  const authHeader = req.headers.get("Authorization") || "";
  if (cronKey !== CRON_KEY) {
    if (!authHeader) return json(401, { error: "Unauthorized" });
    const u = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data } = await u.auth.getUser();
    if (!data?.user) return json(401, { error: "Unauthorized" });
  }

  const admin = createClient(supabaseUrl, serviceKey);
  let body: { strategy?: string; limit?: number; firm?: string; dry_run?: boolean } = {};
  try { body = await req.json(); } catch {}
  const strategy = body.strategy || "all";
  const limit = Math.min(Math.max(body.limit ?? 100, 1), 1000);
  const dryRun = body.dry_run === true;

  let query = admin.from("audit_history")
    .select("id, audit_firm, report_url")
    .is("audit_date", null)
    .is("audit_date_attempted_via", null)
    .not("report_url", "is", null)
    .limit(limit);

  if (body.firm) query = query.eq("audit_firm", body.firm);
  if (strategy === "github") {
    query = query.or("report_url.ilike.%github.com%,report_url.ilike.%raw.githubusercontent.com%");
  } else if (strategy === "cantina") {
    query = query.ilike("report_url", "%cantina.xyz%");
  }

  const { data: rows, error } = await query;
  if (error) return json(500, { error: error.message });
  if (!rows || rows.length === 0) return json(200, { ok: true, scanned: 0, updated: 0, note: "no candidates" });

  let urlHits = 0, ghHits = 0, ghErrors = 0, cantinaHits = 0, cantinaErrors = 0, noMatch = 0;
  const updates: Array<{ id: string; audit_date?: string; audit_date_attempted_via: string }> = [];

  for (const row of rows) {
    let date: string | null = null;
    let via = "failed_no_pattern";

    if (strategy === "all" || strategy === "url") {
      const d = dateFromUrl(row.report_url);
      if (d) { date = d; via = "url_regex"; urlHits++; }
    }

    if (!date && (strategy === "all" || strategy === "github") &&
        /github\.com|raw\.githubusercontent\.com/i.test(row.report_url)) {
      const r = await dateFromGithub(row.report_url, ghToken);
      if (r.date) { date = r.date; via = "github_commit"; ghHits++; }
      else { via = "failed_github"; ghErrors++; }
    }

    if (!date && (strategy === "all" || strategy === "cantina") &&
        /cantina\.xyz/i.test(row.report_url)) {
      const r = await dateFromCantinaPage(row.report_url);
      if (r.date) { date = r.date; via = "cantina_page"; cantinaHits++; }
      else { via = "failed_cantina"; cantinaErrors++; }
    }

    if (!date) noMatch++;
    if (!dryRun) {
      updates.push({ id: row.id, ...(date ? { audit_date: date } : {}), audit_date_attempted_via: via });
    }
  }

  let dbErrors = 0;
  if (!dryRun) {
    for (let i = 0; i < updates.length; i += 50) {
      const chunk = updates.slice(i, i + 50);
      await Promise.all(chunk.map(async (u) => {
        const patch: Record<string, unknown> = { audit_date_attempted_via: u.audit_date_attempted_via };
        if (u.audit_date) patch.audit_date = u.audit_date;
        const { error: upErr } = await admin.from("audit_history").update(patch).eq("id", u.id);
        if (upErr) dbErrors++;
      }));
    }
  }

  return json(200, {
    ok: true,
    strategy, firm: body.firm || null, dry_run: dryRun,
    scanned: rows.length,
    url_regex_hits: urlHits,
    github_commit_hits: ghHits, github_errors: ghErrors,
    cantina_hits: cantinaHits, cantina_errors: cantinaErrors,
    no_match: noMatch,
    db_errors: dbErrors,
    updated: urlHits + ghHits + cantinaHits - dbErrors,
  });
});
