import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const W3L_URL = "https://wwwfoeuebjmbuxqwwpjq.supabase.co/functions/v1/web3leads-api";
const PAGE_SIZE = 100;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }
function slugify(s: string): string { return (s || "").toString().toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80); }
function normName(s: string): string { return (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").trim(); }

// Pick the square/icon-style logo over the wide banner. Web3leads convention:
// logo_url_2 (when present) = secondary/square asset; logo_url = primary/banner.
function pickLogo(f: any): string | null {
  return f.logo_url_2 || f.logo_url || f.logo || null;
}

async function fetchW3lFunds(key: string, maxPages: number): Promise<{ rows: any[]; error?: string }> {
  const all: any[] = [];
  for (let page = 0; page < maxPages; page++) {
    const body = { resource: "funds", limit: PAGE_SIZE, offset: page * PAGE_SIZE, order: { column: "updated_at", ascending: false } };
    let resp;
    try { resp = await fetch(W3L_URL, { method: "POST", headers: { "x-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    catch (e) { return { rows: all, error: `fetch_failed: ${String(e).slice(0, 200)}` }; }
    if (!resp.ok) { const txt = await resp.text().catch(() => ""); return { rows: all, error: `w3l_${resp.status}: ${txt.slice(0, 200)}` }; }
    const j = await resp.json().catch(() => null);
    const rows = Array.isArray(j) ? j : (j?.data || j?.rows || j?.results || []);
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return { rows: all };
}

async function fetchAllExistingFunds(admin: any): Promise<any[]> {
  const out: any[] = [];
  const PAGE = 1000;
  for (let offset = 0; offset < 50000; offset += PAGE) {
    const { data, error } = await admin.from("funds").select("slug,name,logo,website,twitter,linkedin,description").range(offset, offset + PAGE - 1);
    if (error || !data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const w3lKey = Deno.env.get("WEB3LEADS_API_KEY");
  if (!w3lKey) return json(500, { error: "Missing WEB3LEADS_API_KEY" });
  const cronKey = req.headers.get("x-cron-key") || "";
  if (cronKey !== CRON_KEY) return json(401, { error: "Unauthorized" });
  const admin = createClient(supabaseUrl, serviceKey);
  const body = (await req.json().catch(() => ({}))) as { max_pages?: number; debug?: boolean; force_overwrite_logo?: boolean };
  const maxPages = Math.max(1, Math.min(120, body.max_pages ?? 80));
  const debug = body.debug === true;
  const forceLogo = body.force_overwrite_logo === true;

  const fundsResult = await fetchW3lFunds(w3lKey, maxPages);
  if (debug) return json(200, { ok: true, fetched: fundsResult.rows.length, error: fundsResult.error, sample_keys: Object.keys(fundsResult.rows[0] || {}) });

  const existingFunds = await fetchAllExistingFunds(admin);
  const bySlug = new Map<string, any>();
  const byName = new Map<string, any>();
  for (const f of existingFunds) {
    if (f.slug) bySlug.set(f.slug.toLowerCase(), f);
    const nn = normName(f.name || "");
    if (nn && !byName.has(nn)) byName.set(nn, f);
  }

  let inserted = 0, updated = 0, fieldsFilled = 0, no_change = 0, matched_by_name = 0, logos_overwritten = 0;
  const errors: string[] = [];
  for (const f of fundsResult.rows) {
    const name = (f.name || "").trim();
    if (!name) continue;
    const w3lSlug = (f.slug || slugify(name)).toLowerCase();
    if (!w3lSlug) continue;
    const logo = pickLogo(f);
    const newFields = {
      logo,
      website: f.website || null,
      twitter: f.twitter || null,
      linkedin: f.linkedin || null,
      description: f.description || f.bio || null,
      investment_count: typeof f.investment_count === "number" ? f.investment_count : null,
      data_source: "web3leads",
      last_updated: new Date().toISOString(),
    };

    let existing = bySlug.get(w3lSlug);
    if (!existing) {
      const nn = normName(name);
      if (nn) { existing = byName.get(nn); if (existing) matched_by_name++; }
    }

    if (!existing) {
      const { error } = await admin.from("funds").insert({ slug: w3lSlug, name, ...newFields });
      if (error) errors.push(`insert ${w3lSlug}: ${error.message}`);
      else { inserted++; bySlug.set(w3lSlug, { slug: w3lSlug, name }); byName.set(normName(name), { slug: w3lSlug, name }); }
      continue;
    }

    const updates: any = {};
    // Force-overwrite logo with the new picker so existing ugly banner-logos get replaced by squares
    if (newFields.logo && (forceLogo || !existing.logo || existing.logo !== newFields.logo)) {
      updates.logo = newFields.logo;
      if (existing.logo && existing.logo !== newFields.logo) logos_overwritten++;
    }
    if (!existing.website && newFields.website) updates.website = newFields.website;
    if (!existing.twitter && newFields.twitter) updates.twitter = newFields.twitter;
    if (!existing.linkedin && newFields.linkedin) updates.linkedin = newFields.linkedin;
    if (!existing.description && newFields.description) updates.description = newFields.description;
    if (newFields.investment_count != null) updates.investment_count = newFields.investment_count;
    if (Object.keys(updates).length === 0) { no_change++; continue; }
    updates.last_updated = newFields.last_updated;
    fieldsFilled += Object.keys(updates).length;
    const { error } = await admin.from("funds").update(updates).eq("slug", existing.slug);
    if (error) errors.push(`update ${existing.slug}: ${error.message}`); else updated++;
  }

  return json(200, { ok: true, fetched: fundsResult.rows.length, inserted, updated, matched_by_name, logos_overwritten, fields_filled: fieldsFilled, no_change, errors: errors.slice(0, 5), notice: fundsResult.error });
});
