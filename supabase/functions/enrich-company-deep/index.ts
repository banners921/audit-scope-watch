// enrich-company-deep — fills url/twitter/github/linkedin/desc/logo/category
// for every "dark" company. Two-tier strategy:
//   A) Has URL: Jina-scrape homepage + Claude extracts socials/desc.
//   B) No URL:  Claude proposes canonical URL/handles from knowledge → HEAD verify → scrape.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

function extractDomain(url: string | null): string | null {
  if (!url) return null;
  try { const u = new URL(url.startsWith("http") ? url : `https://${url}`); return u.hostname.toLowerCase().replace(/^www\./, "") || null; } catch { return null; }
}
function normTwitter(t: string | null | undefined): string | null {
  if (!t) return null;
  const s = String(t).trim().replace(/^@/, "").replace(/^https?:\/\/(www\.|mobile\.)?(twitter|x)\.com\//i, "").replace(/\/$/, "").split(/[?#]/)[0];
  if (!s || s.length > 30 || s.includes(" ")) return null;
  return s;
}
function normGithub(g: string | null | undefined): string | null {
  if (!g) return null;
  const s = String(g).trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/$/, "").split(/[?#]/)[0];
  if (!s || s.length > 60 || s.includes(" ") || s.includes("/blob/")) return null;
  return s;
}
function normLinkedin(l: string | null | undefined): string | null {
  if (!l) return null;
  const s = String(l).trim().replace(/^https?:\/\/(www\.|[a-z]{2}\.)?linkedin\.com\//i, "").replace(/\/$/, "").split(/[?#]/)[0];
  if (!s) return null;
  return `https://linkedin.com/${s}`;
}

async function jinaText(url: string): Promise<string | null> {
  try {
    const r = await fetch(`https://r.jina.ai/${url}`, { headers: { "User-Agent": "AuditScope/1.0", "X-Return-Format": "text" } });
    if (!r.ok) return null;
    const t = await r.text();
    return t.length > 300 ? t.slice(0, 15_000) : null;
  } catch { return null; }
}

async function urlExists(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctrl.signal });
    clearTimeout(tid);
    return r.ok || r.status === 403; // 403 = Cloudflare, still real
  } catch { return false; }
}

function extractJson(s: string): any {
  if (!s) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : s;
  const start = candidate.indexOf("{"); const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

const PROMPT_FROM_PAGE = `Extract canonical company metadata from this webpage. Return ONLY JSON:

{
  "description": string | null,   // 1-2 sentence factual description of what this protocol/company does. No fluff. Max 280 chars.
  "category": string | null,      // Single category: DEX, Lending, Yield, Derivatives, CDP, Bridge, Liquid Staking, Insurance, Privacy, Stablecoin, L1, L2, RWA, AI, Gaming, Wallet, Tooling, Infrastructure, NFT, Social, Payments, Other.
  "twitter": string | null,       // bare handle (no @, no URL), e.g. "aaveaave"
  "github": string | null,        // bare org/repo, e.g. "aave"
  "linkedin": string | null,      // bare slug, e.g. "company/aavedao"
  "discord": string | null,       // bare invite code or null
  "telegram": string | null,      // bare handle
  "logo_url": string | null       // direct image URL if visible in head/og:image or top-of-page logo
}

Rules:
- Lead with WHAT it is and chain/standard. No "revolutionary", "cutting-edge".
- Skip cookie banners, navigation, footer boilerplate.
- For socials, only return values actually linked from the page.
- Logo URL should be a real image URL (look for og:image meta tag or visible logo).`;

const PROMPT_FROM_KNOWLEDGE = `Given this crypto/web3 company/protocol name, return canonical metadata from your knowledge. Return ONLY JSON:

{
  "url": string | null,           // canonical website e.g. "https://aave.com". Must be a real URL you're confident exists.
  "description": string | null,   // 1-2 sentence factual description. Max 280 chars.
  "category": string | null,      // Single category: DEX, Lending, Yield, Derivatives, CDP, Bridge, Liquid Staking, Insurance, Privacy, Stablecoin, L1, L2, RWA, AI, Gaming, Wallet, Tooling, Infrastructure, NFT, Social, Payments, Other.
  "twitter": string | null,       // bare handle
  "github": string | null,        // bare org
  "confidence": "high" | "medium" | "low"
}

Rules:
- If unsure the company exists or could be confused with similar names, return confidence:"low" and nulls.
- Don't hallucinate URLs. Only return URLs you're confident about.
- Skip generic-sounding names that could be 100 different projects.`;

async function callAnthropic(apiKey: string, system: string, user: string, maxTok = 600): Promise<any | null> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5", max_tokens: maxTok, system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return extractJson(j?.content?.[0]?.text || "");
}

async function enrichFromPage(apiKey: string, name: string, url: string): Promise<any | null> {
  const text = await jinaText(url);
  if (!text) return null;
  return await callAnthropic(apiKey, PROMPT_FROM_PAGE, `Company: ${name}\nURL: ${url}\n\nPage content:\n${text}`, 800);
}

async function enrichFromKnowledge(apiKey: string, name: string, hint?: string): Promise<any | null> {
  const user = hint ? `Name: ${name}\nContext: ${hint}` : `Name: ${name}`;
  return await callAnthropic(apiKey, PROMPT_FROM_KNOWLEDGE, user, 500);
}

