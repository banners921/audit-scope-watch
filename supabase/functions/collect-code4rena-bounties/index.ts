// collect-code4rena-bounties — Code4rena bounty programs.
//
// Cron-driven. Three guards over the original version:
//   1. x-cron-key auth, because the function is deployed with verify_jwt=false
//      so that pg_cron can reach it. Without this gate the endpoint would be
//      open to anyone and every call spends Firecrawl + Anthropic credits.
//   2. company_slug is written ONLY when a companies row actually exists. An
//      unmatched program keeps protocol_slug and leaves company_slug blank for
//      the enrichment drain to resolve under the two-source rule. Never mint a
//      company from a scraped program name.
//   3. The index pass is separated from the deep pass. The index pass is cheap
//      (a few pages) and refreshes last_updated / is_active for every program
//      already on file, so freshness and closures are tracked every run. The
//      deep pass costs one Firecrawl scrape + one model call per program and is
//      therefore capped, and spent only on programs we have never seen.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder can never equal a caller-supplied header, so an unset
// CRON_KEY secret denies every request instead of authorising them.

const PLATFORM = "Code4rena";
const INDEX_URLS = ["https://code4rena.com/bounties", "https://code4rena.com/competitions", "https://code4rena.com/audits"];
const PROGRAM_RE = /https?:\/\/(?:www\.)?code4rena\.com\/(?:bounties|competitions|audits|reports)\/[a-zA-Z0-9_-]+/gi;
const SITEMAP_URLS: string[] = [];
const EXTRACT_SYSTEM = "Code4rena runs competitive audits and bounty programs. Extract the protocol the program is for (never Code4rena itself) and the max USD payout if the page states one. Return ONLY JSON: {\"protocol_name\": string, \"max_bounty_usd\": number | null}. Use null for max_bounty_usd when the page states no figure; never guess one.";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

/** Sitemaps are plain XML over a normal fetch: no Firecrawl credits spent. */
async function fetchSitemap(url: string): Promise<string[]> {
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const txt = await r.text();
    return txt.match(/https?:\/\/[^<\s"']+/g) || [];
  } catch { return []; }
}

// Firecrawl failures used to be swallowed as a bare null, which made a dead
// plan or an expired key look identical to "the site had nothing". Record the
// last status so the run reports why discovery came back empty.
const fcDiag: { last_status: number | null; last_error: string | null; calls: number; ok: number } = { last_status: null, last_error: null, calls: 0, ok: 0 };

async function fcScrape(url: string, waitMs = 5000): Promise<{ md: string; links: string[] } | null> {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) { fcDiag.last_error = "FIRECRAWL_API_KEY unset"; return null; }
  fcDiag.calls++;
  try {
    const r = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown", "links", "html"], timeout: 35000, waitFor: waitMs, onlyMainContent: false }),
    });
    fcDiag.last_status = r.status;
    if (!r.ok) { fcDiag.last_error = (await r.text().catch(() => "")).slice(0, 180); return null; }
    const j = await r.json();
    if (!j?.data) { fcDiag.last_error = "no data field in firecrawl response"; return null; }
    fcDiag.ok++;
    return { md: (j.data.markdown || j.data.content || "") + "\n" + (j.data.html || "").slice(0, 30000), links: j.data.links || [] };
  } catch (e) { fcDiag.last_error = String(e).slice(0, 180); return null; }
}

function extractJson(s: string): any {
  if (!s) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : s;
  const start = candidate.indexOf("{"), end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

async function llmExtract(text: string, url: string): Promise<{ protocol_name: string; max_bounty_usd: number | null } | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5", max_tokens: 400, system: EXTRACT_SYSTEM,
        messages: [{ role: "user", content: `URL: ${url}\n\n${text.slice(0, 9000)}` }],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const parsed = extractJson(j?.content?.[0]?.text || "");
    if (!parsed?.protocol_name) return null;
    const name = String(parsed.protocol_name).trim();
    if (!name || /^(unknown|n\/a|none|null)$/i.test(name)) return null;
    return { protocol_name: name, max_bounty_usd: typeof parsed.max_bounty_usd === "number" ? parsed.max_bounty_usd : null };
  } catch { return null; }
}

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/**
 * Resolve a scraped program name to an existing company.
 * Two exact lookups rather than one .or() filter: a protocol name containing a
 * comma or parenthesis would otherwise corrupt a PostgREST .or() expression.
 * Returns null when nothing matches — the caller must not invent a company.
 */
async function resolveCompany(sb: any, slug: string, name: string): Promise<string | null> {
  const { data: bySlug } = await sb.from("companies").select("slug").eq("slug", slug).limit(1);
  if (bySlug?.length) return bySlug[0].slug as string;
  const { data: byName } = await sb.from("companies").select("slug,name").ilike("name", name).limit(5);
  const hit = (byName ?? []).find((c: any) => (c.name || "").toLowerCase() === name.toLowerCase());
  return hit ? (hit.slug as string) : null;
}

