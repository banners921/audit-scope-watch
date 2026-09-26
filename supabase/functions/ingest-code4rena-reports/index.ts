// ingest-code4rena-reports — lists every code-423n4/*-findings repo, fetches report.md
// (when present), parses frontmatter for protocol slug/date, parses body for [C-XX]/[H-XX]
// /[M-XX]/[L-XX] individual finding tags. Inserts audit_history + audit_findings_detail rows.
// ZERO LLM COST. Pure markdown parsing.
// v5 — list repos NEWEST-FIRST (sort=created desc) so offset:0 catches new contests.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }
function slugify(s: string): string { return (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }

async function listFindingsRepos(ghToken: string | null): Promise<Array<{ name: string; updated_at: string }>> {
  const out: Array<{ name: string; updated_at: string }> = [];
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "AuditScope/1.0" };
  if (ghToken) headers.Authorization = `token ${ghToken}`;
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`https://api.github.com/orgs/code-423n4/repos?per_page=100&page=${page}&type=public&sort=created&direction=desc`, { headers });
    if (!r.ok) break;
    const arr = (await r.json()) as any[];
    if (!Array.isArray(arr) || arr.length === 0) break;
    for (const repo of arr) {
      if (repo.name && /-findings$/i.test(repo.name) && !repo.archived) {
        out.push({ name: repo.name, updated_at: repo.updated_at || repo.pushed_at });
      }
    }
    if (arr.length < 100) break;
  }
  return out;
}

function parseFrontmatter(md: string): { meta: Record<string, string>; body: string } {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: md };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([a-zA-Z_]+)\s*:\s*"?([^"]*?)"?\s*$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2];
  }
  return { meta, body: m[2] };
}

const SEV_TAG_TO_NAME: Record<string, string> = {
  c: "critical", h: "high", m: "medium", l: "low", i: "informational", g: "gas", q: "qa",
};

type ParsedFinding = { severity: string; title: string; summary: string; status: string | null };

