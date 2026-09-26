// v5 — add zokyo/sigmaprime firms + handle 23505 dup-key on report_url gracefully
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }
function slugify(s: string): string { return (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80); }

const SEV_MAP: Record<string, string> = { c: "critical", h: "high", m: "medium", l: "low", i: "informational", g: "gas", q: "informational", n: "informational" };

const FIRM_SLUGS: Array<[string, string]> = [
  ["pashov-audit-group", "Pashov Audit Group"], ["trail-of-bits", "Trail of Bits"],
  ["consensys-diligence", "ConsenSys Diligence"], ["sigma-prime", "Sigma Prime"],
  ["runtime-verification", "Runtime Verification"], ["trust-security", "Trust Security"],
  ["oak-security", "Oak Security"], ["informal-systems", "Informal Systems"],
  ["chaos-labs", "Chaos Labs"], ["three-sigma", "Three Sigma"],
  ["guardian-audits", "Guardian Audits"], ["adevar-labs", "Adevar Labs"],
  ["ackee-blockchain", "Ackee Blockchain"], ["renascence-labs", "Renascence Labs"],
  ["thesis-defense", "Thesis Defense"], ["red-fort-security", "Red Fort Security"],
  ["bramah-systems", "Bramah Systems"], ["valid-network", "Valid Network"],
  ["offside-labs", "Offside Labs"], ["shieldify-security", "Shieldify Security"],
  ["paladin-blockchain-security", "Paladin Blockchain Security"], ["chainsecurity", "ChainSecurity"],
  ["haechi-audit", "HAECHI AUDIT"], ["coinfabrik", "CoinFabrik"],
  ["zokyo", "Zokyo"], ["sigmaprime", "Sigma Prime"], ["trailofbits", "Trail of Bits"],
  ["consensysdiligence", "ConsenSys Diligence"], ["oakorganization", "Oak Security"],
  ["code4rena", "Code4rena"], ["codehawks", "CodeHawks"], ["sherlock", "Sherlock"],
  ["cantina", "Cantina"], ["spearbit", "Spearbit"], ["openzeppelin", "OpenZeppelin"],
  ["consensys", "ConsenSys Diligence"], ["quantstamp", "Quantstamp"],
  ["chainsafe", "ChainSafe"], ["zellic", "Zellic"], ["halborn", "Halborn"],
  ["pashov", "Pashov Audit Group"], ["yaudit", "yAudit"], ["hexens", "Hexens"],
  ["verichains", "Verichains"], ["certora", "Certora"], ["nethermind", "Nethermind"],
  ["peckshield", "PeckShield"], ["mixbytes", "MixBytes"], ["cyfrin", "Cyfrin"],
  ["sec3", "Sec3"], ["ottersec", "OtterSec"], ["mantisec", "Mantisec"],
  ["shieldify", "Shieldify Security"], ["blocksec", "BlockSec"], ["hashlock", "Hashlock"],
  ["hacken", "Hacken"], ["decurity", "Decurity"], ["dedaub", "Dedaub"],
  ["paladin", "Paladin Blockchain Security"], ["statemind", "Statemind"], ["oxorio", "Oxorio"],
  ["perimeter", "Perimeter"], ["coinspect", "Coinspect"], ["movebit", "MoveBit"],
  ["neodyme", "Neodyme"], ["bailsec", "Bailsec"], ["veridise", "Veridise"],
];

const REPORT_TYPE_SUFFIXES = [
  "-contest-git", "-contest-pdf", "-contest-markdown",
  "-none-git", "-none-pdf", "-none-markdown",
  "-audit-git", "-audit-pdf", "-audit-markdown",
  "-review-git", "-review-pdf", "-review-markdown",
  "-part-git", "-part-pdf", "-part-markdown",
  "-git", "-pdf", "-markdown",
];

type SlugParsed = {
  severity: string; sevNum: number | null;
  firm: string; protocol: string; protocolSlug: string; rawTitle: string;
};

