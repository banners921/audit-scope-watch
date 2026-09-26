// v12 — folder-name fallback: when filename is generic (review.pdf/report.pdf) use the parent folder as protocol name (fixes sigp-style repos)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }
function slugify(s: string): string { return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }
function encPath(p: string): string { return p.split("/").map((seg) => encodeURIComponent(seg)).join("/"); }

const SHORT_NAME_ALLOWLIST = new Set(["m0","d2","0x","v2","v3","aa","bb","cs","q","x","c2x","cvi","dao","snx","yfi","crv","mkr","uni","sol","eth","btc","avs","lst","dex","nft","sdk"]);

function titleCase(s: string): string {
  return s.replace(/\b([a-z])([a-z]*)\b/g, (_, a, b) => a.toUpperCase() + b);
}

function cleanProtocolName(name: string): string {
  let n = (name || "").trim();
  if (!n) return n;
  n = n.replace(/\.(pdf|md|json|txt|html?)$/i, "");
  n = n.replace(/\s+Pentest$/i, "");
  n = n.replace(/\s+letterofattestation.*$/i, "");
  n = n.replace(/^[\d\-_\s]{4,}/, "");
  n = n.replace(/\s{2,}/g, " ").trim();
  return n;
}

function isValidProtocolName(name: string): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  const lower = trimmed.toLowerCase();
  if (/^\d+$/.test(trimmed)) return false;
  if (/^[a-z]{2,3}$/.test(trimmed) && !SHORT_NAME_ALLOWLIST.has(lower)) return false;
  const banned = /^(audit|report|template|example|readme|license|index|contributing|changelog|summary|attestation|pentest|review|draft|scope|fix(es)?|test|sample|presentation|generic|untitled|todo|wip|tbd|introduction|overview|conclusion|appendix)$/i;
  if (banned.test(trimmed)) return false;
  if (/^example/i.test(trimmed) && trimmed.length < 30) return false;
  if (/^v\d+$/i.test(trimmed)) return false;
  if (/letterofattestation/i.test(lower)) return false;
  return true;
}

type FileEntry = { title: string; url: string };
type Audit = { idx: number; name: string; date: string | null; lang: string | null; url?: string };

function parseFilename(rawTitle: string, firmName: string): { name: string; date: string | null; lang: string | null } | null {
  const fname = rawTitle.split('/').pop() || rawTitle;
  let s = fname.replace(/\.(pdf|md|json|txt|html?)$/i, '');

  let date: string | null = null;
  const dateMatch = s.match(/(20\d{2})[-_.](0?[1-9]|1[0-2])[-_.](0?[1-9]|[12]\d|3[01])/);
  if (dateMatch) {
    date = `${dateMatch[1]}-${dateMatch[2].padStart(2,'0')}-${dateMatch[3].padStart(2,'0')}`;
    s = s.replace(dateMatch[0], ' ');
  } else {
    const ymMatch = s.match(/(20\d{2})[-_.](0?[1-9]|1[0-2])(?![\d])/);
    if (ymMatch) {
      date = `${ymMatch[1]}-${ymMatch[2].padStart(2,'0')}-01`;
      s = s.replace(ymMatch[0], ' ');
    } else {
      const yMatch = s.match(/\b(20\d{2})\b/);
      if (yMatch) { date = `${yMatch[1]}-01-01`; s = s.replace(yMatch[0], ' '); }
    }
  }

  const firmTokens = firmName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(t => t.length > 2);
  for (const tok of firmTokens) {
    s = s.replace(new RegExp(`(^|[-_\\s])${tok}([-_\\s]|$)`, 'gi'), ' ');
  }

  s = s.replace(/(^|[-_\s])(audit|review|report|pentest|attestation|final|public|draft|smart[- _]contracts?)([-_\s]|$)/gi, ' ');
  s = s.replace(/[-_\s]v?\d+(\.\d+)*\.?(\d+)?(?=[-_\s]|$)/gi, ' ');
  s = s.replace(/[-_\s](final|draft|v[\d.]+)([-_\s]|$)/gi, ' ');
  s = s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

  let lang: string | null = null;
  if (/\b(solidity|sol|evm)\b/i.test(fname)) lang = 'solidity';
  else if (/\b(rust|substrate|near)\b/i.test(fname)) lang = 'rust';
  else if (/\b(move|aptos|sui)\b/i.test(fname)) lang = 'move';
  else if (/\b(cairo|starknet|stark)\b/i.test(fname)) lang = 'cairo';

  const cleaned = titleCase(s);
  if (!cleaned || cleaned.length < 2) return null;
  if (!isValidProtocolName(cleaned)) return null;
  return { name: cleaned, date, lang };
}

