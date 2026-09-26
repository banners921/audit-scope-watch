import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s, b) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

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
  let body = {};
  try { body = await req.json().catch(() => ({})); } catch {}
  const minSim = typeof body.min_sim === "number" ? body.min_sim : 0.65;
  const limit = Math.min(Math.max(body.limit || 150, 10), 300);

  const { data: pending } = await admin.from("companies_pending")
    .select("id,raw_name,suggested_slug,via_firm,first_audit_date,raw_metadata")
    .eq("source", "audit_scrape")
    .not("raw_name", "is", null)
    .limit(limit);
  if (!pending || pending.length === 0) return json(200, { ok: true, processed: 0, reason: "empty" });

  const summary = { processed: 0, matched: 0, audit_inserted: 0, audit_dupes: 0, deleted_pending: 0, errors: 0 };
  const samples = [];

  for (const p of pending) {
    summary.processed++;
    const { data: fm } = await admin.rpc("fuzzy_match_company", { client_name: p.raw_name, min_sim: minSim });
    const match = Array.isArray(fm) && fm.length > 0 ? fm[0] : null;
    if (!match) continue;
    summary.matched++;
    const company_slug = match.out_match_type === "company" ? match.out_slug : match.out_parent_slug;
    if (!company_slug) continue;
    const protocol_slug = match.out_match_type === "protocol" ? match.out_slug : null;
    const { error: insErr } = await admin.from("audit_history").insert({
      company_slug,
      protocol_slug,
      protocol_name: match.out_name || p.raw_name,
      audit_firm: p.via_firm,
      audit_date: p.first_audit_date,
      audit_type: p.raw_metadata?.audit_type || null,
      report_url: p.raw_metadata?.report_url || null,
      smart_contract_language: p.raw_metadata?.language || null,
      data_source: "pending_promoted_fuzzy",
    });
    if (!insErr) summary.audit_inserted++;
    else if (insErr.code === "23505") summary.audit_dupes++;
    else { summary.errors++; continue; }
    // Remove from pending
    await admin.from("companies_pending").delete().eq("id", p.id);
    summary.deleted_pending++;
    if (samples.length < 8) samples.push({ raw: p.raw_name, matched: match.out_slug, sim: match.out_similarity });
  }

  return json(200, { ok: true, summary, samples, pending_processed_in_batch: pending.length });
});
