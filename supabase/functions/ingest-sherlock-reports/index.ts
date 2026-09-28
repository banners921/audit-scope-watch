// ingest-sherlock-reports — lists every Sherlock audit report in
// sherlock-protocol/sherlock-reports/audits, parses the markdown, inserts
// audit_history + audit_findings_detail. NO LLM cost.
// v5 — raise limit cap to 1000 so ONE cron call sweeps the whole dir (catches new files regardless of order).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }
function slugify(s: string): string { return (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }

const OWNER = "sherlock-protocol";
const REPO = "sherlock-reports";
const PATH = "audits";

type Entry = { name: string; download_url: string; html_url: string };

async function listAuditFiles(ghToken: string | null): Promise<Entry[]> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "AuditScope/1.0" };
  if (ghToken) headers.Authorization = `token ${ghToken}`;
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}?per_page=1000`, { headers });
  if (!r.ok) return [];
  const arr = (await r.json()) as any[];
  if (!Array.isArray(arr)) return [];
  return arr.filter(x => x.type === "file" && /\.(md|pdf)$/i.test(x.name)).map(x => ({ name: x.name, download_url: x.download_url, html_url: x.html_url }));
}

const SEV_TAG_TO_NAME: Record<string, string> = { c: "critical", h: "high", m: "medium", l: "low", i: "informational", g: "gas" };

function parseFindings(body: string): Array<{ severity: string; title: string; summary: string; status: string | null }> {
  const out: any[] = [];
  const lines = body.split(/\r?\n/);
  let current: { sev: string; title: string; body: string[] } | null = null;
  function flush() {
    if (!current) return;
    const sev = SEV_TAG_TO_NAME[current.sev.toLowerCase()] || null;
    if (!sev) { current = null; return; }
    const summary = current.body.join(" ").replace(/\s+/g, " ").trim().slice(0, 800);
    const blob = current.body.join(" ").toLowerCase();
    let status: string | null = null;
    if (/\bfixed\b|\bresolved\b|\bmitigated\b/.test(blob)) status = "fixed";
    else if (/\backnowledged\b/.test(blob)) status = "acknowledged";
    else if (/\bwon'?t\s*fix\b|\bwontfix\b/.test(blob)) status = "wontfix";
    out.push({ severity: sev, title: current.title.slice(0, 300), summary, status });
    current = null;
  }
  for (const raw of lines) {
    const m = raw.match(/^#{1,4}\s*\[?\s*([CHMLIGchmlig])(?:igh|edium|ow|ritical|nformational|as)?\s*[-_]\s*\d{1,3}\s*\]?\s*[:\-\.\)\s]*(.+?)\s*$/i)
             || raw.match(/^#{1,4}\s*(?:Issue|Finding)\s+([CHMLIG])\s*[-_]\s*\d{1,3}\s*[:\-\.\)\s]*(.+?)\s*$/i);
    if (m) {
      flush();
      current = { sev: m[1], title: m[2].trim() || `Finding ${m[1].toUpperCase()}`, body: [] };
      continue;
    }
    if (current) {
      if (/^#{1,4}\s/.test(raw)) { flush(); continue; }
      current.body.push(raw);
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

async function fetchText(url: string): Promise<string | null> {
  try { const r = await fetch(url, { headers: { "User-Agent": "AuditScope/1.0" } }); if (!r.ok) return null; const t = await r.text(); return t.length > 500 ? t : null; } catch { return null; }
}

// A smart-contract audit cannot predate 2015 nor be dated in the future.
const MIN_AUDIT_DATE = "2015-01-01";
function plausibleDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = Date.parse(`${d}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  if (new Date(t).toISOString().slice(0, 10) !== d) return null;   // rejects 2024-02-31
  if (d < MIN_AUDIT_DATE) return null;
  if (d > new Date().toISOString().slice(0, 10)) return null;
  return d;
}