// Fallback: derive protocol name from the folder path when the filename is generic (review.pdf/report.pdf).
const WRAPPER_DIR = /^(reports?|audits?|pdfs?|files?|public[-_]?audits?|smart[-_ ]?contracts?|solidity|docs?|assessments?|reviews?|final|public|drafts?|archive|misc)$/i;
function nameFromFolder(rawPath: string, firmName: string): string | null {
  const parts = rawPath.split('/').filter(Boolean);
  parts.pop(); // drop filename
  const firmTokens = firmName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(t => t.length > 2);
  for (let i = parts.length - 1; i >= 0; i--) {
    const seg = parts[i];
    if (WRAPPER_DIR.test(seg)) continue;
    if (/^20\d{2}([-_.]\d{1,2}([-_.]\d{1,2})?)?$/.test(seg)) continue; // year/date folder
    if (/^v?\d+(\.\d+)*$/.test(seg)) continue; // version folder
    let s = seg.replace(/[-_]+/g, ' ').trim();
    for (const tok of firmTokens) s = s.replace(new RegExp(`(^|\\s)${tok}(\\s|$)`, 'gi'), ' ');
    s = s.replace(/\s+/g, ' ').trim();
    const cleaned = titleCase(s);
    if (cleaned.length >= 2 && isValidProtocolName(cleaned)) return cleaned;
  }
  return null;
}

async function ghListApi(owner: string, repo: string, path: string, depth = 0): Promise<FileEntry[]> {
  if (depth > 4) return [];
  const out: FileEntry[] = [];
  const ghToken = Deno.env.get("GITHUB_TOKEN") || "";
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "AuditScope/1.0" };
  if (ghToken) headers.Authorization = `token ${ghToken}`;
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encPath(path)}?per_page=1000`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return [];
    const items = await r.json();
    if (!Array.isArray(items)) return [];
    for (const f of items as any[]) {
      if (f.type === "file" && /\.(pdf|md)$/i.test(f.name)) {
        if (/^(readme|license|index|template|contributing|changelog)\b/i.test(f.name)) continue;
        out.push({ title: f.path, url: f.download_url || f.html_url });
      } else if (f.type === "dir") {
        const sub = await ghListApi(owner, repo, f.path, depth + 1);
        out.push(...sub);
      }
    }
  } catch {}
  return out;
}

async function ghListViaJina(owner: string, repo: string, path: string): Promise<FileEntry[]> {
  const jinaKey = Deno.env.get("JINA_API_KEY") || "";
  for (const branch of ['main','master']) {
    const treeUrl = `https://github.com/${owner}/${repo}/tree/${branch}${path ? '/' + path : ''}`;
    let text: string | null = null;
    try {
      const h: Record<string,string> = { "User-Agent": "AuditScope/1.0", "X-Return-Format": "text" };
      if (jinaKey) h.Authorization = `Bearer ${jinaKey}`;
      const r = await fetch(`https://r.jina.ai/${treeUrl}`, { headers: h, signal: AbortSignal.timeout(25_000) });
      if (r.ok) text = await r.text();
    } catch {}
    if (!text || text.length < 200) continue;
    const out: FileEntry[] = [];
    const seen = new Set<string>();
    const matches = text.matchAll(/([A-Za-z0-9_\-\.]+\.pdf)/g);
    for (const m of matches) {
      const fname = m[1];
      if (/^(readme|license|index|template|contributing|changelog|sample)\b/i.test(fname)) continue;
      if (seen.has(fname)) continue;
      seen.add(fname);
      const fullPath = path ? `${path}/${fname}` : fname;
      out.push({ title: fullPath, url: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encPath(fullPath)}` });
    }
    if (out.length > 0) return out;
  }
  return [];
}

async function jinaText(url: string): Promise<string | null> {
  try {
    const jinaKey = Deno.env.get("JINA_API_KEY") || "";
    const h: Record<string,string> = { "User-Agent": "AuditScope/1.0", "X-Return-Format": "text" };
    if (jinaKey) h.Authorization = `Bearer ${jinaKey}`;
    const r = await fetch(`https://r.jina.ai/${url}`, { headers: h });
    if (!r.ok) return null;
    const t = await r.text();
    return t.length > 200 ? t.slice(0, 120_000) : null;
  } catch { return null; }
}

async function extractFromPage(firmName: string, pageText: string, apiKey: string) {
  const prompt = `Extract every audited protocol/client from ${firmName}'s page.\nReturn ONLY JSON: {\"audits\":[{\"idx\":int,\"name\":str,\"date\":str|null,\"lang\":str|null,\"url\":str|null}]}\n\n${pageText.slice(0,100_000)}`;
  return await callAnthropic(prompt, apiKey);
}