async function processOne(admin: any, anthropicKey: string, c: any): Promise<"enriched" | "unknown" | "error"> {
  try {
    const updates: any = { description_generated_at: new Date().toISOString() };
    let pageData: any = null;
    let knowledgeData: any = null;
    let workingUrl = c.url || null;

    // TIER A: have URL → scrape page
    if (workingUrl && /^https?:\/\//i.test(workingUrl)) {
      pageData = await enrichFromPage(anthropicKey, c.name, workingUrl);
    }

    // TIER B: no URL, or page failed → ask Claude from knowledge
    if (!pageData || !pageData.description) {
      let context = "";
      if (c.category) context += `Existing category: ${c.category}. `;
      if (c.audit_count && c.audit_count > 0) {
        const { data: audits } = await admin.from("audit_history").select("audit_firm").eq("company_slug", c.slug).limit(2);
        if (audits && audits.length > 0) context += `Audited by: ${audits.map((a: any) => a.audit_firm).join(", ")}.`;
      }
      knowledgeData = await enrichFromKnowledge(anthropicKey, c.name, context.trim() || undefined);
      if (knowledgeData?.confidence === "low" && !pageData) {
        await admin.from("companies").update(updates).eq("slug", c.slug);
        return "unknown";
      }
      // If knowledge gave a URL we don't have, verify + scrape
      if (knowledgeData?.url && !workingUrl) {
        const exists = await urlExists(knowledgeData.url);
        if (exists) {
          workingUrl = knowledgeData.url;
          updates.url = workingUrl;
          // Try to scrape now that we have a URL
          pageData = await enrichFromPage(anthropicKey, c.name, workingUrl);
        }
      }
    }

    // Merge results: pageData wins over knowledgeData where both present
    const desc = pageData?.description || knowledgeData?.description;
    const cat = pageData?.category || knowledgeData?.category;
    const tw = normTwitter(pageData?.twitter || knowledgeData?.twitter);
    const gh = normGithub(pageData?.github || knowledgeData?.github);
    const li = normLinkedin(pageData?.linkedin);
    const discord = pageData?.discord || null;
    const telegram = pageData?.telegram || null;
    const logoUrl = pageData?.logo_url || null;

    if (desc && (!c.description || c.description.trim() === "")) updates.description = String(desc).slice(0, 600);
    if (cat && !c.category) updates.category = String(cat).slice(0, 80);
    if (tw && !c.twitter) updates.twitter = tw;
    if (gh && (!c.github || c.github.length === 0)) updates.github = [gh];
    if (li && !c.linkedin) updates.linkedin = li;
    if (discord && !c.discord) updates.discord = String(discord).slice(0, 100);
    if (telegram && !c.telegram) updates.telegram = String(telegram).slice(0, 60);
    if (logoUrl && (!c.logo || c.logo === "") && /^https?:\/\//i.test(logoUrl)) updates.logo = logoUrl.slice(0, 500);

    const wroteAnyContent = Object.keys(updates).length > 1; // more than just description_generated_at
    await admin.from("companies").update(updates).eq("slug", c.slug);
    return wroteAnyContent ? "enriched" : "unknown";
  } catch { return "error"; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return json(500, { error: "Missing ANTHROPIC_API_KEY" });
  const cronKey = req.headers.get("x-cron-key") || "";
  if (cronKey !== CRON_KEY) return json(401, { error: "Unauthorized" });
  const admin = createClient(supabaseUrl, serviceKey);
  const body = (await req.json().catch(() => ({}))) as { limit?: number; concurrency?: number; slug?: string; mode?: "priority" | "any" };
  const limit = Math.min(Math.max(body.limit ?? 40, 1), 100);
  const concurrency = Math.min(Math.max(body.concurrency ?? 5, 1), 10);
  const mode = body.mode || "priority";

  let query = admin.from("companies")
    .select("slug,name,url,description,logo,twitter,github,linkedin,discord,telegram,category,audit_count,total_raised_usd")
    .or("description.is.null,description.eq.")
    .is("description_generated_at", null);
  if (body.slug) query = query.eq("slug", body.slug);
  else if (mode === "priority") {
    // Prioritize: has URL OR has audits OR has funding
    query = query.or("url.not.is.null,audit_count.gt.0,total_raised_usd.gt.0");
  }
  // "any" mode — no extra filter, takes everything missing description
  query = query.order("audit_count", { ascending: false, nullsFirst: false }).limit(limit);
  const { data: rows } = await query;
  if (!rows || rows.length === 0) return json(200, { ok: true, scanned: 0, note: "no candidates" });

  let enriched = 0, unknown = 0, errs = 0;
  for (let i = 0; i < rows.length; i += concurrency) {
    const chunk = rows.slice(i, i + concurrency);
    const outcomes = await Promise.all(chunk.map((c: any) => processOne(admin, anthropicKey, c)));
    for (const o of outcomes) {
      if (o === "enriched") enriched++;
      else if (o === "unknown") unknown++;
      else errs++;
    }
  }
  return json(200, { ok: true, mode, scanned: rows.length, enriched, unknown, errors: errs });
});
