import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Cron auth key. Sourced from the CRON_KEY secret so this file carries no
// credential and can live in version control.
const CRON_KEY = Deno.env.get("CRON_KEY") || "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const GH_TOKEN = Deno.env.get("GITHUB_TOKEN") || "";
const GROK_API_KEY = Deno.env.get("GROK_API_KEY") || "";
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY") || "";

// URL-encode each path segment but preserve the slash separators.
// Without this, GitHub folder names containing spaces or other special
// characters (e.g. Halborn's "Solidity Smart Contract Audits") produce a
// malformed request URL and the contents call silently returns nothing.
function encPath(p: string): string {
  return p.split("/").map((seg) => encodeURIComponent(seg)).join("/");
}

function ghHeaders(): HeadersInit {
  const h: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (GH_TOKEN) h.Authorization = `Bearer ${GH_TOKEN}`;
  return h;
}
// Last GitHub failure seen this request. A silently-null ghJson() used to look
// identical to "empty directory", which made secondary rate limiting invisible.
let ghLastError: string | null = null;

async function ghJson<T>(path: string, attempt = 0): Promise<T | null> {
  const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (r.ok) return (await r.json()) as T;

  // 403/429 here is almost always GitHub's SECONDARY rate limit, which fires on
  // bursts of concurrent requests even when the core quota is untouched.
  if ((r.status === 403 || r.status === 429) && attempt < 3) {
    const retryAfter = Number(r.headers.get("retry-after") || 0);
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : 2000 * Math.pow(2, attempt);
    ghLastError = `GitHub ${r.status} on ${path} (backoff ${waitMs}ms, attempt ${attempt + 1})`;
    await new Promise((res) => setTimeout(res, Math.min(waitMs, 15000)));
    return ghJson<T>(path, attempt + 1);
  }
  const bodyTxt = await r.text().catch(() => "");
  ghLastError = `GitHub ${r.status} on ${path}: ${bodyTxt.slice(0, 220)}`;
  return null;
}

type CatalogEntry = { title: string; url: string };