async function callAnthropic(prompt: string, apiKey: string): Promise<any[]> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 8000, temperature: 0, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`anthropic ${r.status}: ${t.slice(0, 200)}`); }
  const j = await r.json();
  const text = (j.content?.[0]?.text || "").trim();
  let jsonStr = text;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) jsonStr = fence[1];
  const start = jsonStr.indexOf("{"); const end = jsonStr.lastIndexOf("}");
  if (start >= 0 && end > start) jsonStr = jsonStr.slice(start, end + 1);
  try { const p = JSON.parse(jsonStr); return Array.isArray(p?.audits) ? p.audits : []; } catch { return []; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL"); const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!supabaseUrl || !serviceKey) return json(500, { error: "missing env" });
  const cronKey = req.headers.get("x-cron-key") || "";
  if (cronKey !== CRON_KEY) return json(401, { error: "Unauthorized" });
  const admin = createClient(supabaseUrl, serviceKey);
  const body = (await req.json().catch(() => ({}))) as { firm_slug?: string };
  const firmSlug = body.firm_slug;
  if (!firmSlug) return json(400, { error: "firm_slug required" });

  const { data: source } = await admin.from("audit_sources").select("*").eq("slug", firmSlug).maybeSingle();
  if (!source) return json(404, { error: `firm '${firmSlug}' not found` });

  let parsed: Audit[] = [];
  let catalogSize = 0;
  let entries: FileEntry[] = [];
  let listMethod = '';
  let parseMethod = '';
  const anthropicErrors: string[] = [];

  const cfg = source.source_config as any;
  if (source.source_type === "github_dir" || source.source_type === "github_nested_dir") {
    const apiList = await ghListApi(cfg.owner, cfg.repo, cfg.path || "");
    if (apiList.length > 0) { entries = apiList; listMethod = 'api'; }
    else { entries = await ghListViaJina(cfg.owner, cfg.repo, cfg.path || ""); listMethod = 'jina_html'; }
    catalogSize = entries.length;
    if (entries.length === 0) {
      await admin.from("audit_sources").update({ last_scraped_at: new Date().toISOString(), last_scrape_stats: { catalog_size: 0, note: "empty", listMethod } }).eq("slug", firmSlug);
      return json(200, { ok: true, firm: source.firm_name, catalog_size: 0, list_method: listMethod });
    }
    parseMethod = 'deterministic';
    parsed = entries.map((e, idx) => {
      const p = parseFilename(e.title, source.firm_name);
      const name = (p && p.name) || nameFromFolder(e.title, source.firm_name);
      if (!name) return null;
      return { idx, name, date: p ? p.date : null, lang: p ? p.lang : null };
    }).filter((x): x is Audit => x !== null);
  } else if (source.source_type === "jina_html") {
    const text = await jinaText(cfg.url);
    if (!text) return json(500, { error: "jina fetch failed" });
    catalogSize = text.length;
    parseMethod = 'llm_page';
    if (!anthropicKey) return json(500, { error: "ANTHROPIC_API_KEY missing" });
    try { parsed = await extractFromPage(source.firm_name, text, anthropicKey); }
    catch (e) { anthropicErrors.push(String(e).slice(0, 250)); }
  } else {
    return json(400, { error: `source_type ${source.source_type} not handled` });
  }

  let inserted = 0, matched = 0, pending = 0, dupes = 0, errors = 0, rejected = 0;
  for (const a of parsed) {
    const cleaned = cleanProtocolName(a.name || "");
    if (!isValidProtocolName(cleaned)) { rejected++; continue; }
    const slug = slugify(cleaned);
    if (!slug || slug.length < 2) { rejected++; continue; }
    let reportUrl: string | null = null;
    if (a.url && typeof a.url === "string" && /^https?:\/\//.test(a.url)) reportUrl = a.url;
    else if (typeof a.idx === "number" && entries[a.idx]) reportUrl = entries[a.idx].url;

    const { data: bySlug } = await admin.from("companies").select("slug,name").eq("slug", slug).maybeSingle();
    let companySlug: string | null = bySlug?.slug || null;
    let protocolName = bySlug?.name || cleaned;
    if (!companySlug) {
      const { data: byName } = await admin.from("companies").select("slug,name").ilike("name", cleaned).limit(1);
      if (byName && byName.length > 0) { companySlug = byName[0].slug; protocolName = byName[0].name; }
    }
    if (companySlug) matched++;
    else {
      const { error: ce } = await admin.from("companies").insert({ slug, name: cleaned, data_source: "audit_scrape_stub:" + firmSlug });
      if (!ce) { companySlug = slug; pending++; }
      else if (ce.code === "23505") { companySlug = slug; matched++; }
      else { errors++; continue; }
    }
    const { error: ie } = await admin.from("audit_history").insert({
      company_slug: companySlug, protocol_name: protocolName, audit_firm: source.firm_name,
      audit_date: a.date, report_url: reportUrl, smart_contract_language: a.lang,
      data_source: "bulk-ingest:" + firmSlug,
    });
    if (!ie) inserted++;
    else if (ie.code === "23505") dupes++;
    else errors++;
  }

  await admin.from("audit_sources").update({
    last_scraped_at: new Date().toISOString(),
    last_scrape_stats: { catalog_size: catalogSize, extracted: parsed.length, matched, inserted, pending, dupes, errors, rejected, list_method: listMethod, parse_method: parseMethod, anthropic_errors: anthropicErrors.slice(0,3) },
  }).eq("slug", firmSlug);

  return json(200, { ok: true, firm: source.firm_name, catalog_size: catalogSize, list_method: listMethod, parse_method: parseMethod, extracted: parsed.length, matched, inserted, pending, dupes, errors, rejected, anthropic_errors: anthropicErrors });
});
