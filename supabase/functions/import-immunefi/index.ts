import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

function toName(slug: string): string {
  return slug.split("-").map((w) => w ? w.charAt(0).toUpperCase() + w.slice(1) : "").join(" ").trim();
}
function toSlug(s: string): string {
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

  // 1. Fetch index
  const r = await fetch("https://immunefi.com/bug-bounty/", { headers: { "User-Agent": "Mozilla/5.0 (auditscope)" } });
  if (!r.ok) return json(502, { error: `Immunefi HTTP ${r.status}` });
  const html = await r.text();

  // 2. Parse all /bug-bounty/{slug}/ links — unique
  const slugs = Array.from(new Set(
    Array.from(html.matchAll(/\/bug-bounty\/([a-z0-9-]+)\//g)).map((m) => m[1])
  ));

  // 3. Load companies
  const slugSet = new Set<string>();
  const nameMap = new Map<string, string>();
  let from = 0;
  while (true) {
    const { data } = await admin.from("companies").select("slug,name").range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const c of data as Array<{ slug: string; name: string }>) {
      if (c.slug) slugSet.add(c.slug);
      if (c.name) nameMap.set(c.name.toLowerCase().trim(), c.slug);
    }
    if (data.length < 1000) break;
    from += 1000;
  }

  function findCompany(immuSlug: string): string | null {
    if (slugSet.has(immuSlug)) return immuSlug;
    // Strip common suffixes from immunefi slugs: -v2, -1, -2 etc
    const stripped = immuSlug.replace(/-(v\d+|\d+)$/, "");
    if (stripped !== immuSlug && slugSet.has(stripped)) return stripped;
    const guessName = toName(immuSlug);
    if (nameMap.has(guessName.toLowerCase())) return nameMap.get(guessName.toLowerCase())!;
    return null;
  }

  // 4. Upsert
  let inserted = 0, dupes = 0, errors = 0, matched = 0;
  const matchedSlugs = new Set<string>();
  for (const slug of slugs) {
    const companySlug = findCompany(slug);
    if (companySlug) { matchedSlugs.add(companySlug); matched++; }
    const row = {
      protocol_slug: slug,
      company_slug: companySlug,
      platform: "Immunefi",
      max_bounty_usd: null,
      program_url: `https://immunefi.com/bug-bounty/${slug}/`,
      is_active: true,
      last_updated: new Date().toISOString(),
    };
    const { error } = await admin.from("bug_bounties").upsert(row, { onConflict: "protocol_slug,platform" });
    if (error) {
      if (error.code === "23505") dupes++;
      else errors++;
    } else inserted++;
  }

  // 5. Mark matched companies as having a bug bounty
  if (matchedSlugs.size > 0) {
    await admin.from("companies").update({ has_bug_bounty: true }).in("slug", Array.from(matchedSlugs));
  }

  return json(200, {
    ok: true,
    immunefi_programs_found: slugs.length,
    inserted, dupes, errors,
    matched_to_companies: matched,
    distinct_companies_marked: matchedSlugs.size,
    sample_unmatched: slugs.filter((s) => !matchedSlugs.has(s)).slice(0, 10),
  });
});