async function fetchGithubDir(cfg: { owner: string; repo: string; path: string }): Promise<CatalogEntry[]> {
  const list = await ghJson<Array<{ name: string; path: string; type: string; download_url: string; html_url: string }>>(
    `/repos/${cfg.owner}/${cfg.repo}/contents/${encPath(cfg.path)}?per_page=1000`,
  );
  if (!list) return [];
  return list
    .filter((f) => f.type === "file" && /\.(pdf|md)$/i.test(f.name))
    .map((f) => ({ title: f.name, url: f.download_url || f.html_url }));
}
async function fetchGithubNestedDir(cfg: { owner: string; repo: string; path: string; dir_offset?: number; dir_limit?: number }): Promise<CatalogEntry[]> {
  const top = await ghJson<Array<{ name: string; path: string; type: string }>>(
    `/repos/${cfg.owner}/${cfg.repo}/contents/${encPath(cfg.path)}?per_page=1000`,
  );
  if (!top) return [];
  let dirs = top.filter((d) => d.type === "dir");
  // Very large repos (solidproof/Projects has ~1000 top-level dirs) exceed the
  // function wall clock if walked in one run. dir_offset/dir_limit let a cron
  // page through them; both are optional and default to "everything".
  const dirOffset = Math.max(0, cfg.dir_offset ?? 0);
  const dirLimit = cfg.dir_limit && cfg.dir_limit > 0 ? cfg.dir_limit : dirs.length;
  dirs = dirs.slice(dirOffset, dirOffset + dirLimit);

  const out: CatalogEntry[] = [];
  const isReport = (n: string) => /\.(pdf|md)$/i.test(n);
  // Bounded concurrency: sequential walking was the timeout cause. With
  // GITHUB_TOKEN (5,000 req/hr) we can safely fan out.
  const CONC = 3;
  for (let i = 0; i < dirs.length; i += CONC) {
    const slice = dirs[i] === undefined ? [] : dirs.slice(i, i + CONC);
    const results = await Promise.all(slice.map(async (d) => {
      const acc: CatalogEntry[] = [];
      const sub = await ghJson<Array<{ name: string; path: string; type: string; download_url: string; html_url: string }>>(
        `/repos/${cfg.owner}/${cfg.repo}/contents/${encPath(d.path)}?per_page=1000`,
      );
      if (!sub) return acc;
      const nestedDirs: Array<{ name: string; path: string }> = [];
      for (const f of sub) {
        if (f.type === "file" && isReport(f.name)) {
          acc.push({ title: `${d.name}/${f.name}`, url: f.download_url || f.html_url });
        } else if (f.type === "dir") {
          nestedDirs.push({ name: f.name, path: f.path });
        }
      }
      const deeper = await Promise.all(nestedDirs.map((nd) =>
        ghJson<Array<{ name: string; path: string; type: string; download_url: string; html_url: string }>>(
          `/repos/${cfg.owner}/${cfg.repo}/contents/${encPath(nd.path)}?per_page=1000`,
        ).then((sub2) => ({ nd, sub2 }))
      ));
      for (const { nd, sub2 } of deeper) {
        for (const f2 of sub2 || []) {
          if (f2.type === "file" && isReport(f2.name)) {
            acc.push({ title: `${d.name}/${nd.name}/${f2.name}`, url: f2.download_url || f2.html_url });
          }
        }
      }
      return acc;
    }));
    for (const r of results) out.push(...r);
  }
  return out;
}
async function fetchGithubRepoList(cfg: { org: string; repo_pattern: string }): Promise<CatalogEntry[]> {
  const out: CatalogEntry[] = [];
  const re = new RegExp(cfg.repo_pattern, "i");
  let page = 1;
  while (page < 20) {
    const repos = await ghJson<Array<{ name: string; full_name: string; html_url: string; pushed_at: string; created_at: string }>>(
      `/orgs/${cfg.org}/repos?per_page=100&page=${page}&sort=updated`,
    );
    if (!repos || repos.length === 0) break;
    for (const r of repos) {
      if (re.test(r.name)) out.push({ title: r.name, url: r.html_url });
    }
    if (repos.length < 100) break;
    page++;
  }
  return out;
}
async function firecrawlScrape(url: string, waitFor: number): Promise<{ markdown: string; links: string[] }> {
  const r = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${FIRECRAWL_API_KEY}` },
    body: JSON.stringify({ url, formats: ["markdown", "links"], onlyMainContent: false, waitFor, timeout: 60000 }),
  });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`Firecrawl ${r.status} on ${url}: ${t.slice(0, 300)}`); }
  const data = await r.json();
  return { markdown: String(data?.data?.markdown || ""), links: Array.isArray(data?.data?.links) ? (data.data.links as string[]) : [] };
}
async function fetchFirecrawlHtml(cfg: { urls?: string[]; url?: string; link_filter?: string; wait_for?: number; use_links?: boolean }): Promise<CatalogEntry[]> {
  if (!FIRECRAWL_API_KEY) { fetchNotes.push("firecrawl: no key, skipped"); return []; }
  const urls = cfg.urls && cfg.urls.length > 0 ? cfg.urls : (cfg.url ? [cfg.url] : []);
  if (urls.length === 0) return [];
  const filter = cfg.link_filter ? new RegExp(cfg.link_filter, "i") : null;
  const waitFor = typeof cfg.wait_for === "number" ? cfg.wait_for : 4000;
  const all: CatalogEntry[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const { markdown, links } = await firecrawlScrape(url, waitFor);
    const linkRe = /\[([^\]]+?)\]\(([^)\s]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(markdown)) !== null) {
      const label = m[1].replace(/\s+/g, " ").trim();
      const href = m[2].trim();
      if (!label || !href || href.startsWith("#") || href.startsWith("mailto:")) continue;
      if (filter && !filter.test(href)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      if (/^(home|next|prev|previous|read more|view all|view audit|view report|read full report|all|menu|share|tweet|twitter|linkedin|github|blog|services|contact|about|careers|team)$/i.test(label)) continue;
      if (label.length < 2 || label.length > 200) continue;
      all.push({ title: label, url: href });
    }
    if (cfg.use_links) {
      for (const href of links) {
        if (!href) continue;
        if (filter && !filter.test(href)) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        let label = href.replace(/^https?:\/\/[^/]+\//, "").replace(/[/?#].*$/, "");
        label = label.replace(/[-_]/g, " ").trim();
        if (!label || label.length < 2) continue;
        all.push({ title: label, url: href });
      }
    }
  }
  return all;
}

// Jina Reader (r.jina.ai) — renders JS pages to markdown. Requires JINA_API_KEY
// now that the free anonymous tier returns 401. This replaces the depleted
// Firecrawl path for website-based firms (Certora, OtterSec, Secure3, iosiro, ...).
const JINA_API_KEY = Deno.env.get("JINA_API_KEY") || "";
async function jinaRead(url: string): Promise<{ markdown: string; links: string[] }> {
  const headers: Record<string, string> = {
    "User-Agent": "AuditScope/1.0",
    "X-Return-Format": "markdown",
    "X-With-Links-Summary": "true",
  };
  if (JINA_API_KEY) headers.Authorization = `Bearer ${JINA_API_KEY}`;
  const r = await fetch(`https://r.jina.ai/${url}`, { headers });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`Jina ${r.status} on ${url}: ${t.slice(0, 200)}`); }
  const markdown = await r.text();
  // Jina appends a "Links/Buttons" summary section with absolute URLs when
  // X-With-Links-Summary is set; harvest every URL from the whole doc.
  const links = Array.from(new Set((markdown.match(/https?:\/\/[^\s)\]]+/g) || []).map((s) => s.replace(/[.,;]+$/, ""))));
  return { markdown, links };
}
// ---------------------------------------------------------------------------
// $0 fetch ladder. Rung 1 is a plain unauthenticated GET: if the listing is
// already in the raw HTML (or an XML sitemap), we never touch a renderer.
// Rung 2 is r.jina.ai with NO API key (free tier ~20 req/min), which also
// executes JS. A renderer failure (402/429/5xx) is "skip and retry next
// cycle", never fatal.
// ---------------------------------------------------------------------------
const UA = "Mozilla/5.0 (compatible; AuditScope/1.0; +https://auditscope.ai)";
// Notes about which rung served each URL; surfaced in the response + scrape stats.
let fetchNotes: string[] = [];
// Below this many filtered links we assume the listing is JS-rendered.
const PLAIN_MIN_ENTRIES = 3;

