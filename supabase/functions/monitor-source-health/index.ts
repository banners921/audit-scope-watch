// monitor-source-health — daily freshness/health check across every active source.
//
// Key refinement: a stale last_scraped_at is NOT evidence of a problem.
// poll-audit-firm-repos only re-scrapes a GitHub source when the repo's
// pushed_at is newer than our last scrape, so "quiet" almost always means the
// firm published nothing. We therefore check pushed_at and SUPPRESS the quiet
// warning when upstream is unchanged, and only warn when the repo HAS changed
// and we still have not picked it up -- a genuine capture gap.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("CRON_KEY") || "";
const SLACK_SECRET = Deno.env.get("SLACK_WEBHOOK_URL") || "";
const GH_TOKEN = Deno.env.get("GITHUB_TOKEN") || "";

function json(s: number, b: unknown) {
  return new Response(JSON.stringify(b, null, 2), { status: s, headers: { "Content-Type": "application/json" } });
}
function ghHeaders(): HeadersInit {
  const h: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "AuditScope-Monitor/1.0" };
  if (GH_TOKEN) h.Authorization = `Bearer ${GH_TOKEN}`;
  return h;
}
async function pushedAt(owner: string, repo: string): Promise<string | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: ghHeaders() });
    if (!r.ok) return null;
    return ((await r.json()) as { pushed_at?: string }).pushed_at ?? null;
  } catch { return null; }
}

type Row = {
  slug: string; source_type: string; gh_owner: string | null; gh_repo: string | null;
  last_scraped_at: string | null; days_quiet: number | null;
  audits_7d: number; audits_30d: number; total_rows: number;
  last_catalog: number | null; last_inserted: number | null; last_dupes: number;
  dry_streak: number; provisional_status: string; provisional_reason: string | null;
};


// ---------------------------------------------------------------------------
// job: "discover" — weekly auditor discovery. Folded in here because the
// project is at its 100-function ceiling. Proposes only: every hit lands in
// auditor_candidates for human vetting; nothing is ever written to
// audit_sources automatically.
// ---------------------------------------------------------------------------
const SEARCHES = [
  "audit-reports in:name", "audit-report in:name", "smart-contract-audits in:name",
  "public-audits in:name", "security-reviews in:name", "security-audits in:name",
];
const NOT_A_FIRM = /^(awesome|solidity|ethereum|defi|blockchain|crypto|web3|smart)/i;
function normName(x: string): string { return x.toLowerCase().replace(/[^a-z0-9]+/g, ""); }

async function runDiscovery(svc: any) {
  const t0 = Date.now();
  const known = new Set<string>();
  const { data: srcs } = await svc.from("audit_sources").select("slug, firm_name, source_config");
  for (const s2 of (srcs ?? [])) {
    known.add(normName(String(s2.firm_name ?? ""))); known.add(normName(String(s2.slug ?? "")));
    const cfg = s2.source_config || null;
    if (cfg && cfg.owner) known.add(normName(cfg.owner));
    if (cfg && cfg.org) known.add(normName(cfg.org));
  }
  const { data: meta } = await svc.from("audit_firm_meta").select("firm_name");
  for (const f of (meta ?? [])) known.add(normName(f.firm_name));

  const cands: Array<{ name: string; evidence_url: string; source: string; hits: number }> = [];
  const { data: mined } = await svc.rpc("mine_auditor_candidates", { p_min_hits: 2 });
  for (const m of (mined ?? [])) {
    if (known.has(normName(m.cand))) continue;
    cands.push({ name: m.cand, evidence_url: m.evidence, source: "report_filename", hits: Number(m.hits) });
  }

  let searched = 0;
  for (const q of SEARCHES) {
    try {
      const hdr: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "AuditScope-Discovery/1.0" };
      if (GH_TOKEN) hdr.Authorization = "Bearer " + GH_TOKEN;
      const r = await fetch("https://api.github.com/search/repositories?q=" + encodeURIComponent(q) + "&sort=stars&per_page=50", { headers: hdr });
      if (!r.ok) continue;
      searched++;
      const items = ((await r.json()) || {}).items || [];
      for (const it of items) {
        const owner = (it.owner && it.owner.login) ? it.owner.login : String(it.full_name || "").split("/")[0];
        if (!owner || NOT_A_FIRM.test(owner) || known.has(normName(owner))) continue;
        cands.push({ name: owner, evidence_url: it.html_url, source: "github_search", hits: 1 + (it.stargazers_count || 0) });
      }
    } catch (_e) { /* one bad query must not kill the run */ }
    await new Promise((res) => setTimeout(res, 1200));
  }

  // name_key is a GENERATED column, so it cannot be a PostgREST conflict
  // target -- the upsert failed silently. Read the existing keys once, filter
  // in memory, then plain-insert only what is new.
  const existing = new Set<string>();
  const { data: cur } = await svc.from("auditor_candidates").select("name_key, source");
  for (const e of (cur ?? [])) existing.add(String(e.name_key) + "|" + String(e.source));

  const seen = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  for (const c of cands) {
    const nk = normName(c.name);
    if (!nk) continue;
    const k = nk + "|" + c.source;
    if (seen.has(k) || existing.has(k)) continue;
    seen.add(k);
    rows.push({ name: c.name, evidence_url: c.evidence_url, source: c.source, hits: c.hits });
  }
  let inserted = 0;
  const insErrors: string[] = [];
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await svc.from("auditor_candidates").insert(chunk);
    if (error) { if (insErrors.length < 3) insErrors.push(error.message.slice(0, 140)); }
    else inserted += chunk.length;
  }
  const bumped = cands.length - rows.length;
  const { count } = await svc.from("auditor_candidates").select("id", { count: "exact", head: true }).eq("status", "new");
  return { ok: true, job: "discover", searches_run: searched, considered: cands.length,
           inserted: inserted, bumped: bumped, insert_errors: insErrors, pending_review: count ?? null, elapsed_ms: Date.now() - t0 };
}

