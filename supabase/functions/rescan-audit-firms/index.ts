import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

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
  const body = (await req.json().catch(() => ({}))) as { limit?: number; firm_slug?: string };
  const limit = Math.min(Math.max(body.limit ?? 3, 1), 10);

  let q = admin.from("audit_sources")
    .select("slug, firm_name, source_type, last_scraped_at")
    .eq("enabled", true)
    .order("last_scraped_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (body.firm_slug) q = q.eq("slug", body.firm_slug);
  const { data: firms, error } = await q;
  if (error) return json(500, { error: error.message });
  if (!firms || firms.length === 0) return json(200, { ok: true, scanned: 0, note: "no firms enabled" });

  // Mark each as recently-rescanned BEFORE firing so the next rotation moves on even if scrapes fail
  const nowIso = new Date().toISOString();
  await admin.from("audit_sources").update({ last_scraped_at: nowIso }).in("slug", firms.map((f) => f.slug));

  // Fire each in parallel — don't await; scrape-audit-firm runs server-side to completion
  const fired: any[] = [];
  for (const firm of firms) {
    const isHashlock = firm.slug === "hashlock";
    const endpoint = isHashlock ? "import-hashlock" : "scrape-audit-firm";
    const payload = isHashlock ? {} : { firm_slug: firm.slug };
    // Fire-and-forget. Use EdgeRuntime.waitUntil so the runtime keeps the process alive.
    const promise = fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-key": CRON_KEY, Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify(payload),
    }).catch((e) => ({ error: String(e).slice(0, 100) }));
    // @ts-ignore Edge runtime keepalive
    if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) (EdgeRuntime as any).waitUntil(promise);
    fired.push({ slug: firm.slug, firm: firm.firm_name, source_type: firm.source_type, endpoint, previous_scan: firm.last_scraped_at });
  }

  return json(200, {
    ok: true,
    fired_count: fired.length,
    note: "Scrapes running async server-side. Check audit_history for new rows in 1-5 min.",
    fired,
  });
});