function absolutize(href: string, base: string): string {
  try { return new URL(href, base).toString(); } catch { return href; }
}

// Anchors from raw HTML, plus <loc> entries so XML sitemaps work at rung 1.
function linkPairsFromRaw(body: string, base: string): Array<{ label: string; href: string }> {
  const out: Array<{ label: string; href: string }> = [];
  const aRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = aRe.exec(body)) !== null) {
    const href = m[1].trim();
    const label = m[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (href) out.push({ label, href: absolutize(href, base) });
  }
  const locRe = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  while ((m = locRe.exec(body)) !== null) {
    const href = m[1].trim();
    if (href) out.push({ label: "", href: absolutize(href, base) });
  }
  return out;
}

const NAV_LABEL = /^(home|next|prev|previous|read more|view all|view audit|view report|read full report|all|menu|share|tweet|twitter|linkedin|github|blog|services|contact|about|careers|team|docs|pricing|login|sign up|privacy|terms|cookie|back)$/i;

// Shared filter/label/dedupe rules for both rungs.
function pairsToEntries(
  pairs: Array<{ label: string; href: string }>,
  filter: RegExp | null,
  useLinks: boolean,
): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  const seen = new Set<string>();
  for (const { label, href } of pairs) {
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("javascript:")) continue;
    if (filter && !filter.test(href)) continue;
    if (seen.has(href)) continue;
    let title = label.replace(/\s+/g, " ").trim();
    if (!title || NAV_LABEL.test(title)) {
      // Derive a title from the URL when there is no usable anchor text.
      if (!useLinks && title) continue;
      title = decodeURIComponent(href.replace(/^https?:\/\/[^/]+\//, "").replace(/[?#].*$/, "").replace(/\/$/, ""));
      title = title.split("/").pop() || title;
      title = title.replace(/[-_]/g, " ").replace(/\.(pdf|html?|md)$/i, "").trim();
    }
    if (!title || title.length < 2 || title.length > 200) continue;
    seen.add(href);
    out.push({ title, url: href });
  }
  return out;
}

// Rung 1: plain GET, no renderer, no key.
async function plainFetchEntries(url: string, filter: RegExp | null, useLinks: boolean): Promise<CatalogEntry[]> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      redirect: "follow",
    });
    if (!r.ok) return [];
    const body = await r.text();
    if (!body) return [];
    return pairsToEntries(linkPairsFromRaw(body, url), filter, useLinks);
  } catch {
    return [];
  }
}

