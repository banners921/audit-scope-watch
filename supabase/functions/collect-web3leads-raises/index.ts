// v13 — auto-create fund rows for unknown investors as funding rounds come in.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const W3L_URL = "https://wwwfoeuebjmbuxqwwpjq.supabase.co/functions/v1/web3leads-api";
const PAGE_SIZE = 100;

function json(status: number, body: unknown) { return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } }); }
function slugify(s: string | null | undefined): string {
  return (s || "").toString().toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    let host = u.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    return host || null;
  } catch { return null; }
}
function normalizeTwitter(t: string | null | undefined): string | null {
  if (!t) return null;
  const s = String(t).trim().replace(/^@/, "").replace(/^https?:\/\/(www\.|mobile\.)?(twitter|x)\.com\//i, "").replace(/\/$/, "");
  if (!s || s.includes(" ")) return null;
  return s;
}
function parseAmount(s: any): number | null {
  if (s == null) return null;
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  const str = String(s).trim();
  if (!str || /undisclosed|n\/?a|unknown|tba/i.test(str)) return null;
  const m = str.replace(/[,$\s]/g, "").match(/^(\d+(?:\.\d+)?)([kmb])?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] || "").toLowerCase();
  if (unit === "k") return Math.round(n * 1e3);
  if (unit === "m") return Math.round(n * 1e6);
  if (unit === "b") return Math.round(n * 1e9);
  return Math.round(n);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const w3lKey = Deno.env.get("WEB3LEADS_API_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Missing Supabase env" });
  if (!w3lKey) return json(500, { error: "Missing WEB3LEADS_API_KEY secret" });

  const cronKey = req.headers.get("x-cron-key") || "";
  if (cronKey !== CRON_KEY) return json(401, { error: "Unauthorized" });
  const admin = createClient(supabaseUrl, serviceKey);

  let body: any = {};
  try { body = await req.json().catch(() => ({})); } catch { /* */ }
  const days = typeof body?.days === "number" ? body.days : 90;
  const sinceDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const maxPages = typeof body?.max_pages === "number" ? Math.max(1, Math.min(50, body.max_pages)) : 5;
  const dryRun = body?.dry_run === true;

  let allRows: any[] = [];
  let pageError: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const reqBody = {
      resource: "funding_rounds",
      filter: { date: { op: "gte", value: sinceDate } },
      include: ["investors", "company"],
      order: { column: "date", ascending: false },
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    };
    let resp: Response;
    try {
      resp = await fetch(W3L_URL, { method: "POST", headers: { "x-api-key": w3lKey, "Content-Type": "application/json" }, body: JSON.stringify(reqBody) });
    } catch (e) { pageError = `fetch_failed: ${e instanceof Error ? e.message : String(e)}`; break; }
    if (!resp.ok) { const txt = await resp.text().catch(() => ""); pageError = `web3leads_${resp.status}: ${txt.slice(0, 200)}`; break; }
    const j = await resp.json().catch(() => null);
    const rows = Array.isArray(j) ? j : (j?.data || j?.rows || j?.results || []);
    if (!Array.isArray(rows) || rows.length === 0) break;
    allRows = allRows.concat(rows);
    if (rows.length < PAGE_SIZE) break;
  }
  if (pageError) return json(502, { ok: false, error: pageError, fetched: allRows.length, days, since_date: sinceDate });
  if (allRows.length === 0) return json(200, { ok: true, fetched: 0, summary: { fetched: 0 }, days, since_date: sinceDate });

  // Load companies + funds maps for matching
  const { data: allCompanies } = await admin.from("companies").select("slug,name,url,logo,category,description");
  const bySlug = new Map<string, any>();
  const byDomain = new Map<string, any>();
  const byNormName = new Map<string, any>();
  for (const c of (allCompanies || [])) {
    bySlug.set(c.slug, c);
    const d = extractDomain(c.url);
    if (d && !byDomain.has(d)) byDomain.set(d, c);
    const nn = slugify(c.name);
    if (nn && !byNormName.has(nn)) byNormName.set(nn, c);
  }

  const { data: allFunds } = await admin.from("funds").select("slug,name,website,twitter,logo");
  const fundsBySlug = new Map<string, any>();
  const fundsByNormName = new Map<string, any>();
  for (const f of (allFunds || []) as any[]) {
    fundsBySlug.set(f.slug, f);
    const nn = slugify(f.name);
    if (nn && !fundsByNormName.has(nn)) fundsByNormName.set(nn, f);
  }

  // ---- Step A: harvest unique investors from this batch and upsert fund rows ----
  type FundCandidate = { name: string; website: string | null; twitter: string | null; logo: string | null; description: string | null };
  const fundCandidates = new Map<string, FundCandidate>();
  for (const r of allRows) {
    const invArr: any[] = Array.isArray(r.funding_round_investors) ? r.funding_round_investors : [];
    for (const inv of invArr) {
      const fobj = inv?.fund || (typeof inv === "object" ? inv : null);
      const nm = fobj?.name || (typeof inv === "string" ? inv : null);
      if (!nm || typeof nm !== "string" || nm.length < 2 || nm.length > 100) continue;
      const slug = slugify(nm);
      if (!slug || slug.length < 2) continue;
      // Already known fund? skip
      if (fundsBySlug.has(slug) || fundsByNormName.has(slug)) continue;
      // Aggregate: prefer more data from later occurrences
      const ex = fundCandidates.get(slug);
      const candidate: FundCandidate = {
        name: ex?.name || nm,
        website: ex?.website || fobj?.website || fobj?.url || null,
        twitter: ex?.twitter || normalizeTwitter(fobj?.twitter) || null,
        logo: ex?.logo || fobj?.logo_url_2 || fobj?.logo_url || fobj?.logo || null,
        description: ex?.description || fobj?.description || fobj?.about || null,
      };
      fundCandidates.set(slug, candidate);
    }
  }
  const newFundsSummary = { proposed: fundCandidates.size, created: 0, collisions: 0, errors: 0 };
  if (fundCandidates.size > 0 && !dryRun) {
    // Bulk pre-check what's already in the DB (covers race conditions when other funds got created in parallel)
    const slugs = Array.from(fundCandidates.keys());
    const { data: existing } = await admin.from("funds").select("slug").in("slug", slugs);
    const existingSet = new Set((existing || []).map((x: any) => x.slug));
    const inserts: any[] = [];
    for (const [slug, cand] of fundCandidates) {
      if (existingSet.has(slug)) { newFundsSummary.collisions++; continue; }
      inserts.push({
        slug,
        name: cand.name,
        website: cand.website,
        twitter: cand.twitter,
        logo: cand.logo,
        description: cand.description ? String(cand.description).slice(0, 2000) : null,
        data_source: "web3leads_round_investors",
      });
    }
    if (inserts.length > 0) {
      const { error: insErr, data: insData } = await admin.from("funds").insert(inserts).select("slug,name,website,twitter,logo");
      if (insErr) {
        newFundsSummary.errors++;
      } else {
        newFundsSummary.created = insData?.length || 0;
        // Add to our in-memory map so subsequent runs see them
        for (const f of (insData || []) as any[]) {
          fundsBySlug.set(f.slug, f);
          fundsByNormName.set(slugify(f.name), f);
        }
      }
    }
  }

  // ---- Step B: match companies and create stubs as before ----
  type Proc = { r: any; cName: string; cWebsite: string | null; cLogo: string | null; cCategory: string | null; cDesc: string | null; matched: any };
  const processed: Proc[] = [];
  for (const r of allRows) {
    const cd = r.company_data || {};
    const cName = cd.name || (typeof r.company === "string" ? r.company : null);
    if (!cName) continue;
    const cWebsite = cd.website || null;
    const cLogo = cd.logo_url || cd.logo_url_2 || null;
    const cCategory = cd.category || r.category || null;
    const cDesc = cd.description || cd.about || null;
    const dom = extractDomain(cWebsite);
    let matched: any = null;
    if (dom && byDomain.has(dom)) matched = byDomain.get(dom);
    if (!matched) {
      const ns = slugify(cName);
      if (byNormName.has(ns)) matched = byNormName.get(ns);
      else if (bySlug.has(ns)) matched = bySlug.get(ns);
    }
    processed.push({ r, cName, cWebsite, cLogo, cCategory, cDesc, matched });
  }

  const summary = { fetched: allRows.length, matched: 0, inserted: 0, skipped_dup: 0, unmatched: 0, logos_updated: 0, categories_updated: 0, descriptions_updated: 0, urls_updated: 0, new_companies: { created: 0 }, new_funds: newFundsSummary, orphan_slugs_fixed: 0, errors: 0 };
  const errorSamples: any[] = [];

  for (const p of processed) {
    if (p.matched) {
      summary.matched++;
      if (dryRun) continue;
      const updates: Record<string, any> = {};
      if (!p.matched.logo && p.cLogo) updates.logo = p.cLogo;
      if (!p.matched.category && p.cCategory) updates.category = p.cCategory;
      if (!p.matched.url && p.cWebsite) updates.url = p.cWebsite;
      if ((!p.matched.description || p.matched.description.trim() === "") && p.cDesc) updates.description = p.cDesc;
      if (Object.keys(updates).length > 0) {
        const { error } = await admin.from("companies").update(updates).eq("slug", p.matched.slug);
        if (!error) {
          if ("logo" in updates) summary.logos_updated++;
          if ("category" in updates) summary.categories_updated++;
          if ("url" in updates) summary.urls_updated++;
          if ("description" in updates) summary.descriptions_updated++;
          p.matched = { ...p.matched, ...updates };
        } else { summary.errors++; if (errorSamples.length < 3) errorSamples.push({ phase: "update_company", slug: p.matched.slug, error: error.message }); }
      }
    } else {
      if (dryRun) { summary.unmatched++; continue; }
      const baseSlug = slugify(p.cName);
      if (!baseSlug) { summary.unmatched++; continue; }
      const { data: existing } = await admin.from("companies").select("slug,name,logo,url,category,description").eq("slug", baseSlug).maybeSingle();
      if (existing) {
        p.matched = existing;
        summary.matched++;
        const updates: Record<string, any> = {};
        if (!existing.logo && p.cLogo) updates.logo = p.cLogo;
        if (!existing.category && p.cCategory) updates.category = p.cCategory;
        if (!existing.url && p.cWebsite) updates.url = p.cWebsite;
        if ((!existing.description || existing.description.trim() === "") && p.cDesc) updates.description = p.cDesc;
        if (Object.keys(updates).length > 0) {
          const { error } = await admin.from("companies").update(updates).eq("slug", baseSlug);
          if (!error) {
            if ("logo" in updates) summary.logos_updated++;
            if ("category" in updates) summary.categories_updated++;
            if ("url" in updates) summary.urls_updated++;
            if ("description" in updates) summary.descriptions_updated++;
            p.matched = { ...existing, ...updates };
          }
        }
        bySlug.set(baseSlug, p.matched);
        byNormName.set(slugify(p.cName), p.matched);
      } else {
        const insertRow = {
          slug: baseSlug, name: p.cName, url: p.cWebsite || null, logo: p.cLogo || null,
          category: p.cCategory || null, description: p.cDesc || null, data_source: "web3leads",
        };
        const { data: inserted, error: insErr } = await admin.from("companies").insert(insertRow).select().single();
        if (insErr) {
          const { data: race } = await admin.from("companies").select("slug,name,logo,url,category,description").eq("slug", baseSlug).maybeSingle();
          if (race) { p.matched = race; summary.matched++; bySlug.set(baseSlug, race); byNormName.set(slugify(p.cName), race); }
          else { summary.errors++; if (errorSamples.length < 3) errorSamples.push({ phase: "insert_company", slug: baseSlug, error: insErr.message }); }
        } else if (inserted) {
          p.matched = inserted; summary.new_companies.created++;
          bySlug.set(baseSlug, inserted); byNormName.set(slugify(p.cName), inserted);
        }
      }
    }
  }
  summary.unmatched = processed.filter((p) => !p.matched).length;

  // ---- Step C: insert funding rounds ----
  for (const p of processed) {
    if (!p.matched) continue;
    const r = p.r;
    const rowDate = r.date || null;
    if (!rowDate) continue;
    const rowAmount = parseAmount(r.amount_raised);
    const rowRound = r.round || null;
    const rowUrl = r.raise_announcement || null;
    const invArr: any[] = Array.isArray(r.funding_round_investors) ? r.funding_round_investors : [];
    const leadNames: string[] = [], otherNames: string[] = [];
    for (const inv of invArr) {
      const nm = inv?.fund?.name || inv?.name || (typeof inv === "string" ? inv : null);
      if (!nm) continue;
      (inv?.is_lead_investor ? leadNames : otherNames).push(nm);
    }
    const allNames = [...leadNames, ...otherNames];
    const resolvedSlug = p.matched.slug;
    if (dryRun) continue;

    const dedupQuery = admin.from("funding_rounds").select("id,company_slug").eq("company_name", p.cName).eq("date", rowDate);
    const { data: existing } = (rowRound ? await dedupQuery.eq("round_type", rowRound) : await dedupQuery.is("round_type", null));
    if (existing && existing.length > 0) {
      summary.skipped_dup++;
      for (const ex of existing) {
        if (!ex.company_slug || ex.company_slug !== resolvedSlug) {
          const { error: updErr } = await admin.from("funding_rounds").update({ company_slug: resolvedSlug, protocol_slug: resolvedSlug }).eq("id", ex.id);
          if (!updErr) summary.orphan_slugs_fixed++;
          else summary.errors++;
        }
      }
      continue;
    }

    const insertRow = {
      company_name: p.cName, company_slug: resolvedSlug, protocol_slug: resolvedSlug,
      category: p.cCategory || null, amount_usd: rowAmount, round_type: rowRound, date: rowDate,
      lead_investors: leadNames.length ? leadNames.join(", ") : null,
      other_investors: otherNames.length ? otherNames.join(", ") : null,
      all_investors: allNames.length ? allNames.join(", ") : null,
      data_source: "web3leads", announcement_url: rowUrl,
    };
    const { error: insErr } = await admin.from("funding_rounds").insert(insertRow);
    if (!insErr) summary.inserted++;
    else { summary.errors++; if (errorSamples.length < 3) errorSamples.push({ phase: "insert_round", company: p.cName, error: insErr.message }); }
  }

  return json(200, { ok: true, days, since_date: sinceDate, summary, error_samples: errorSamples, signals_added: summary.inserted });
});