Deno.serve(async (req) => {
  if (CRON_KEY === "" || req.headers.get("x-cron-key") !== CRON_KEY) return json(401, { error: "Unauthorized" });
  const t0 = Date.now();
  const body = (await req.json().catch(() => ({}))) as { test_alert?: boolean; job?: string };
  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  if (body.job === "discover") return json(200, await runDiscovery(svc));

  const { data, error } = await svc.rpc("compute_source_health");
  if (error) return json(500, { error: "compute_failed", detail: error.message });
  const rows = (data ?? []) as Row[];

  let suppressed = 0, ghChecked = 0;
  const logRows: Record<string, unknown>[] = [];
  const issues: Array<{ slug: string; status: string; reason: string }> = [];

  for (const r of rows) {
    let status = r.provisional_status;
    let reason = r.provisional_reason;

    // Only the "quiet" verdicts are refutable by upstream state; a dry-run
    // streak or a never-scraped source is a real problem regardless.
    const isQuiet = !!reason && reason.startsWith("no new audits");
    if (isQuiet && r.gh_owner && r.gh_repo && r.last_scraped_at) {
      ghChecked++;
      const p = await pushedAt(r.gh_owner, r.gh_repo);
      if (p) {
        if (new Date(p).getTime() <= new Date(r.last_scraped_at).getTime()) {
          status = "ok";
          reason = `quiet but upstream unchanged (pushed_at ${p.slice(0, 10)} <= last scrape)`;
          suppressed++;
        } else {
          reason = `UPSTREAM CHANGED ${p.slice(0, 10)} but not scraped since ${r.last_scraped_at.slice(0, 10)}`;
          status = (r.days_quiet ?? 0) >= 30 ? "alert" : "warning";
        }
      }
    }

    logRows.push({
      slug: r.slug, last_scraped_at: r.last_scraped_at, days_quiet: r.days_quiet,
      audits_7d: r.audits_7d, audits_30d: r.audits_30d,
      last_catalog: r.last_catalog, last_inserted: r.last_inserted, last_dupes: r.last_dupes,
      dry_run: (r.last_catalog ?? 0) > 0 && r.last_inserted === 0 && r.last_dupes === 0,
      status, reason,
    });
    if (status !== "ok") issues.push({ slug: r.slug, status, reason: reason ?? "" });
  }

  for (let i = 0; i < logRows.length; i += 100) {
    await svc.from("source_health_log").insert(logRows.slice(i, i + 100));
  }

  const alerts = issues.filter((i) => i.status === "alert");
  const warnings = issues.filter((i) => i.status === "warning");

  // Ops alerts go to the ops channel only. If SLACK_WEBHOOK_URL is missing the
  // alert is skipped and reported in the response; it must never fall back to
  // a customer's saved webhook.
  const webhook = SLACK_SECRET;

  let slack_sent = false, slack_error: string | null = null;
  if ((body.test_alert || issues.length > 0) && webhook) {
    const lines: string[] = [];
    if (body.test_alert) lines.push("*AuditScope monitor — test alert* (no action needed)");
    lines.push(`*Source health* — ${alerts.length} alert(s), ${warnings.length} warning(s), ${suppressed} quiet-but-unchanged suppressed`);
    for (const a of alerts.slice(0, 15)) lines.push(`:red_circle: *${a.slug}* — ${a.reason}`);
    for (const w of warnings.slice(0, 15)) lines.push(`:warning: ${w.slug} — ${w.reason}`);
    try {
      const r = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: lines.join("\n") }) });
      slack_sent = r.ok;
      if (!r.ok) slack_error = `slack ${r.status}`;
    } catch (e) { slack_error = String(e).slice(0, 150); }
  }

  return json(200, {
    ok: true, sources: rows.length, alerts: alerts.length, warnings: warnings.length,
    suppressed_quiet_but_unchanged: suppressed, github_checked: ghChecked,
    slack_configured: !!webhook, slack_sent, slack_error,
    issues: issues.slice(0, 12), elapsed_ms: Date.now() - t0,
  });
});