async function fetchJinaHtml(cfg: { urls?: string[]; url?: string; link_filter?: string; use_links?: boolean }): Promise<CatalogEntry[]> {
  const urls = cfg.urls && cfg.urls.length > 0 ? cfg.urls : (cfg.url ? [cfg.url] : []);
  if (urls.length === 0) return [];
  const filter = cfg.link_filter ? new RegExp(cfg.link_filter, "i") : null;
  const useLinks = cfg.use_links !== false; // default on: most listings have poor anchor text
  const all: CatalogEntry[] = [];
  const globalSeen = new Set<string>();

  const push = (entries: CatalogEntry[]) => {
    for (const e of entries) {
      if (globalSeen.has(e.url)) continue;
      globalSeen.add(e.url);
      all.push(e);
    }
  };

  for (const url of urls) {
    // Rung 1 — plain GET. Free, no renderer.
    const plain = await plainFetchEntries(url, filter, useLinks);
    if (plain.length >= PLAIN_MIN_ENTRIES) {
      fetchNotes.push(`${url} -> plain (${plain.length} entries, no renderer)`);
      push(plain);
      continue;
    }

    // Rung 2 — r.jina.ai, no API key. Renders JS.
    try {
      const { markdown, links } = await jinaRead(url);
      const pairs: Array<{ label: string; href: string }> = [];
      const linkRe = /\[([^\]]+?)\]\(([^)\s]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(markdown)) !== null) {
        pairs.push({ label: m[1], href: absolutize(m[2].trim(), url) });
      }
      if (useLinks) for (const href of links) pairs.push({ label: "", href });
      const rendered = pairsToEntries(pairs, filter, useLinks);
      if (rendered.length >= plain.length) {
        fetchNotes.push(`${url} -> jina RENDER NEEDED (${rendered.length} entries; plain found ${plain.length})`);
        push(rendered);
      } else {
        fetchNotes.push(`${url} -> plain kept (${plain.length}); jina returned ${rendered.length}`);
        push(plain);
      }
    } catch (e) {
      // 402 / 429 / 5xx: skip this URL, retry next cycle. Never fatal.
      fetchNotes.push(`${url} -> jina unavailable (${String(e).slice(0, 90)}); kept plain=${plain.length}`);
      push(plain);
    }
  }
  return all;
}

function extractResponseText(payload: unknown): string {
  const p = payload as { output?: Array<{ type?: string; role?: string; content?: Array<{ type?: string; text?: string }> }> };
  const out = p?.output || [];
  for (let i = out.length - 1; i >= 0; i--) {
    const item = out[i];
    if (item?.role !== "assistant" && item?.type !== "message") continue;
    for (let j = (item.content || []).length - 1; j >= 0; j--) {
      const b = (item.content || [])[j];
      if ((b?.type === "output_text" || b?.type === "text") && typeof b.text === "string") return b.text;
    }
  }
  for (const item of out) for (const b of item.content || []) if (typeof b?.text === "string") return b.text;
  return "";
}
function parseJsonLoose(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fall */ }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* fall */ } }
  const first = text.indexOf("{"); const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) { try { return JSON.parse(text.slice(first, last + 1)); } catch { /* fall */ } }
  return null;
}

type Extracted = { n: number; client_name: string; audit_date: string | null; audit_type: string | null; language: string | null; is_smart_contract: boolean };