function parseSoloditSlug(url: string): SlugParsed | null {
  const m = url.match(/\/issues\/([^?#]+)/);
  if (!m) return null;
  let slug = m[1].toLowerCase().replace(/\/$/, "");

  let severity = "informational";
  let sevNum: number | null = null;
  const sevMatch = slug.match(/^([chmlignq])-(\d+)-(.+)$/);
  if (sevMatch) { severity = SEV_MAP[sevMatch[1]] || "informational"; sevNum = parseInt(sevMatch[2]); slug = sevMatch[3]; }
  else {
    const numMatch = slug.match(/^(\d+)-(.+)$/);
    if (numMatch) { sevNum = parseInt(numMatch[1]); slug = numMatch[2]; }
  }

  for (const suf of REPORT_TYPE_SUFFIXES) { if (slug.endsWith(suf)) { slug = slug.slice(0, -suf.length); break; } }

  let firm = "", firmSlugMatched = "";
  for (const [fSlug, fName] of FIRM_SLUGS) {
    if (slug.endsWith("-" + fSlug) || slug === fSlug) { firm = fName; firmSlugMatched = fSlug; break; }
    if (slug.includes("-" + fSlug + "-")) { firm = fName; firmSlugMatched = fSlug; break; }
  }
  if (!firm) return null;

  let title = slug, protocolPart = "";
  const idx = slug.lastIndexOf("-" + firmSlugMatched + "-");
  const endIdx = slug.lastIndexOf("-" + firmSlugMatched);
  if (idx >= 0) { title = slug.slice(0, idx); protocolPart = slug.slice(idx + firmSlugMatched.length + 2); }
  else if (endIdx === slug.length - firmSlugMatched.length - 1) { title = slug.slice(0, endIdx); protocolPart = ""; }

  let protocol = protocolPart;
  if (protocol) {
    const tokens = protocol.split("-");
    const deduped: string[] = [];
    for (const t of tokens) { if (deduped.length === 0 || deduped[deduped.length - 1] !== t) deduped.push(t); }
    protocol = deduped.filter(t => t !== "none").join(" ").trim();
  }
  if (!protocol) { const tail = title.split("-").slice(-1)[0]; protocol = tail || "unknown"; }

  const protocolSlug = slugify(protocol);
  const rawTitle = title.replace(/-/g, " ").trim();
  const niceProto = protocol.replace(/\b\w/g, c => c.toUpperCase());
  return { severity, sevNum, firm, protocol: niceProto, protocolSlug, rawTitle };
}

async function jinaText(url: string): Promise<string | null> {
  try {
    const r = await fetch(`https://r.jina.ai/${url}`, { headers: { "User-Agent": "AuditScope/1.0", "X-Return-Format": "text" } });
    if (!r.ok) return null;
    const t = await r.text();
    return t.length > 50 ? t : null;
  } catch { return null; }
}

function extractFromBody(text: string) {
  let niceTitle: string | null = null, date: string | null = null;
  let submittedBy: string | null = null, status: string | null = null;
  let originalReportUrl: string | null = null;

  const titleMatch = text.match(/^Title:\s*(.+?)\s*$/m);
  if (titleMatch) {
    const titleLine = titleMatch[1];
    const m = titleLine.match(/finding:\s*\[[CHMLIGQNchmligqn]-?\d+\]\s*(.+?)(?:\s*:\s*([^_]+?)_(\d{4}-\d{2}-\d{2}))?\s*$/);
    if (m) { niceTitle = m[1].trim().replace(/\s+/g, " ").slice(0, 300); if (m[3]) date = m[3]; }
    else {
      const m2 = titleLine.match(/finding:\s*(.+?)(?:\s*:\s*([^_]+?)_(\d{4}-\d{2}-\d{2}))?\s*$/);
      if (m2) { niceTitle = m2[1].trim().replace(/\s+/g, " ").slice(0, 300); if (m2[3]) date = m2[3]; }
    }
  }

  const bodyStart = text.indexOf("Markdown Content:");
  const body = bodyStart >= 0 ? text.slice(bodyStart + "Markdown Content:".length).trim() : text;
  const summary = body.replace(/\s+/g, " ").trim().slice(0, 800);

  const subMatch = body.match(/_?Submitted by\s+([^_,\n]+?)(?:[_,\n]|also found by)/i);
  if (subMatch) submittedBy = subMatch[1].trim();

  const lowerBody = body.toLowerCase();
  if (/\bpatched\b|\bfixed\b|\bresolved\b|\bmitigated\b/.test(lowerBody)) status = "fixed";
  else if (/\backnowledged\b|\bconfirmed\b/.test(lowerBody)) status = "acknowledged";
  else if (/\bwon'?t\s*fix\b|\bwontfix\b/.test(lowerBody)) status = "wontfix";
  else if (/\bdisputed\b/.test(lowerBody)) status = "wontfix";

  const urlRegex = /https?:\/\/[^\s)\]"'>]+/g;
  const urls = body.match(urlRegex) || [];
  for (const u of urls) {
    if (u.includes("solodit.cyfrin.io") || u.includes("google") || u.includes("twitter.com") || u.includes("x.com")) continue;
    if (/github\.com|gitlab\.com|cantina\.xyz/i.test(u)) { originalReportUrl = u.replace(/[.,;)\]]+$/, ""); break; }
  }

  return { niceTitle, date, submittedBy, status, originalReportUrl, summary };
}

async function processOne(admin: any, queueRow: { id: string; url: string }) {
  const slugInfo = parseSoloditSlug(queueRow.url);
  if (!slugInfo) return { status: "failed", reason: "slug parse failed" };
  if (!slugInfo.protocolSlug || slugInfo.protocolSlug.length < 2) return { status: "failed", reason: "bad protocol slug" };

  const text = await jinaText(queueRow.url);
  let body = { niceTitle: null as string | null, date: null as string | null, submittedBy: null as string | null, status: null as string | null, originalReportUrl: null as string | null, summary: "" };
  if (text) body = extractFromBody(text);

  let title = body.niceTitle || slugInfo.rawTitle;
  if (title.length > 300) title = title.slice(0, 300);
  if (title.length < 5) title = `${slugInfo.severity.toUpperCase()} finding in ${slugInfo.protocol}`;

  const { data: existingCompany } = await admin.from("companies").select("slug").eq("slug", slugInfo.protocolSlug).maybeSingle();
  if (!existingCompany) {
    await admin.from("companies").insert({ slug: slugInfo.protocolSlug, name: slugInfo.protocol, data_source: "solodit_ingest" });
  }

  const reportUrl = body.originalReportUrl || queueRow.url;

  // 1) Try to find by report_url FIRST (this is the unique key)
  let auditId: string | null = null;
  const { data: byReportUrl } = await admin.from("audit_history").select("id").eq("report_url", reportUrl).maybeSingle();
  if (byReportUrl) auditId = byReportUrl.id;

  // 2) Otherwise try by company+firm+date
  if (!auditId) {
    let q = admin.from("audit_history").select("id").eq("company_slug", slugInfo.protocolSlug).eq("audit_firm", slugInfo.firm);
    if (body.date) q = q.eq("audit_date", body.date); else q = q.is("audit_date", null);
    const { data: byFirm } = await q.maybeSingle();
    if (byFirm) auditId = byFirm.id;
  }

  // 3) Otherwise create new audit_history
  if (!auditId) {
    const auditType = ["Code4rena", "Sherlock", "Cantina", "CodeHawks"].includes(slugInfo.firm) ? "contest" : "smart_contract_audit";
    const { data: inserted, error: insErr } = await admin.from("audit_history").insert({
      company_slug: slugInfo.protocolSlug, protocol_name: slugInfo.protocol,
      audit_firm: slugInfo.firm, audit_type: auditType, audit_date: body.date,
      report_url: reportUrl, findings_extracted_at: new Date().toISOString(),
      findings_extraction_status: "extracted",
      ai_summary: `${slugInfo.protocol} audit by ${slugInfo.firm}${body.date ? ` (${body.date})` : ""} — sourced from Solodit.`,
      data_source: "solodit_ingest",
    }).select("id").single();
    if (insErr) {
      // Race condition: someone else just created it. Look it up.
      if (insErr.code === "23505") {
        const { data: race } = await admin.from("audit_history").select("id").eq("report_url", reportUrl).maybeSingle();
        if (race) auditId = race.id;
        else return { status: "failed", reason: "23505 but lookup failed" };
      } else return { status: "failed", reason: `audit_history insert: ${insErr.message?.slice(0, 200) || "unknown"}` };
    } else if (inserted) auditId = inserted.id;
  }
  if (!auditId) return { status: "failed", reason: "no audit_id resolved" };

  const titleNorm = title.toLowerCase().slice(0, 80);
  const { data: existingFindings } = await admin.from("audit_findings_detail")
    .select("id, title").eq("audit_id", auditId).eq("severity", slugInfo.severity).limit(30);
  if (existingFindings && existingFindings.some((f: any) => (f.title || "").toLowerCase().slice(0, 80) === titleNorm)) {
    return { status: "skipped_dup" };
  }

  const summaryWithAuthor = body.submittedBy ? `[Submitted by ${body.submittedBy}] ${body.summary}` : body.summary;
  const { error: findErr } = await admin.from("audit_findings_detail").insert({
    audit_id: auditId, company_slug: slugInfo.protocolSlug,
    severity: slugInfo.severity, title,
    summary: (summaryWithAuthor || `${slugInfo.severity.toUpperCase()} finding in ${slugInfo.protocol}`).slice(0, 800),
    status: body.status,
  });
  if (findErr) return { status: "failed", reason: `finding insert: ${findErr.message?.slice(0, 200) || "unknown"}` };

  return { status: "processed" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronKey = req.headers.get("x-cron-key") || "";
  if (cronKey !== CRON_KEY) return json(401, { error: "Unauthorized" });
  const admin = createClient(supabaseUrl, serviceKey);
  const body = (await req.json().catch(() => ({}))) as { limit?: number; concurrency?: number };
  const limit = Math.min(Math.max(body.limit ?? 30, 1), 80);
  const concurrency = Math.min(Math.max(body.concurrency ?? 5, 1), 10);

  const { data: pending } = await admin.from("solodit_ingest_queue")
    .select("id, url").eq("status", "pending").order("id", { ascending: true }).limit(limit);
  if (!pending || pending.length === 0) return json(200, { ok: true, scanned: 0, note: "queue empty" });

  let processed = 0, skipped_dup = 0, failed = 0;
  const errors: any[] = [];
  for (let i = 0; i < pending.length; i += concurrency) {
    const chunk = pending.slice(i, i + concurrency);
    const results = await Promise.all(chunk.map(async (q: any) => {
      const out = await processOne(admin, q);
      const update: any = { status: out.status, processed_at: new Date().toISOString() };
      if (out.reason) update.error_message = out.reason.slice(0, 300);
      await admin.from("solodit_ingest_queue").update(update).eq("id", q.id);
      return out;
    }));
    for (const r of results) {
      if (r.status === "processed") processed++;
      else if (r.status === "skipped_dup") skipped_dup++;
      else { failed++; if (errors.length < 5) errors.push(r); }
    }
  }
  return json(200, { ok: true, scanned: pending.length, processed, skipped_dup, failed, error_samples: errors });
});
