import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s, b) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }
function slugify(s) { return (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80); }
function titleFromSlug(s: string) { return s.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(500, { error: "Missing env" });
  const cronKey = req.headers.get("x-cron-key") || "";
  if (cronKey !== CRON_KEY) return json(401, { error: "Unauthorized" });
  const admin = createClient(supabaseUrl, serviceKey);

  let body: { offset?: number; limit?: number } = {};
  try { body = await req.json().catch(() => ({})); } catch {}
  const offset = body.offset || 0;
  const limit = Math.min(Math.max(body.limit || 600, 50), 1000);

  // Fetch the sitemap once
  const r = await fetch("https://hacken.io/sitemap-audits.xml", { headers: { "User-Agent": "AuditScope/1.0" } });
  if (!r.ok) return json(502, { error: `sitemap HTTP ${r.status}` });
  const xml = await r.text();
  const urls = Array.from(xml.matchAll(/<loc>(https:\/\/hacken\.io\/audits\/[^<]+)<\/loc>/g)).map((m) => m[1].replace(/\/$/, ""));
  const slice = urls.slice(offset, offset + limit);
  if (slice.length === 0) return json(200, { ok: true, scanned: 0, total_urls: urls.length });

  // Pre-fetch all company slugs for matching
  const ourSlugs = new Set();
  for (let off = 0; off < 50000; off += 1000) {
    const { data } = await admin.from("companies").select("slug").range(off, off + 999);
    if (!data || data.length === 0) break;
    for (const r of data) ourSlugs.add(r.slug);
    if (data.length < 1000) break;
  }

  const summary = { total_urls_in_sitemap: urls.length, processed: slice.length, inserted: 0, dupes: 0, pending: 0, pending_dupes: 0, errors: 0 };
  // Insert in batches of 100
  for (let i = 0; i < slice.length; i += 100) {
    const chunk = slice.slice(i, i + 100);
    await Promise.all(chunk.map(async (url) => {
      const m = url.match(/\/audits\/([\w-]+)/);
      if (!m) return;
      const protoSlug = m[1];
      const protoName = titleFromSlug(protoSlug);
      const matched = ourSlugs.has(protoSlug);
      if (matched) {
        const { error } = await admin.from("audit_history").insert({
          company_slug: protoSlug, protocol_slug: null, protocol_name: protoName,
          audit_firm: "Hacken", report_url: url, audit_date: null,
          smart_contract_language: null, data_source: "hacken_sitemap",
        });
        if (!error) summary.inserted++;
        else if (error.code === "23505") summary.dupes++;
        else summary.errors++;
      } else {
        const { error } = await admin.from("companies_pending").insert({
          raw_name: protoName, suggested_slug: protoSlug, source: "audit_scrape",
          via_firm: "Hacken", first_audit_date: null, raw_metadata: { report_url: url },
        });
        if (!error) summary.pending++;
        else if (error.code === "23505") summary.pending_dupes++;
        else summary.errors++;
      }
    }));
  }
  return json(200, { ok: true, summary, next_offset: offset + slice.length, has_more: offset + slice.length < urls.length });
});