// ── Heuristic extractor (no LLM) ───────────────────────────────────────────
// GitHub firm repos use structured filenames like
//   "Alluvial_Liquid_Collective_Smart_Contract_Security_Audit_Report_Halborn_Final.pdf".
// We parse client/date/language/type from the path with regex so the pipeline
// keeps working even when the LLM billing account is empty. The LLM path
// (extractBatchLLM) remains available for messy website titles when credits exist.
const NON_SC = /(cloud security|web ?pentest|mobile ?pentest|node audit|financial pentest|incident report|penetration|pen ?test|infrastructure|threat model|dev ?ops|hardware wallet|\bkyc\b|readme|license|\.github)/i;
const LANG_RULES: Array<[string, RegExp]> = [
  ["solidity", /solidity|\bevm\b|erc-?20|erc-?721/i],
  ["rust", /solana|\brust\b|anchor program|solana program/i],
  ["move", /\bmove\b|aptos|\bsui\b/i],
  ["cairo", /cairo|starknet/i],
  ["cosmwasm", /cosmwasm|cosmos|\bterra\b|\bwasm\b/i],
  ["vyper", /vyper/i],
  ["func", /\bfunc\b|\bton\b/i],
];
const BOILER = /\b(smart[\s_]?contract[s]?|security|audit[s]?|report|assessment|review|final|draft|executive summary|analysis|program|protocol|pyteal|core[- ]?router|amm|v\d+(\.\d+)*|part\s*\d+|update)\b/gi;
function titleCase(s: string): string {
  return s.split(/\s+/).filter(Boolean).map((w) => (w.length <= 3 && w === w.toUpperCase()) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}
function heuristicExtract(firmName: string, entries: CatalogEntry[], assumeAudits = false): Extracted[] {
  const firmTokens = firmName.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  return entries.map((e, i) => {
    const raw = e.title;
    const base = (raw.split("/").pop() || raw).replace(/\.(pdf|md)$/i, "");
    const hay = raw.toLowerCase();
    const is_sc = !NON_SC.test(raw) &&
      (assumeAudits ||
        /(smart[\s_]?contract|\baudit\b|assessment|\breview\b|\bprogram\b|\bprotocol\b|\bdefi\b|security)/i.test(raw));
    let language: string | null = null;
    for (const [l, re] of LANG_RULES) { if (re.test(hay)) { language = l; break; } }
    let audit_date: string | null = null;
    const dm = base.match(/(20\d{2})[-_. ]?(0[1-9]|1[0-2])[-_. ]?(0[1-9]|[12]\d|3[01])?/);
    if (dm) audit_date = `${dm[1]}-${dm[2]}-${dm[3] || "01"}`;
    else { const ym = base.match(/\b(20\d{2})\b/); if (ym) audit_date = `${ym[1]}-01-01`; }
    let name = base.replace(/[_\-]+/g, " ").replace(BOILER, " ");
    for (const t of firmTokens) name = name.replace(new RegExp(`\\b${t}\\b`, "gi"), " ");
    name = name.replace(/\b20\d{2}[-\d]*\b/g, " ").replace(/\bfinance\b/gi, " ").replace(/\s+/g, " ").trim();
    name = titleCase(name);
    const audit_type = /final/i.test(base) ? "final" : /(initial|draft)/i.test(base) ? "initial" : /fix/i.test(base) ? "fix_review" : null;
    return { n: i, client_name: name, audit_date, audit_type, language, is_smart_contract: is_sc && name.length >= 2 && name.length <= 60 };
  }).filter((x) => x.client_name);
}

async function extractBatch(firmName: string, entries: CatalogEntry[], assumeAudits = false): Promise<Extracted[]> {
  // Default path: no-LLM heuristic (resilient to empty LLM billing accounts).
  // Opt into the LLM refinement only via EXTRACT_MODE=llm (needs Grok credits).
  if (Deno.env.get("EXTRACT_MODE") !== "llm" || !GROK_API_KEY) return heuristicExtract(firmName, entries, assumeAudits);
  try {
    const viaLLM = await extractBatchLLM(firmName, entries);
    return viaLLM.length ? viaLLM : heuristicExtract(firmName, entries, assumeAudits);
  } catch (_e) {
    return heuristicExtract(firmName, entries, assumeAudits);
  }
}
async function extractBatchLLM(firmName: string, entries: CatalogEntry[]): Promise<Extracted[]> {
  if (entries.length === 0) return [];
  const numbered = entries.map((e, i) => ({ n: i, t: e.title }));
  const instructions = `You are a structured-data extractor for a B2B sales tool that sells web3 SMART-CONTRACT security services. You receive a list of audit-report titles from one audit firm. Your job is to extract only entries that audit SMART-CONTRACT CODE (Solidity, Vyper, Rust on Solana/CosmWasm, Move, Cairo, FunC, ink!, Stylus, etc.) for a specific web3 protocol, DeFi/CeFi/exchange/wallet/bridge/L1/L2/tokenization product, or an institutional smart-contract product. SKIP everything else (web2 OSS, library audits without smart contracts, AI/ML research, threat models without contracts, navigation items, generic blog posts, firm marketing pages). Output strict JSON only.`;
  const user = `Firm: ${firmName}\n\nFilenames or link labels (array of {n, t}):\n${JSON.stringify(numbered)}\n\nFor each entry return:\n- n (the index, integer)\n- is_smart_contract (true if this entry refers to an audit of on-chain smart-contract code for a web3 protocol/product; false otherwise.)\n- client_name (the protocol/company audited; CLEANED — strip "audit", "review", "smart contracts", "platform", trailing version suffixes, repeated org name, dates, file extensions). Title-case the result.\n- audit_date (YYYY-MM-DD if a date is implied; YYYY-MM-01 if only month/year; null if unknown)\n- audit_type ("initial", "final", "fix_review", "retainer", "governance", "security_review", "competitive", "threat_model"; null if unknown)\n- language ("solidity", "rust", "move", "cairo", "vyper", "cosmwasm", "func", "ink", null otherwise)\n\nReturn ONLY JSON:\n{\n  "audits": [\n    { "n": int, "is_smart_contract": bool, "client_name": string|null, "audit_date": string|null, "audit_type": string|null, "language": string|null }\n  ]\n}`;
  const r = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROK_API_KEY}` },
    body: JSON.stringify({ model: "grok-4.3", instructions, input: [{ role: "user", content: user }], max_output_tokens: 14000, temperature: 0 }),
  });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`Grok ${r.status}: ${t.slice(0, 300)}`); }
  const payload = await r.json();
  const content = extractResponseText(payload);
  const parsed = parseJsonLoose(content);
  const arr = (parsed && Array.isArray((parsed as { audits?: unknown[] }).audits)) ? ((parsed as { audits: unknown[] }).audits as Array<Record<string, unknown>>) : [];
  return arr.filter((a) => typeof a.n === "number" && typeof a.client_name === "string" && (a.client_name as string).trim()).map((a) => ({
    n: a.n as number,
    is_smart_contract: a.is_smart_contract === true,
    client_name: (a.client_name as string).trim(),
    audit_date: typeof a.audit_date === "string" ? a.audit_date : null,
    audit_type: typeof a.audit_type === "string" ? a.audit_type : null,
    language: typeof a.language === "string" ? a.language : null,
  }));
}
function slugify(s: string): string { return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }

type Match = { company_slug: string | null; protocol_slug: string | null; protocol_name: string | null; via: string };
async function matchClients(supabase: ReturnType<typeof createClient>, names: string[]): Promise<Map<string, Match>> {
  const result = new Map<string, Match>();
  if (names.length === 0) return result;
  const uniq = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  const slugs = Array.from(new Set(uniq.map(slugify).filter(Boolean)));
  const { data: cBySlug } = await supabase.from("companies").select("slug,name").in("slug", slugs);
  for (const r of (cBySlug as Array<{ slug: string; name: string }> | null) || []) {
    for (const n of uniq) { if (slugify(n) === r.slug) result.set(n, { company_slug: r.slug, protocol_slug: null, protocol_name: r.name, via: "slug" }); }
  }
  const { data: pBySlug } = await supabase.from("protocols").select("slug,name,parent_slug").in("slug", slugs);
  for (const r of (pBySlug as Array<{ slug: string; name: string; parent_slug: string | null }> | null) || []) {
    for (const n of uniq) { if (slugify(n) === r.slug && !result.has(n)) result.set(n, { company_slug: r.parent_slug, protocol_slug: r.slug, protocol_name: r.name, via: "protocol_slug" }); }
  }
  const remaining = uniq.filter((n) => !result.has(n));
  const CONC = 3;
  for (let i = 0; i < remaining.length; i += CONC) {
    const chunk = remaining.slice(i, i + CONC);
    await Promise.all(chunk.map(async (n) => {
      const { data: c } = await supabase.from("companies").select("slug,name").ilike("name", n).limit(1);
      const cRow = (c as Array<{ slug: string; name: string }> | null)?.[0];
      if (cRow) { result.set(n, { company_slug: cRow.slug, protocol_slug: null, protocol_name: cRow.name, via: "name" }); return; }
      const { data: p } = await supabase.from("protocols").select("slug,name,parent_slug").ilike("name", n).limit(1);
      const pRow = (p as Array<{ slug: string; name: string; parent_slug: string | null }> | null)?.[0];
      if (pRow) { result.set(n, { company_slug: pRow.parent_slug, protocol_slug: pRow.slug, protocol_name: pRow.name, via: "name" }); return; }
      const { data: fuzzy } = await supabase.rpc("fuzzy_match_company", { client_name: n, min_sim: 0.55 });
      const row = Array.isArray(fuzzy) ? (fuzzy as Array<{ out_match_type: string; out_slug: string; out_name: string; out_parent_slug: string | null; out_similarity: number }>)[0] : null;
      if (row) {
        if (row.out_match_type === "company") result.set(n, { company_slug: row.out_slug, protocol_slug: null, protocol_name: row.out_name, via: `fuzzy(${row.out_similarity.toFixed(2)})` });
        else result.set(n, { company_slug: row.out_parent_slug, protocol_slug: row.out_slug, protocol_name: row.out_name, via: `fuzzy(${row.out_similarity.toFixed(2)})` });
      }
    }));
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  // No LLM gate: extractBatch() falls back to the no-cost heuristic extractor.
  fetchNotes = [];
  ghLastError = null;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Missing supabase env" });

  // Auth: x-cron-key OR Authorization Bearer <valid user JWT>
  const cronKey = req.headers.get("x-cron-key") || "";
  const authHeader = req.headers.get("Authorization") || "";
  // Never treat a missing secret as a match (empty === empty would authorise everyone).
  const isCron = CRON_KEY !== "" && cronKey === CRON_KEY;
  if (!isCron) {
    if (!authHeader) return json(401, { error: "Unauthorized" });
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json(401, { error: "Unauthorized" });
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let body: { firm_slug?: string; limit?: number; offset?: number; debug?: boolean; dir_offset?: number; dir_limit?: number };
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON" }); }
  const firmSlug = body.firm_slug;
  if (!firmSlug) return json(400, { error: "firm_slug required" });
  const maxEntries = body.limit ?? 1000;
  const offset = body.offset ?? 0;

  const { data: source, error: srcErr } = await supabase.from("audit_sources").select("*").eq("slug", firmSlug).maybeSingle();
  if (srcErr) return json(500, { error: "Lookup failed", details: srcErr.message });
  if (!source) return json(404, { error: `firm_slug '${firmSlug}' not found in audit_sources` });

  let catalog: CatalogEntry[] = [];
  try {
    if (source.source_type === "github_dir") catalog = await fetchGithubDir(source.source_config as { owner: string; repo: string; path: string });
    else if (source.source_type === "github_nested_dir") {
      // Request-level dir paging overrides config, so a cron can walk a huge repo.
      const nestedCfg = { ...(source.source_config as Record<string, unknown>) } as { owner: string; repo: string; path: string; dir_offset?: number; dir_limit?: number };
      if (typeof body.dir_offset === "number") nestedCfg.dir_offset = body.dir_offset;
      if (typeof body.dir_limit === "number") nestedCfg.dir_limit = body.dir_limit;
      catalog = await fetchGithubNestedDir(nestedCfg);
    }
    else if (source.source_type === "github_repo_list") catalog = await fetchGithubRepoList(source.source_config as { org: string; repo_pattern: string });
    else if (source.source_type === "firecrawl_html") catalog = await fetchFirecrawlHtml(source.source_config as { urls?: string[]; url?: string; link_filter?: string; wait_for?: number; use_links?: boolean });
    else if (source.source_type === "jina_html") catalog = await fetchJinaHtml(source.source_config as { urls?: string[]; url?: string; link_filter?: string; use_links?: boolean });
    else return json(400, { error: `Unsupported source_type: ${source.source_type}` });
  } catch (e) { return json(502, { error: "Catalog fetch failed", details: String(e) }); }

  const totalCatalog = catalog.length;
  catalog = catalog.slice(offset, offset + maxEntries);
  if (body.debug) {
    // Diagnostic only: proves whether GITHUB_TOKEN is in effect. Never echoes the token.
    let gh_rate: unknown = null;
    try {
      const rl = await ghJson<{ rate: { limit: number; remaining: number } }>("/rate_limit");
      gh_rate = rl?.rate ? { limit: rl.rate.limit, remaining: rl.rate.remaining, authenticated: rl.rate.limit > 100 } : null;
    } catch { /* diagnostic only */ }
    return json(200, { ok: true, debug: true, gh_rate, gh_last_error: ghLastError, catalog_size: catalog.length, total_catalog: totalCatalog, fetch_notes: fetchNotes, sample: catalog.slice(0, 20) });
  }
  if (catalog.length === 0) return json(200, { ok: true, firm_slug: firmSlug, catalog_size: 0, total_catalog: totalCatalog, offset, fetch_notes: fetchNotes, gh_last_error: ghLastError, note: ghLastError ? "catalog empty: GitHub error (see gh_last_error)" : "empty slice" });

  // Opt-in: the configured path is a dedicated report directory, so every
  // catalog entry is an audit by construction (NON_SC still filters non-SC work).
  const assumeAudits = (source.source_config as { assume_audits?: boolean })?.assume_audits === true;
  const batchSize = 60;
  const batchPromises: Array<Promise<Array<Extracted & { url: string }>>> = [];
  for (let i = 0; i < catalog.length; i += batchSize) {
    const chunk = catalog.slice(i, i + batchSize);
    batchPromises.push(extractBatch(source.firm_name, chunk, assumeAudits).then((rows) => rows.map((e) => ({ ...e, url: chunk[e.n]?.url || "" }))).catch((e) => { console.error(`batch ${i} failed:`, e); return [] as Array<Extracted & { url: string }>; }));
  }
  const batchResults = await Promise.all(batchPromises);
  const extracted: Array<Extracted & { url: string }> = batchResults.flat();

  const sc = extracted.filter((e) => e.is_smart_contract);
  const skipped_non_sc = extracted.length - sc.length;
  const matches = await matchClients(supabase, sc.map((e) => e.client_name));

  let inserted = 0, dupes = 0, pending = 0, pendingDupes = 0, errors = 0;
  const errorSamples: string[] = [];
  const INSERT_CONC = 10;
  for (let i = 0; i < sc.length; i += INSERT_CONC) {
    const chunk = sc.slice(i, i + INSERT_CONC);
    await Promise.all(chunk.map(async (a) => {
      const m = matches.get(a.client_name);
      if (!m || (!m.company_slug && !m.protocol_slug)) {
        const { error: pe } = await supabase.from("companies_pending").insert({
          raw_name: a.client_name, suggested_slug: slugify(a.client_name), source: "audit_scrape", via_firm: source.firm_name,
          first_audit_date: a.audit_date, raw_metadata: { report_url: a.url, audit_type: a.audit_type, language: a.language },
        });
        if (!pe) pending++;
        else if (pe.code === "23505") pendingDupes++;
        else { errors++; if (errorSamples.length < 3) errorSamples.push(`pending(${a.client_name}): ${pe.code} ${pe.message}`); }
        return;
      }
      const { error: ie } = await supabase.from("audit_history").insert({
        protocol_slug: m.protocol_slug, company_slug: m.company_slug, protocol_name: m.protocol_name || a.client_name,
        audit_firm: source.firm_name, audit_date: a.audit_date, audit_type: a.audit_type, report_url: a.url || null,
        smart_contract_language: a.language, data_source: "scrape:" + firmSlug,
      });
      if (!ie) inserted++;
      else if (ie.code === "23505") dupes++;
      else { errors++; if (errorSamples.length < 3) errorSamples.push(`audit(${a.client_name}): ${ie.code} ${ie.message}`); }
    }));
  }

  await supabase.from("audit_sources").update({
    last_scraped_at: new Date().toISOString(),
    last_scrape_stats: { catalog_size: catalog.length, total_catalog: totalCatalog, offset, extracted: extracted.length, smart_contract: sc.length, skipped_non_sc, inserted, dupes, pending, pendingDupes, errors, fetch_notes: fetchNotes },
    updated_at: new Date().toISOString(),
  }).eq("slug", firmSlug);

  return json(200, { ok: true, firm_slug: firmSlug, catalog_size: catalog.length, total_catalog: totalCatalog, offset, extracted: extracted.length, smart_contract: sc.length, skipped_non_sc, inserted, dupes, pending, pendingDupes, errors, fetch_notes: fetchNotes, error_samples: errorSamples });
});
