// v21 — Adds audit_date extraction. Prompt asks Haiku for the report's actual audit date;
// strict YYYY-MM-DD validation + reasonable range (2018..today+30d).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }
const TEXT_MAX_CHARS = 220_000;

function toRawUrl(url: string): string {
  const m = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)$/);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
  return url;
}
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function fetchMarkdown(url: string): Promise<{ text: string } | { error: string }> { try { const r = await fetch(toRawUrl(url), { headers: { "User-Agent": "auditscope-extractor" } }); if (!r.ok) return { error: `http ${r.status}` }; const text = await r.text(); if (text.length < 200) return { error: "too short" }; return { text: text.slice(0, TEXT_MAX_CHARS) }; } catch (e) { return { error: `fetch err: ${String(e).slice(0, 100)}` }; } }
// Jina's keyed plan is out of credits, and sending the exhausted key makes the
// request fail (402) where an anonymous one succeeds on the free tier — so a
// keyed 401/402/403 is retried with no Authorization header rather than being
// treated as a dead end. Verified against hacken.io report pages, which return
// full findings text anonymously.
async function jinaAttempt(url: string, useKey: boolean): Promise<Response | null> {
  const headers: Record<string, string> = { "User-Agent": "AuditScope/1.0", "X-Return-Format": "text" };
  const jinaKey = useKey ? Deno.env.get("JINA_API_KEY") : null;
  if (jinaKey) headers.Authorization = `Bearer ${jinaKey}`;
  try { return await fetch(`https://r.jina.ai/${toRawUrl(url)}`, { headers }); } catch { return null; }
}

