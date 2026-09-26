import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

function normalize(s: string): string {
  return s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
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

  // 1. Fetch DefiLlama hacks
  const r = await fetch("https://api.llama.fi/hacks", { headers: { "User-Agent": "auditscope-importer" } });
  if (!r.ok) return json(502, { error: `DefiLlama HTTP ${r.status}` });
  const hacks = await r.json() as any[];
  if (!Array.isArray(hacks)) return json(502, { error: "Unexpected DefiLlama response" });

  // 2. Load companies for matching (paginated)
  const slugMap = new Map<string, string>();   // slug → slug (for direct slug match)
  const nameMap = new Map<string, string>();   // lowered-name → slug
  let from = 0;
  while (true) {
    const { data } = await admin.from("companies").select("slug,name").range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const c of data as Array<{ slug: string; name: string }>) {
      if (c.slug) slugMap.set(c.slug, c.slug);
      if (c.name) nameMap.set(c.name.toLowerCase().trim(), c.slug);
      if (c.slug) nameMap.set(c.slug.replace(/-/g, " ").toLowerCase(), c.slug);
    }
    if (data.length < 1000) break;
    from += 1000;
  }

  function matchSlug(hackName: string): string | null {
    if (!hackName) return null;
    const lowered = hackName.toLowerCase().trim();
    if (nameMap.has(lowered)) return nameMap.get(lowered)!;
    const slugified = normalize(hackName);
    if (slugMap.has(slugified)) return slugified;
    // Try without common suffixes
    const cleaned = lowered.replace(/\s+(protocol|network|finance|labs|defi)$/i, "").trim();
    if (cleaned !== lowered && nameMap.has(cleaned)) return nameMap.get(cleaned)!;
    const slugCleaned = normalize(cleaned);
    if (slugMap.has(slugCleaned)) return slugCleaned;
    return null;
  }

  let inserted = 0, dupes = 0, errors = 0, matched = 0;
  const matchedSlugs = new Set<string>();
  for (const h of hacks) {
    if (!h.name || !h.date) { errors++; continue; }
    const slug = matchSlug(h.name);
    if (slug) { matchedSlugs.add(slug); matched++; }
    const dateStr = new Date(h.date * 1000).toISOString().slice(0, 10);
    const row: Record<string, unknown> = {
      name: h.name,
      company_slug: slug,
      hack_date: dateStr,
      amount_usd: h.amount || null,
      classification: h.classification || null,
      technique: h.technique || null,
      target_type: h.targetType || null,
      chains: Array.isArray(h.chain) ? h.chain : (h.chain ? [h.chain] : null),
      language: h.language || null,
      bridge_hack: !!h.bridgeHack,
      returned_funds: h.returnedFunds || null,
      source_url: h.source || null,
      llama_id: h.defillamaId ? String(h.defillamaId) : null,
      parent_protocol_id: h.parentProtocolId ? String(h.parentProtocolId) : null,
      updated_at: new Date().toISOString(),
    };
    const { error: upErr } = await admin.from("hacks").upsert(row, { onConflict: "name,hack_date", ignoreDuplicates: false });
    if (upErr) {
      if (upErr.code === "23505") dupes++;
      else errors++;
    } else inserted++;
  }

  // 3. Update companies.has_been_hacked for all matched slugs
  if (matchedSlugs.size > 0) {
    await admin.from("companies").update({ has_been_hacked: true }).in("slug", Array.from(matchedSlugs));
  }

  return json(200, {
    ok: true,
    total_hacks_from_llama: hacks.length,
    inserted, dupes, errors,
    matched_to_companies: matched,
    distinct_companies_marked: matchedSlugs.size,
    sample_matched: Array.from(matchedSlugs).slice(0, 12),
  });
});