// Sherlock names files "2022.02.09 - Final - Tempus Audit Report.pdf": the date
// separator is a DOT and the boilerplate is space-separated. The old patterns
// matched only "-"/"_" and stripped a single trailing word, so the whole
// filename survived as the protocol name AND was minted as a company
// ("2022-02-09-final-tempus-audit-report"). Some files are YYYY.DD.MM.
function inferProtocol(filename: string): { name: string; slug: string | null; date: string | null } {
  let base = filename.replace(/\.[a-z0-9]+$/i, "");
  base = base.replace(/^\d+[-_]\s*/, "");                  // leading ordinal

  let date: string | null = null;
  const dm = base.match(/(\d{4})[-_.](\d{1,2})(?:[-_.](\d{1,2}))?/);
  if (dm) {
    const a = Number(dm[2]);
    const b = dm[3] ? Number(dm[3]) : 1;
    // Whichever component is <= 12 is the month; that disambiguates YYYY.DD.MM.
    const mo = a > 12 && b <= 12 ? b : a;
    const da = a > 12 && b <= 12 ? a : b;
    date = plausibleDate(`${dm[1]}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`);
    base = base.replace(dm[0], " ");
  }

  base = base.replace(/[-_.]+/g, " ");
  base = base.replace(/(^|\s)(final|preliminary|draft)(?=\s|$)/gi, "$1");
  // Repeat so adjacent boilerplate ("Collaborative Audit Report") all goes.
  {
    const boiler = /(^|\s)(audit|audits|report|reports|review|reviews|assessment|assesment|security|collaborative|contest|fix|update|follow[\s-]?up|smart\s?contracts?)(?=\s|$)/gi;
    let prev: string;
    do { prev = base; base = base.replace(boiler, "$1"); } while (base !== prev);
  }
  // Trailing epoch stamps only. Short trailing numbers are left alone: they are
  // audit-round numbers, and stripping them would turn M^0 ("m 0") into "M".
  base = base.replace(/(\s\d{5,})+$/, "");
  base = base.replace(/\s+/g, " ").trim();

  const name = base.replace(/\b\w/g, (c) => c.toUpperCase());
  // No usable client name means no company: blank, never the filename.
  if (name.length < 2) return { name: "", slug: null, date };
  return { name, slug: slugify(name), date };
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
  const limit = Math.min(Math.max(body.limit ?? 25, 1), 1000);
  const offset = body.offset ?? 0;
  const force = !!body.force;

  const files = await listAuditFiles(ghToken);
  if (files.length === 0) return json(502, { error: "github list failed" });
  const slice = files.slice(offset, offset + limit);

  let processed = 0, parsed_md = 0, audits_inserted = 0, audits_existing = 0, findings_inserted = 0, skipped_pdf = 0;
  const samples: any[] = [];
  for (const f of slice) {
    processed++;
    if (!force) {
      const { data: existing } = await admin.from("audit_history").select("id").eq("report_url", f.html_url).maybeSingle();
      if (existing) { audits_existing++; continue; }
    }
    const isPdf = f.name.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      const proto = inferProtocol(f.name);
      if (proto.slug) {
        const { data: comp } = await admin.from("companies").select("slug").eq("slug", proto.slug).maybeSingle();
        if (!comp) await admin.from("companies").insert({ slug: proto.slug, name: proto.name, data_source: "sherlock_report_ingest" });
      }
      await admin.from("audit_history").insert({
        company_slug: proto.slug || null, protocol_name: proto.name || null,
        audit_firm: "Sherlock", audit_type: "contest", audit_date: proto.date,
        report_url: f.html_url,
        data_source: "sherlock_report_ingest",
      });
      audits_inserted++; skipped_pdf++; continue;
    }
    const md = await fetchText(f.download_url);
    if (!md) continue;
    parsed_md++;
    const proto = inferProtocol(f.name);
    const findings = parseFindings(md);
    const counts = { critical: 0, high: 0, medium: 0, low: 0, informational: 0, gas: 0 };
    for (const fi of findings) { (counts as any)[fi.severity] = ((counts as any)[fi.severity] ?? 0) + 1; }

    if (proto.slug) {
      const { data: comp } = await admin.from("companies").select("slug").eq("slug", proto.slug).maybeSingle();
      if (!comp) await admin.from("companies").insert({ slug: proto.slug, name: proto.name, data_source: "sherlock_report_ingest" });
    }

    const { data: audit, error: audErr } = await admin.from("audit_history").insert({
      company_slug: proto.slug || null, protocol_name: proto.name || null,
      audit_firm: "Sherlock", audit_type: "contest", audit_date: proto.date,
      report_url: f.html_url,
      findings_critical: counts.critical, findings_high: counts.high, findings_medium: counts.medium,
      findings_low: counts.low, findings_informational: counts.informational, findings_gas: counts.gas,
      findings_extracted_at: new Date().toISOString(),
      findings_extraction_status: "extracted",
      ai_summary: `${proto.name} Sherlock contest report`,
      data_source: "sherlock_report_ingest",
    }).select("id").maybeSingle();
    if (audErr || !audit) continue;
    audits_inserted++;

    if (findings.length > 0) {
      const detailRows = findings.slice(0, 200).map(fi => ({
        audit_id: audit.id, company_slug: proto.slug || null,
        severity: fi.severity, title: fi.title, summary: fi.summary || null, status: fi.status,
      }));
      const { error: detErr } = await admin.from("audit_findings_detail").insert(detailRows);
      if (!detErr) findings_inserted += detailRows.length;
    }
    if (samples.length < 5) samples.push({ file: f.name, protocol: proto.name, findings: findings.length });
  }

  return json(200, { ok: true, total_files: files.length, processed, parsed_md, audits_inserted, audits_existing, findings_inserted, skipped_pdf, samples, next_offset: offset + limit });
});