async function fetchViaJina(url: string, attempt = 1): Promise<{ text: string } | { error: string; rateLimited?: boolean }> {
  try {
    let r = await jinaAttempt(url, true);
    // 402 = credits exhausted, 401/403 = key rejected. None of these mean the
    // page is unreachable, so fall back to an anonymous request.
    if (r && (r.status === 402 || r.status === 401 || r.status === 403) && Deno.env.get("JINA_API_KEY")) {
      const anon = await jinaAttempt(url, false);
      if (anon) r = anon;
    }
    if (!r) return { error: "jina err: request failed" };
    if (r.ok) {
      const txt = await r.text();
      if (txt && txt.length > 300) return { text: txt.slice(0, TEXT_MAX_CHARS) };
      return { error: "jina too short" };
    }
    if ((r.status === 401 || r.status === 429) && attempt < 3) {
      const delay = 2000 * attempt + Math.floor(Math.random() * 2000);
      await sleep(delay);
      return fetchViaJina(url, attempt + 1);
    }
    return { error: `jina ${r.status}`, rateLimited: (r.status === 401 || r.status === 429) };
  } catch (e) { return { error: `jina err: ${String(e).slice(0, 100)}` }; }
}
async function fetchViaFirecrawl(url: string, apiKey: string): Promise<{ text: string } | { error: string }> { try { const targetUrl = toRawUrl(url); const isJsHeavy = /hacken\.io|hashlock\.com|cantina\.xyz|certik\.com/i.test(targetUrl); const r = await fetch("https://api.firecrawl.dev/v1/scrape", { method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ url: targetUrl, formats: ["markdown"], waitFor: isJsHeavy ? 5000 : 2000, timeout: 90000 }) }); if (!r.ok) { const t = await r.text().catch(() => ""); return { error: `firecrawl ${r.status}: ${t.slice(0, 80)}` }; } const j = await r.json(); const md = j?.data?.markdown || j?.markdown || ""; if (!md || md.length < 200) return { error: "firecrawl text too short" }; return { text: String(md).slice(0, TEXT_MAX_CHARS) }; } catch (e) { return { error: `firecrawl err: ${String(e).slice(0, 100)}` }; } }
async function fetchHtmlDirect(url: string): Promise<{ text: string } | { error: string }> { try { const r = await fetch(toRawUrl(url), { headers: { "User-Agent": "Mozilla/5.0 (auditscope)" }, redirect: "follow" }); if (!r.ok) return { error: `http ${r.status}` }; const html = await r.text(); if (html.length < 500) return { error: "html too short" }; const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim(); if (stripped.length < 200) return { error: "html text too short" }; return { text: stripped.slice(0, TEXT_MAX_CHARS) }; } catch (e) { return { error: `html err: ${String(e).slice(0, 100)}` }; } }
async function fetchWayback(url: string): Promise<{ archived_url: string } | null> { try { const r = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`); if (!r.ok) return null; const j = await r.json(); const archived = j?.archived_snapshots?.closest?.url; if (archived && j.archived_snapshots.closest.available) return { archived_url: String(archived) }; return null; } catch { return null; } }

const SYSTEM_PROMPT = `You extract structured data from web3 smart-contract security review documents (audits, pentest reports, letters of attestation, contest reports, security reviews — ALL count as audits).

Return ONLY a JSON object (no prose, no markdown fences):
{
  "audit_date": string | null,  // YYYY-MM-DD. The audit report's COMPLETION / PUBLICATION date. Look for: cover page date, version date, "Date:" field, copyright year. If only year is shown, use YYYY-01-01. If only year+month, use YYYY-MM-01. Null only if absolutely no date is present.
  "findings_critical": number, "findings_high": number, "findings_medium": number,
  "findings_low": number, "findings_informational": number, "findings_gas": number,
  "ai_summary": string, "audit_methodology": string | null,
  "files_audited_count": number | null, "loc_audited": number | null,
  "smart_contract_language": string | null,
  "audited_repo_url": string | null, "audited_commit_hash": string | null,
  "audited_files": string[], "audited_chains": string[],
  "top_findings": [{ "severity": "critical|high|medium|low|informational|gas", "title": string, "summary": string, "status": "fixed|acknowledged|open|wontfix|unknown" }],
  "addresses_referenced": string[]
}

WHAT COUNTS AS AN AUDIT (accept ALL):
- Full audit reports, letters of attestation, pentest reports, contest reports, security reviews. Marketing pages listing audits.
- Zero findings is valid.
- Be CONSERVATIVE about rejecting. Only NOT_AN_AUDIT_REPORT for: homepage/blog, README/license with no audit info, 404 page, folder listings, firm services pages.

AUDIT_DATE: Search the FIRST page / cover / header for a date. Common formats: 'January 15, 2024', '2024-01-15', '15/01/2024', 'Q1 2024'. Always output YYYY-MM-DD. If only quarter, use first day of that quarter.
FINDING COUNTS: Look for [C-XX], [H-XX], [M-XX], [L-XX] tags, severity headings, or prose counts. Skip TOC/definitions.
STATUS: "Fixed", "Acknowledged", "Won't fix" → lowercase; default "unknown".
REPO + COMMIT: Hunt for github.com URLs in Scope/Repository/In Scope sections. Skip firm's own publications repo. Commit hash = 7–64 hex chars near repo URL.
AUDITED FILES: Solidity/Rust/Move/Cairo paths from scope. Skip tests/scripts. Max 30.
AUDITED CHAINS: lowercased canonical names (ethereum, bsc, polygon, arbitrum, base, optimism, solana, sui, aptos, etc.).`;

function extractJson(s: string): any { if (!s) return null; const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i); const candidate = fenced ? fenced[1] : s; const start = candidate.indexOf("{"); const end = candidate.lastIndexOf("}"); if (start < 0 || end <= start) return null; const slice = candidate.slice(start, end + 1); try { return JSON.parse(slice); } catch {} try { return JSON.parse(s); } catch { return null; } }

async function extractWithAnthropic(apiKey: string, text: string): Promise<any> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5", max_tokens: 4500, system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Extract data from this security review:\n\n${text}` }],
    }),
  });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`Anthropic ${r.status}: ${t.slice(0, 320)}`); }
  const j = await r.json();
  return extractJson(j?.content?.[0]?.text || "");
}

/**
 * True for a firm URL that is a LISTING of a company's audits, not a report.
 * hacken.io/audits/<company> shows links to that company's reports and no
 * findings of its own, so no fetcher at any price can extract anything from it
 * — Firecrawl returned 402 on 869 of these, and Jina "succeeds" on them with
 * ~2KB of nav chrome and a cookie banner, which would sail past the length
 * check and be billed to the model as if it were a report. Excluded outright.
 * A deeper path (hacken.io/audits/<company>/<report>/) IS a report page.
 */
