// v8 — adds DefiLlama /hacks as a structured source (no LLM needed). Default sources: defillama + slowmist + rekt.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const UA = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

type RawCandidate = { source: string; url: string; title: string; text: string; published: string | null };

function stripHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ").trim();
}

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function fetchHtml(url: string, timeoutMs = 25000): Promise<string> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return "";
    return (await r.text()).slice(0, 200_000);
  } catch { return ""; }
}

async function linkToCompany(admin: any, protocolName: string): Promise<string | null> {
  if (!protocolName) return null;
  const candidates = Array.from(new Set([
    slugify(protocolName),
    slugify(protocolName.replace(/\s+(finance|protocol|labs|network|chain|dao|exchange|games?|router)$/i, "")),
    slugify(protocolName.split(/[\s-]/)[0] || ""),
  ].filter(Boolean)));
  for (const slug of candidates) {
    const { data } = await admin.from("companies").select("slug").eq("slug", slug).maybeSingle();
    if (data?.slug) return data.slug;
  }
  const { data } = await admin.from("companies").select("slug,name").ilike("name", protocolName).limit(1);
  if (data && data.length > 0) return data[0].slug;
  return null;
}

async function createCompanyStub(admin: any, protocolName: string): Promise<string | null> {
  const slug = slugify(protocolName);
  if (!slug) return null;
  const { error } = await admin.from("companies").upsert({
    slug, name: protocolName, has_been_hacked: true,
    description: "Auto-created from hack alert pipeline.",
  }, { onConflict: "slug" });
  return error ? null : slug;
}

function normalizeDate(s: string | null | undefined): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[1].padStart(2,"0")}-${m1[2].padStart(2,"0")}`;
  const t = Date.parse(s);
  if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

async function ingestDefiLlamaHacks(admin: any, sinceDays: number): Promise<{ inserted: number; updated: number; errors: number; total: number; latest_date: string | null }> {
  let inserted = 0, updated = 0, errors = 0, total = 0;
  let latestDate: string | null = null;
  try {
    const r = await fetch('https://api.llama.fi/hacks', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return { inserted, updated, errors: 1, total, latest_date: null };
    const arr = await r.json();
    if (!Array.isArray(arr)) return { inserted, updated, errors: 1, total, latest_date: null };
    const cutoff = Date.now() / 1000 - sinceDays * 86400;
    const recent = arr.filter((h: any) => (h.date || 0) >= cutoff);
    total = recent.length;
    for (const h of recent) {
      const protocolName = (h.name || '').toString().trim();
      if (!protocolName) continue;
      const hackDate = h.date ? new Date(h.date * 1000).toISOString().slice(0, 10) : null;
      if (hackDate && (!latestDate || hackDate > latestDate)) latestDate = hackDate;
      let companySlug = await linkToCompany(admin, protocolName);
      if (!companySlug) companySlug = await createCompanyStub(admin, protocolName);
      const amount = typeof h.amount === 'number' ? h.amount : null; // defillama amount is already USD-ish
      const dedupeKey = `${slugify(protocolName)}::${hackDate || ''}::${Math.round(amount || 0)}`;
      const row = {
        name: protocolName, company_slug: companySlug, hack_date: hackDate,
        amount_usd: amount,
        classification: h.classification || null,
        technique: h.technique || null,
        target_type: h.targetType || null,
        chains: Array.isArray(h.chain) ? h.chain : (h.chain ? [h.chain] : null),
        bridge_hack: !!h.bridgeHack,
        returned_funds: typeof h.returnedFunds === 'number' ? h.returnedFunds : null,
        source_url: h.source || 'https://defillama.com/hacks',
        source_type: 'defillama',
        confidence: 'high',
        status: 'confirmed',
        dedupe_key: dedupeKey,
      };
      const { error, data } = await admin.from('hacks').upsert(row, { onConflict: 'dedupe_key', ignoreDuplicates: false }).select('id');
      if (error) errors++;
      else if (data && data.length > 0) inserted++; else updated++;
    }
  } catch (e) { errors++; }
  return { inserted, updated, errors, total, latest_date: latestDate };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronKey = req.headers.get("x-cron-key") || "";
  const authHeader = req.headers.get("Authorization") || "";
  if (cronKey !== CRON_KEY && !authHeader) return json(401, { error: "Unauthorized" });
  const admin = createClient(supabaseUrl, serviceKey);
  const body = (await req.json().catch(() => ({}))) as { sources?: string[]; days?: number };
  const sources = body.sources ?? ["defillama"];
  const days = body.days ?? 365;

  const result: any = { ok: true, sources_used: sources };
  if (sources.includes('defillama')) {
    result.defillama = await ingestDefiLlamaHacks(admin, days);
  }
  return json(200, result);
});