function parseFindings(body: string): ParsedFinding[] {
  const out: ParsedFinding[] = [];
  const lines = body.split(/\r?\n/);
  let current: { sev: string; title: string; body: string[] } | null = null;
  function flush() {
    if (!current) return;
    const sev = SEV_TAG_TO_NAME[current.sev.toLowerCase()] || null;
    if (!sev) { current = null; return; }
    const summary = current.body.join(" ").replace(/\s+/g, " ").trim().slice(0, 800);
    const status = (() => {
      const blob = current!.body.join(" ").toLowerCase();
      if (/\bfixed\b|\bresolved\b|\bmitigated\b/.test(blob)) return "fixed";
      if (/\backnowledged\b/.test(blob)) return "acknowledged";
      if (/\bwon'?t\s*fix\b|\bwontfix\b/.test(blob)) return "wontfix";
      return null;
    })();
    out.push({ severity: sev, title: current.title.slice(0, 300), summary, status });
    current = null;
  }
  for (const raw of lines) {
    const m = raw.match(/^#{1,4}\s*(?:\[)?([CHMLIGQchmligq])-\d{1,3}(?:\])?\s*[:\-\.\)\s]*(.+?)\s*$/);
    if (m) {
      flush();
      const titleClean = m[2].replace(/\[[^\]]+\]/g, "").trim();
      current = { sev: m[1], title: titleClean || `Finding ${m[1].toUpperCase()}`, body: [] };
      continue;
    }
    if (current) {
      if (/^#{1,4}\s/.test(raw)) { flush(); continue; }
      current.body.push(raw);
      if (current.body.join(" ").length > 2000) { /* cap mem */ }
    }
  }
  flush();
  const seen = new Set<string>();
  return out.filter(f => {
    const k = `${f.severity}|${f.title.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function fetchReportMd(repo: string): Promise<string | null> {
  for (const branch of ["main", "master"]) {
    const url = `https://raw.githubusercontent.com/code-423n4/${repo}/${branch}/report.md`;
    try {
      const r = await fetch(url, { headers: { "User-Agent": "AuditScope/1.0" } });
      if (r.ok) {
        const txt = await r.text();
        if (txt.length > 500) return txt;
      }
    } catch { /* */ }
  }
  return null;
}

function inferProtocolName(meta: Record<string, string>, repo: string): string {
  if (meta.sponsor) return meta.sponsor;
  if (meta.title) return meta.title.replace(/\s*(contest|audit|review)\s*$/i, "").trim();
  const m = repo.match(/^\d{4}-\d{2}-(.+)-findings$/i);
  return m ? m[1].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : repo;
}
function inferProtocolSlug(meta: Record<string, string>, repo: string): string {
  if (meta.sponsor) return slugify(meta.sponsor);
  const m = repo.match(/^\d{4}-\d{2}-(.+)-findings$/i);
  if (m) return slugify(m[1]);
  return slugify(repo);
}
function inferDate(meta: Record<string, string>, repo: string): string | null {
  if (meta.date && /^\d{4}-\d{2}-\d{2}$/.test(meta.date)) return meta.date;
  const m = repo.match(/^(\d{4})-(\d{2})-/);
  if (m) return `${m[1]}-${m[2]}-15`;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ghToken = Deno.env.get("GITHUB_TOKEN") || null;
  const cronKey = req.headers.get("x-cron-key") || "";
  if (cronKey !== CRON_KEY) return json(401, { error: "Unauthorized" });
  const admin = createClient(supabaseUrl, serviceKey);
  const body = (await req.json().catch(() => ({}))) as { limit?: number; offset?: number; force?: boolean };
  const limit = Math.min(Math.max(body.limit ?? 30, 1), 60);
  const offset = body.offset ?? 0;
  const force = !!body.force;

  const repos = await listFindingsRepos(ghToken);
  if (repos.length === 0) return json(502, { error: "github list failed" });
  const slice = repos.slice(offset, offset + limit);

  let totalRepos = repos.length, processed = 0, parsed = 0, audits_inserted = 0, audits_existing = 0, findings_inserted = 0, no_report = 0;
  const samples: any[] = [];
  for (const repo of slice) {
    processed++;
    const reportUrl = `https://raw.githubusercontent.com/code-423n4/${repo.name}/main/report.md`;
    if (!force) {
      const { data: existing } = await admin.from("audit_history").select("id").eq("report_url", reportUrl).maybeSingle();
      if (existing) { audits_existing++; continue; }
    }
    const md = await fetchReportMd(repo.name);
    if (!md) { no_report++; continue; }
    parsed++;
    const { meta, body: mdBody } = parseFrontmatter(md);
    const protocolName = inferProtocolName(meta, repo.name);
    const protocolSlug = inferProtocolSlug(meta, repo.name);
    const auditDate = inferDate(meta, repo.name);
    const findings = parseFindings(mdBody);
    const counts = { critical: 0, high: 0, medium: 0, low: 0, informational: 0, gas: 0 };
    for (const f of findings) { (counts as any)[f.severity] = ((counts as any)[f.severity] ?? 0) + 1; }

    if (protocolSlug) {
      const { data: comp } = await admin.from("companies").select("slug").eq("slug", protocolSlug).maybeSingle();
      if (!comp) {
        await admin.from("companies").insert({ slug: protocolSlug, name: protocolName, data_source: "code4rena_report_ingest" });
      }
    }

    const { data: audit, error: audErr } = await admin.from("audit_history").insert({
      company_slug: protocolSlug,
      protocol_name: protocolName,
      audit_firm: "Code4rena",
      audit_type: "contest",
      audit_date: auditDate,
      report_url: reportUrl,
      findings_critical: counts.critical,
      findings_high: counts.high,
      findings_medium: counts.medium,
      findings_low: counts.low,
      findings_informational: counts.informational,
      findings_gas: counts.gas,
      findings_extracted_at: new Date().toISOString(),
      findings_extraction_status: "extracted",
      ai_summary: meta.title || `${protocolName} Code4rena contest report`,
      data_source: "code4rena_report_ingest",
    }).select("id").maybeSingle();
    if (audErr || !audit) { continue; }
    audits_inserted++;

    if (findings.length > 0) {
      const detailRows = findings.slice(0, 200).map(f => ({
        audit_id: audit.id,
        company_slug: protocolSlug,
        severity: f.severity,
        title: f.title,
        summary: f.summary || null,
        status: f.status,
      }));
      const { error: detErr } = await admin.from("audit_findings_detail").insert(detailRows);
      if (!detErr) findings_inserted += detailRows.length;
    }
    if (samples.length < 5) samples.push({ repo: repo.name, protocol: protocolName, findings: findings.length });
  }

  return json(200, { ok: true, total_repos: totalRepos, processed, parsed, audits_inserted, audits_existing, findings_inserted, no_report, samples, next_offset: offset + limit });
});