function isNonReportListing(url: string): boolean {
  return /^https?:\/\/(?:www\.)?hacken\.io\/audits\/[^/?#]+\/?(?:[?#].*)?$/i.test(String(url ?? ""));
}

async function fetchAny(url: string, firecrawlKey: string | null): Promise<{ text: string; source: string } | { error: string; rateLimited?: boolean }> {
  const isPdf = /\.pdf($|\?)/i.test(url);
  const isMarkdown = /\.md($|\?)/i.test(url) || /\/blob\/.*\/README\.md/i.test(url);
  const isFirmLanding = /hacken\.io\/audits|hashlock\.com\/audits|cantina\.xyz\/portfolio|certik\.com/i.test(url);
  if (isMarkdown) { const r = await fetchMarkdown(url); if (!("error" in r)) return { text: r.text, source: "md" }; const j = await fetchViaJina(url); if (!("error" in j)) return { text: j.text, source: "jina-md" }; if (r.error.includes("404") || r.error.startsWith("http 4")) { const wb = await fetchWayback(url); if (wb) { const w = await fetchMarkdown(wb.archived_url); if (!("error" in w)) return { text: w.text, source: "md+wayback" }; } } return { error: r.error }; }
  if (isPdf) { const j = await fetchViaJina(url); if (!("error" in j)) return { text: j.text, source: "jina-pdf" }; if (firecrawlKey) { const fc = await fetchViaFirecrawl(url, firecrawlKey); if (!("error" in fc)) return { text: fc.text, source: "firecrawl-pdf" }; } return { error: j.error, rateLimited: j.rateLimited }; }
  // Firm landing pages used to go straight to Firecrawl with no fallback, which
  // is why every one of them failed once its credits ran out. Jina renders
  // these fine — verified on hacken.io/audits/<company>/<report>/ (severity
  // table, scores, findings) and cantina.xyz/portfolio/<id> (27KB, commits) —
  // and costs nothing, so it goes first. Direct fetch is still skipped: Hacken
  // answers a plain request with 403 behind Cloudflare.
  if (isFirmLanding) {
    const j = await fetchViaJina(url);
    if (!("error" in j)) return { text: j.text, source: "jina-firm" };
    if (firecrawlKey) {
      const fc = await fetchViaFirecrawl(url, firecrawlKey);
      if (!("error" in fc)) return { text: fc.text, source: "firecrawl-firm" };
      return { error: `${j.error}; ${fc.error}` };
    }
    return { error: j.error, rateLimited: j.rateLimited };
  }
  const html = await fetchHtmlDirect(url); if (!("error" in html)) return { text: html.text, source: "html" };
  const j = await fetchViaJina(url); if (!("error" in j)) return { text: j.text, source: "jina-html" };
  if (firecrawlKey) { const fc = await fetchViaFirecrawl(url, firecrawlKey); if (!("error" in fc)) return { text: fc.text, source: "firecrawl-html" }; }
  return { error: html.error };
}

// Strict date validator: must be YYYY-MM-DD, must parse, must be in 2018..now+30d
function validAuditDate(s: any): string | null {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = +m[1], month = +m[2], day = +m[3];
  if (year < 2018 || year > new Date().getFullYear() + 1) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  if (isNaN(d.getTime())) return null;
  if (d.getTime() > Date.now() + 30 * 86400_000) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * True when a failure is an account-level outage rather than anything about
 * this row: exhausted credits or a throughput cap on Anthropic, Jina or
 * Firecrawl. These must never produce a terminal per-row status. Marking them
 * terminal would convert one billing lapse into thousands of permanently
 * abandoned rows — measured at 25 rows per two-minute cron tick against a
 * 9,610-row backfill pool, so the whole pool inside a day.
 */
function isTransientOutage(err: string): boolean {
  return /credit balance is too low|insufficient credits|Anthropic (429|529)|\b402\b|rate limit|throughput limit|quota/i.test(err);
}

/**
 * Record a failed extraction attempt.
 *
 * The bug this replaces: every failure branch wrote the status as
 *   isRepoBackfill ? 'extracted' : <the real failure>
 * so in repo-backfill mode a failed fetch or a refused model call was recorded
 * as a successful extraction. That is what made 30 rows look freshly extracted
 * in a 24h window in which the Anthropic key had no credit at all.
 *
 * Fixed in both directions rather than by writing llm_failed everywhere:
 *   - Normal mode (the row has never been extracted): write the real failure
 *     status, so nothing claims success.
 *   - Repo-backfill mode: the row was ALREADY successfully extracted — that is
 *     the pool's entry condition — and all 9,610 such rows carry real findings
 *     counts that feed compute-risk-scores, Prospects, Compare, AuditorIntel
 *     and LPReport, every one of which filters on findings_extraction_status
 *     being 'extracted'. Overwriting that would not be more honest, it would be
 *     a different untruth, and it would silently drop those audits out of risk
 *     scoring and customer reports. So the findings status is left alone and
 *     the failure is recorded against the thing that actually failed — the repo
 *     backfill — reusing the existing repo_url_status vocabulary. That also
 *     lifts the row out of the retry_no_repo pool, ending an unbounded retry.
 */
async function recordFailure(
  admin: any,
  rowId: string,
  isRepoBackfill: boolean,
  status: string,
  dryRun: boolean,
) {
  if (dryRun) return;
  if (isRepoBackfill) {
    await admin.from("audit_history")
      .update({ repo_url_status: "repo_backfill_failed" })
      .eq("id", rowId);
    return;
  }
  await admin.from("audit_history")
    .update({ findings_extraction_status: status, findings_extracted_at: new Date().toISOString() })
    .eq("id", rowId);
}

async function processOne(admin: any, anthropicKey: string | null, firecrawlKey: string | null, row: any, dryRun: boolean, isRepoBackfill: boolean) {
  if (isNonReportListing(row.report_url)) {
    if (!dryRun) await admin.from("audit_history").update({ findings_extraction_status: "no_report_on_page", findings_extracted_at: new Date().toISOString() }).eq("id", row.id);
    return { kind: "no_report_on_page" as const };
  }
  const fetched = await fetchAny(row.report_url, firecrawlKey);
  if ("error" in fetched) { if ((fetched as any).rateLimited || isTransientOutage(String((fetched as any).error ?? ""))) { if (!dryRun && !isRepoBackfill) await admin.from("audit_history").update({ findings_extraction_status: null, findings_extracted_at: null }).eq("id", row.id); return { kind: "rate_limited" as const }; } await recordFailure(admin, row.id, isRepoBackfill, `fetch_failed:${fetched.error.slice(0, 60)}`, dryRun); return { kind: "fetch_error" as const, error: fetched.error }; }
  let parsed: any; try { parsed = await extractWithAnthropic(anthropicKey!, fetched.text); } catch (e) { const errStr = String(e); if (isTransientOutage(errStr)) { if (!dryRun && !isRepoBackfill) await admin.from("audit_history").update({ findings_extraction_status: null, findings_extracted_at: null }).eq("id", row.id); return { kind: "rate_limited" as const }; } await recordFailure(admin, row.id, isRepoBackfill, `llm_failed:${errStr.slice(0, 350)}`, dryRun); return { kind: "parse_error" as const, error: errStr.slice(0, 200) }; }
  if (!parsed) { await recordFailure(admin, row.id, isRepoBackfill, "json_parse_failed", dryRun); return { kind: "parse_error" as const, error: "json_parse_failed" }; }
  if (parsed.ai_summary === "NOT_AN_AUDIT_REPORT") { await recordFailure(admin, row.id, isRepoBackfill, "not_audit_report", dryRun); return { kind: "not_audit" as const }; }
  let auditedFiles: string[] = []; if (Array.isArray(parsed.audited_files)) auditedFiles = parsed.audited_files.filter((f: any) => typeof f === "string" && f.length > 0 && f.length < 300).slice(0, 30);
  let auditedChains: string[] = []; if (Array.isArray(parsed.audited_chains)) auditedChains = parsed.audited_chains.filter((c: any) => typeof c === "string").map((c: string) => c.toLowerCase().trim()).filter(Boolean).slice(0, 10);
  const repoUrl = typeof parsed.audited_repo_url === "string" && /^https?:\/\//.test(parsed.audited_repo_url) ? parsed.audited_repo_url.slice(0, 500) : null;
  const commitHash = typeof parsed.audited_commit_hash === "string" && /^(0x)?[a-f0-9]{6,64}$/i.test(parsed.audited_commit_hash.trim()) ? parsed.audited_commit_hash.trim().slice(0, 80) : null;
  const auditDate = validAuditDate(parsed.audit_date);
  const update: any = isRepoBackfill
    ? { audited_repo_url: repoUrl, audited_commit_hash: commitHash, audited_files: auditedFiles.length > 0 ? auditedFiles : null, audited_chains: auditedChains.length > 0 ? auditedChains : null, findings_extraction_status: "extracted", findings_extracted_at: new Date().toISOString() }
    : {
      findings_critical: Number(parsed.findings_critical) || 0, findings_high: Number(parsed.findings_high) || 0, findings_medium: Number(parsed.findings_medium) || 0,
      findings_low: Number(parsed.findings_low) || 0, findings_informational: Number(parsed.findings_informational) || 0, findings_gas: Number(parsed.findings_gas) || 0,
      ai_summary: typeof parsed.ai_summary === "string" ? parsed.ai_summary.slice(0, 400) : null,
      audit_methodology: parsed.audit_methodology || null,
      files_audited_count: parsed.files_audited_count || null,
      audit_loc: parsed.loc_audited || null,
      smart_contract_language: parsed.smart_contract_language || null,
      audited_repo_url: repoUrl, audited_commit_hash: commitHash,
      audited_files: auditedFiles.length > 0 ? auditedFiles : null, audited_chains: auditedChains.length > 0 ? auditedChains : null,
      findings_extracted_at: new Date().toISOString(), findings_extraction_status: "extracted",
    };
  // Only set audit_date if (a) we got one from Haiku AND (b) it's not already populated (don't overwrite existing data)
  if (auditDate && !row.audit_date) update.audit_date = auditDate;
  if (isRepoBackfill && auditDate && !row.audit_date) update.audit_date = auditDate;  // repo backfill mode can also fill missing dates
  if (!dryRun) {
    await admin.from("audit_history").update(update).eq("id", row.id);
    if (!isRepoBackfill) {
      const findings = Array.isArray(parsed.top_findings) ? parsed.top_findings.slice(0, 12) : [];
      const detailRows = findings.filter((f: any) => f.severity && f.title).map((f: any) => ({ audit_id: row.id, company_slug: row.company_slug, severity: ["critical","high","medium","low","informational","gas"].includes(String(f.severity).toLowerCase()) ? String(f.severity).toLowerCase() : "unknown", title: String(f.title).slice(0, 300), summary: f.summary ? String(f.summary).slice(0, 800) : null, status: ["fixed","acknowledged","open","wontfix"].includes(String(f.status).toLowerCase()) ? String(f.status).toLowerCase() : null, affected_addresses: Array.isArray(parsed.addresses_referenced) ? parsed.addresses_referenced.slice(0, 20) : null, }));
      if (detailRows.length > 0) await admin.from("audit_findings_detail").insert(detailRows);
    }
  }
  return { kind: "extracted" as const, critical: Number(parsed.findings_critical) || 0, high: Number(parsed.findings_high) || 0, source: (fetched as any).source, provider: "anthropic", repo: repoUrl, date: auditDate };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL"); const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") || null;
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") || null;
  if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Missing supabase env" });
  if (!anthropicKey) return json(500, { error: "Missing ANTHROPIC_API_KEY" });
  const cronKey = req.headers.get("x-cron-key") || ""; const authHeader = req.headers.get("Authorization") || "";
  if (cronKey !== CRON_KEY) { if (!authHeader) return json(401, { error: "Unauthorized" }); const u = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } }); const { data } = await u.auth.getUser(); if (!data?.user) return json(401, { error: "Unauthorized" }); }
  const admin = createClient(supabaseUrl, serviceKey);
  const body = (await req.json().catch(() => ({}))) as { limit?: number; firm?: string; audit_id?: string; dry_run?: boolean; format?: "md" | "pdf" | "html" | "non_pdf" | "any"; parallel?: number; retry_failed?: boolean; retry_not_audit?: boolean; retry_no_repo?: boolean; backfill_dates?: boolean };
  const limit = Math.min(Math.max(body.limit ?? 5, 1), 60);
  const dryRun = body.dry_run === true; const format = body.format || "any";
  const parallelism = Math.min(Math.max(body.parallel ?? 5, 1), 10);
  const isRepoBackfill = !!body.retry_no_repo;

  // New backfill_dates mode: directly query audits with NULL audit_date + extracted findings + report_url
  if (body.backfill_dates) {
    const { data: rows } = await admin.from("audit_history")
      .select("id, audit_firm, protocol_name, company_slug, report_url, audit_date")
      .is("audit_date", null)
      .not("report_url", "is", null)
      .neq("data_source", "solodit_ingest")
      .limit(limit);
    if (!rows || rows.length === 0) return json(200, { ok: true, scanned: 0, note: "no candidates" });
    let dates_filled = 0;
    for (let i = 0; i < rows.length; i += parallelism) {
      const batch = rows.slice(i, i + parallelism);
      const results = await Promise.all(batch.map((row: any) => processOne(admin, anthropicKey, firecrawlKey, row, dryRun, false)));
      for (const r of results) if (r.kind === "extracted" && (r as any).date) dates_filled++;
    }
    return json(200, { ok: true, scanned: rows.length, dates_filled });
  }

  if (body.audit_id) {
    const { data: row } = await admin.from("audit_history").select("id, audit_firm, protocol_name, company_slug, report_url, audit_date").eq("id", body.audit_id).maybeSingle();
    if (!row) return json(404, { error: "not found" });
    const r = await processOne(admin, anthropicKey, firecrawlKey, row, dryRun, isRepoBackfill);
    return json(200, { ok: true, result: r });
  }
  const { data: rows, error } = await admin.rpc("claim_audits_for_extraction", { n: limit, p_format: format, p_retry_failed: !!body.retry_failed, p_retry_not_audit: !!body.retry_not_audit, p_retry_no_repo: isRepoBackfill });
  if (error) return json(500, { error: error.message });
  if (!rows || rows.length === 0) return json(200, { ok: true, scanned: 0, note: "no candidates" });
  let firmFiltered = rows;
  if (body.firm) firmFiltered = rows.filter((r: any) => r.audit_firm === body.firm);
  let extracted = 0, fetchErrors = 0, parseErrors = 0, notAudits = 0, rateLimited = 0, criticalFound = 0, highFound = 0, repoCount = 0, dateCount = 0, noReportPages = 0;
  const sourceCounts: Record<string, number> = {};
  for (let i = 0; i < firmFiltered.length; i += parallelism) {
    const batch = firmFiltered.slice(i, i + parallelism);
    const results = await Promise.all(batch.map((row: any) => processOne(admin, anthropicKey, firecrawlKey, row, dryRun, isRepoBackfill)));
    for (const r of results) {
      if (r.kind === "extracted") { extracted++; criticalFound += r.critical; highFound += r.high; sourceCounts[r.source || "?"] = (sourceCounts[r.source || "?"] ?? 0) + 1; if (r.repo) repoCount++; if ((r as any).date) dateCount++; }
      else if (r.kind === "fetch_error") fetchErrors++;
      else if (r.kind === "parse_error") parseErrors++;
      else if (r.kind === "not_audit") notAudits++;
      else if (r.kind === "rate_limited") rateLimited++;
      else if (r.kind === "no_report_on_page") noReportPages++;
    }
  }
  return json(200, { ok: true, scanned: firmFiltered.length, extracted, fetch_errors: fetchErrors, parse_errors: parseErrors, not_audits: notAudits, rate_limited: rateLimited, no_report_pages: noReportPages, repos_captured: repoCount, dates_captured: dateCount, sources: sourceCounts, totals_found: { critical: criticalFound, high: highFound } });
});
