import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s, b) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }
function slugify(s) { return (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80); }
const BLOCKED_BASE_SLUGS = new Set(["token","contract","library","test","example","sample","audit","review","report","nft","erc20","smartcontract","smart-contracts","ethereum","polygon","bitcoin","solana"]);

// Given a baseSlug, find an existing canonical slug whose name is a prefix of baseSlug.
// e.g., baseSlug='1inch-aggregation-router' returns '1inch' if '1inch' exists.
// Prefers the LONGEST matching prefix (most specific).
function findCanonicalPrefix(baseSlug: string, existingSlugs: Set<string>): string | null {
  // Try progressively shorter prefixes by splitting on '-'
  const parts = baseSlug.split("-");
  for (let n = parts.length - 1; n >= 1; n--) {
    const candidate = parts.slice(0, n).join("-");
    if (candidate.length >= 3 && existingSlugs.has(candidate)) return candidate;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Missing env" });
  const cronKey = req.headers.get("x-cron-key") || "";
  const authHeader = req.headers.get("Authorization") || "";
  if (cronKey !== CRON_KEY) {
    if (!authHeader) return json(401, { error: "Unauthorized" });
    const u = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data } = await u.auth.getUser();
    if (!data?.user) return json(401, { error: "Unauthorized" });
  }
  const admin = createClient(supabaseUrl, serviceKey);
  let body: { limit?: number } = {};
  try { body = await req.json().catch(() => ({})); } catch {}
  const limit = Math.min(Math.max(body.limit || 150, 10), 300);

  const { data: pending } = await admin.from("companies_pending")
    .select("id,raw_name,suggested_slug,via_firm,first_audit_date,raw_metadata")
    .eq("source", "audit_scrape").not("raw_name", "is", null).limit(limit);
  if (!pending || pending.length === 0) return json(200, { ok: true, processed: 0, reason: "empty" });

  // Cache existing slugs
  const { data: allCompanies } = await admin.from("companies").select("slug").range(0, 49999);
  const existingSlugs = new Set((allCompanies || []).map((c: { slug: string }) => c.slug));
  const newlyCreatedSlugs = new Set<string>();

  const summary = { processed: 0, skipped_short: 0, skipped_blocked: 0,
    rolled_up_to_canonical: 0, companies_created: 0,
    audit_inserted: 0, audit_dupes: 0, pending_deleted: 0, errors: 0 };
  const samples: Array<{ raw: string; resolved_slug: string; via: string }> = [];

  for (const p of pending) {
    summary.processed++;
    const baseSlug = slugify(p.raw_name);
    if (!baseSlug || baseSlug.length < 3) { summary.skipped_short++; continue; }
    if (BLOCKED_BASE_SLUGS.has(baseSlug)) { summary.skipped_blocked++; continue; }

    let targetSlug: string;
    let via: string;

    // === NEW: brand-prefix roll-up ===
    // If baseSlug starts with an existing canonical (e.g., '1inch-aggregation-router' → '1inch'),
    // attach the audit to the canonical instead of creating a new company.
    const canonicalPrefix = findCanonicalPrefix(baseSlug, existingSlugs);
    if (canonicalPrefix && !newlyCreatedSlugs.has(canonicalPrefix)) {
      targetSlug = canonicalPrefix;
      via = `rollup:${canonicalPrefix}`;
      summary.rolled_up_to_canonical++;
    } else {
      // No canonical found — create a fresh company
      let slug = baseSlug; let i = 2;
      while ((existingSlugs.has(slug) || newlyCreatedSlugs.has(slug)) && i < 10) {
        slug = `${baseSlug}-${i++}`;
      }
      if (existingSlugs.has(slug)) { summary.skipped_short++; continue; }
      const { error: cErr } = await admin.from("companies").insert({
        slug, name: p.raw_name, data_source: "audit_scrape_promote", last_updated: new Date().toISOString(),
      });
      if (cErr) { summary.errors++; continue; }
      summary.companies_created++;
      newlyCreatedSlugs.add(slug);
      existingSlugs.add(slug);
      targetSlug = slug;
      via = `created:${slug}`;
    }

    // Insert audit_history under the resolved (canonical or new) slug
    const { error: aErr } = await admin.from("audit_history").insert({
      company_slug: targetSlug, protocol_slug: null, protocol_name: p.raw_name,
      audit_firm: p.via_firm, audit_date: p.first_audit_date,
      audit_type: p.raw_metadata?.audit_type || null,
      report_url: p.raw_metadata?.report_url || null,
      smart_contract_language: p.raw_metadata?.language || null,
      data_source: "pending_promoted_v2",
    });
    if (!aErr) summary.audit_inserted++;
    else if (aErr.code === "23505") summary.audit_dupes++;
    else summary.errors++;

    await admin.from("companies_pending").delete().eq("id", p.id);
    summary.pending_deleted++;
    if (samples.length < 8) samples.push({ raw: p.raw_name, resolved_slug: targetSlug, via });
  }

  return json(200, { ok: true, summary, samples });
});