function discoverFrom(page: { md: string; links: string[] }, into: Set<string>) {
  for (const link of page.links) {
    const m = String(link).match(PROGRAM_RE);
    if (m) m.forEach((u: string) => into.add(u));
  }
  const fromMd = page.md.match(PROGRAM_RE);
  if (fromMd) fromMd.forEach((u: string) => into.add(u));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.headers.get("x-cron-key") !== CRON_KEY) return json(401, { error: "Unauthorized" });

  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const limit = Math.min(Number(body.limit ?? 12), 60);
  const explicitUrls = body.urls as string[] | undefined;
  const allowClosures = body.closures !== false;

  // ---- index pass (cheap) --------------------------------------------------
  const discovered = new Set<string>();
  let indexPagesOk = 0;
  if (explicitUrls?.length) {
    for (const u of explicitUrls) discovered.add(u);
  } else {
    for (const sm of SITEMAP_URLS) {
      const links = await fetchSitemap(sm);
      if (links.length === 0) continue;
      indexPagesOk++;
      for (const l of links) {
        const m = l.match(PROGRAM_RE);
        if (m) m.forEach((u: string) => discovered.add(u));
      }
    }
    for (const u of INDEX_URLS) {
      const page = await fcScrape(u, 5000);
      if (!page) continue;
      indexPagesOk++;
      discoverFrom(page, discovered);
    }
  }
  const discoveredLc = new Set(Array.from(discovered).map((u) => u.toLowerCase()));

  const { data: existing } = await sb
    .from("bug_bounties")
    .select("id,program_url,protocol_slug,company_slug,is_active")
    .eq("platform", PLATFORM);
  const rows = (existing ?? []) as Array<{ id: string; program_url: string | null; protocol_slug: string | null; company_slug: string | null; is_active: boolean | null }>;
  const knownLc = new Set(rows.map((r) => (r.program_url || "").toLowerCase()).filter(Boolean));

  const nowIso = new Date().toISOString();
  let refreshed = 0, reopened = 0, closed = 0;
  let closure_check = "skipped";

  if (explicitUrls?.length) {
    closure_check = "skipped:explicit_urls";
  } else if (indexPagesOk === 0) {
    closure_check = "skipped:index_unreachable";
  } else {
    // Only trust the index enough to close programs when it returned a
    // plausible share of what we already hold. A partial or rate-limited
    // scrape must never mass-deactivate a platform's programs.
    const activeKnown = rows.filter((r) => r.is_active !== false).length;
    const trustworthy = discovered.size >= Math.max(3, Math.floor(activeKnown * 0.6));

    for (const r of rows) {
      const seen = r.program_url ? discoveredLc.has(r.program_url.toLowerCase()) : false;
      if (seen) {
        const patch: Record<string, unknown> = { last_updated: nowIso };
        if (r.is_active === false) { patch.is_active = true; reopened++; }
        if (!(await sb.from("bug_bounties").update(patch).eq("id", r.id)).error) refreshed++;
      } else if (trustworthy && allowClosures && r.is_active !== false) {
        if (!(await sb.from("bug_bounties").update({ is_active: false, last_updated: nowIso }).eq("id", r.id)).error) closed++;
      }
    }
    closure_check = trustworthy ? (allowClosures ? "applied" : "disabled_by_caller") : "skipped:index_too_thin";
  }

  // ---- deep pass (one Firecrawl + one model call per program) --------------
  const toScan = Array.from(discovered).filter((u) => !knownLc.has(u.toLowerCase())).slice(0, limit);

  let inserted = 0, updated = 0, unresolved_company = 0;
  const results: any[] = [];
  for (const pUrl of toScan) {
    const page = await fcScrape(pUrl, 3500);
    if (!page) { results.push({ url: pUrl, status: "fc_failed" }); continue; }
    const x = await llmExtract(page.md, pUrl);
    if (!x) { results.push({ url: pUrl, status: "extract_failed" }); continue; }
    const slug = slugify(x.protocol_name);
    if (!slug) { results.push({ url: pUrl, status: "no_slug" }); continue; }

    const companySlug = await resolveCompany(sb, slug, x.protocol_name);
    if (!companySlug) unresolved_company++;

    const row = {
      protocol_slug: slug,
      company_slug: companySlug,          // null when no company row exists
      platform: PLATFORM,
      max_bounty_usd: x.max_bounty_usd,
      program_url: pUrl,
      is_active: true,
      last_updated: nowIso,
    };
    const { error } = await sb.from("bug_bounties").upsert(row, { onConflict: "protocol_slug,platform" });
    if (error) { results.push({ url: pUrl, status: "db_err", err: error.message.slice(0, 90) }); continue; }
    inserted++;
    if (companySlug) await sb.from("companies").update({ has_bug_bounty: true }).eq("slug", companySlug);
    results.push({ url: pUrl, status: "ok", protocol: x.protocol_name, max: x.max_bounty_usd, company_slug: companySlug });
    await new Promise((r) => setTimeout(r, 400));
  }

  await sb.from("bounty_sources").update({
    last_scraped_at: nowIso,
    last_scrape_stats: { firecrawl: fcDiag, found: discovered.size, index_pages_ok: indexPagesOk, scanned: toScan.length, inserted, refreshed, reopened, closed, unresolved_company, closure_check },
  }).eq("platform", PLATFORM);

  return json(200, {
    ok: true, platform: PLATFORM,
    found: discovered.size, index_pages_ok: indexPagesOk,
    known: rows.length, scanned: toScan.length,
    inserted, updated, refreshed, reopened, closed, unresolved_company, closure_check,
    firecrawl: fcDiag,
    results: results.slice(0, 10),
  });
});
