// v9 — single deep-scroll per source. Aggressive 20-scroll waits to load all programs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CANONICAL = "HackenProof";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

async function firecrawl(url: string, scrollCount = 20): Promise<{ md: string; links: string[] } | null> {
  const key = Deno.env.get("FIRECRAWL_API_KEY"); if (!key) return null;
  const actions: any[] = [{ type: "wait", milliseconds: 5000 }];
  for (let i = 0; i < scrollCount; i++) {
    actions.push({ type: "scroll", direction: "down" });
    actions.push({ type: "wait", milliseconds: 1500 });
  }
  try {
    const r = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ url, formats: ["markdown", "links", "html"], onlyMainContent: false, waitFor: 8000, timeout: 130000, actions }),
    });
    if (!r.ok) return null;
    const j = await r.json(); if (!j?.data) return null;
    return { md: (j.data.markdown || "") + "\n" + (j.data.html || "").slice(0, 80000), links: j.data.links || [] };
  } catch { return null; }
}

function slugify(s: string): string { return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }
function stripSuffixes(slug: string): string {
  return slug
    .replace(/-(web-and-api|web-and-mobile|app-and-api|web-and-app|web-and-mobile-and-api|api-and-mobile|web-app|mobile-app|smart-contracts|smart-contract|sc|exchange|web|app|mobile|api)$/i, "")
    .replace(/-(network|protocol|finance|labs|labs-inc|inc|io|fi|xyz|tech|dao|foundation|capital)$/i, "");
}
async function fetchAllCompanies(admin: any): Promise<Array<{ slug: string; name: string }>> {
  const out: Array<{ slug: string; name: string }> = [];
  const PAGE = 1000;
  for (let off = 0; off < 50000; off += PAGE) {
    const { data, error } = await admin.from("companies").select("slug,name").range(off, off + PAGE - 1);
    if (error || !data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}
function parsePrograms(md: string, links: string[], pathPrefix: string): Array<{ name: string; slug: string; url: string }> {
  const out: Array<{ name: string; slug: string; url: string }> = [];
  const seen = new Set<string>();
  const re = new RegExp(`\\[([^\\]]+?)\\]\\((https?:\\/\\/hackenproof\\.com${pathPrefix}\\/([\\w-]+)[^)]*)\\)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const name = m[1].replace(/\s+/g, " ").trim(); const url = m[2]; const sl = m[3];
    if (!sl || seen.has(sl)) continue;
    seen.add(sl);
    out.push({ name: name && !/^(home|next|prev|read more|view|all|programs|audit programs|hackenproof|active|paused|closed)$/i.test(name) ? name : sl.replace(/-/g, " "), slug: sl, url });
  }
  for (const u of links) {
    const mm = u.match(new RegExp(`^https?:\\/\\/hackenproof\\.com${pathPrefix}\\/([\\w-]+)`));
    if (mm && !seen.has(mm[1])) { seen.add(mm[1]); out.push({ name: mm[1].replace(/-/g, " "), slug: mm[1], url: u }); }
  }
  return out;
}
function findMatch(p: { name: string; slug: string }, idx: { bySlug: Map<string, any>; byNormName: Map<string, any>; byStrippedSlug: Map<string, any> }) {
  const cands = [p.slug.toLowerCase(), stripSuffixes(p.slug), slugify(p.name), stripSuffixes(slugify(p.name))];
  for (const base of [p.slug.toLowerCase(), slugify(p.name)]) if (base) cands.push(`${base}-network`, `${base}-protocol`, `${base}-finance`, `${base}-labs`);
  for (const c of cands) {
    if (!c) continue;
    if (idx.bySlug.has(c)) return idx.bySlug.get(c);
    if (idx.byNormName.has(c)) return idx.byNormName.get(c);
    if (idx.byStrippedSlug.has(c)) return idx.byStrippedSlug.get(c);
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (req.headers.get("x-cron-key") !== CRON_KEY) return json(401, { error: "Unauthorized" });
  const admin = createClient(supabaseUrl, serviceKey);
  const body = (await req.json().catch(() => ({}))) as { source?: "programs" | "audit-programs"; debug?: boolean };
  const source = body.source || "programs";
  const debug = body.debug === true;
  const pathPrefix = source === "programs" ? "/programs" : "/audit-programs";

  const companies = await fetchAllCompanies(admin);
  const idx = { bySlug: new Map<string, any>(), byNormName: new Map<string, any>(), byStrippedSlug: new Map<string, any>() };
  for (const c of companies) {
    idx.bySlug.set(c.slug.toLowerCase(), c);
    const nn = slugify(c.name); if (nn && !idx.byNormName.has(nn)) idx.byNormName.set(nn, c);
    const st = stripSuffixes(c.slug); if (st && st !== c.slug && !idx.byStrippedSlug.has(st)) idx.byStrippedSlug.set(st, c);
  }

  const md = await firecrawl(`https://hackenproof.com${pathPrefix}`, 20);
  if (!md) return json(502, { error: "firecrawl failed" });
  const programs = parsePrograms(md.md, md.links, pathPrefix);

  let matched = 0, inserted = 0, updated = 0, unmatched = 0;
  const matched_samples: any[] = [];
  const unmatched_samples: any[] = [];
  for (const p of programs) {
    const match = findMatch(p, idx);
    if (!match) { unmatched++; if (unmatched_samples.length < 10) unmatched_samples.push({ hp: p.slug, name: p.name }); continue; }
    matched++;
    if (matched_samples.length < 10) matched_samples.push({ hp: p.slug, slug: match.slug });
    if (debug) continue;
    if (source === "programs") {
      const row = { protocol_slug: match.slug, company_slug: match.slug, platform: CANONICAL, program_url: p.url, is_active: true, last_updated: new Date().toISOString() };
      const { data: existing } = await admin.from("bug_bounties").select("id").eq("company_slug", match.slug).eq("platform", CANONICAL).limit(1);
      if (existing && existing.length > 0) {
        if (!(await admin.from("bug_bounties").update(row).eq("id", existing[0].id)).error) updated++;
      } else if (!(await admin.from("bug_bounties").insert(row)).error) inserted++;
      await admin.from("companies").update({ has_bug_bounty: true }).eq("slug", match.slug).or("has_bug_bounty.is.null,has_bug_bounty.eq.false");
    } else {
      const { data: dup } = await admin.from("audit_history").select("id").eq("company_slug", match.slug).eq("audit_firm", CANONICAL).eq("report_url", p.url).limit(1);
      if (dup && dup.length > 0) continue;
      if (!(await admin.from("audit_history").insert({ company_slug: match.slug, protocol_name: match.name, audit_firm: CANONICAL, audit_date: new Date().toISOString().slice(0, 10), report_url: p.url, data_source: "hackenproof_audit_programs" })).error) inserted++;
    }
  }
  return json(200, { ok: true, source, discovered: programs.length, matched, inserted, updated, unmatched, matched_samples, unmatched_samples });
});
