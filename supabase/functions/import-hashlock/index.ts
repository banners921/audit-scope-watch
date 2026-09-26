import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

const FIRM = "Hashlock";
const FIRM_SLUG = "hashlock";
const WP = "https://hashlock.com/wp-json/wp/v2/audit?per_page=100&page=";

function inferLang(content: string): string | null {
  const t = content.toLowerCase();
  if (/\b(move\b|sui|aptos)/i.test(t)) return "move";
  if (/\b(rust\b|solana|substrate|near)/i.test(t)) return "rust";
  if (/\b(cairo|starknet)/i.test(t)) return "cairo";
  if (/\b(vyper)/i.test(t)) return "vyper";
  if (/\b(solidity|ethereum|evm|erc-?20|erc-?721|smart contract)/i.test(t)) return "solidity";
  return null;
}

function toSlug(s: string): string {
  return s.toLowerCase().trim()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Missing supabase env" });

  const cronKey = req.headers.get("x-cron-key") || "";
  const authHeader = req.headers.get("Authorization") || "";
  if (cronKey !== CRON_KEY) {
    if (!authHeader) return json(401, { error: "Unauthorized" });
    const u = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data } = await u.auth.getUser();
    if (!data?.user) return json(401, { error: "Unauthorized" });
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const body: { offset?: number; limit?: number } = (await req.json().catch(() => ({}))) || {};
  const offset = Math.max(0, body.offset ?? 0);
  const limit = Math.min(Math.max(body.limit ?? 80, 1), 200);

  await admin.from("audit_sources").upsert({
    slug: FIRM_SLUG, firm_name: FIRM, source_type: "wp_json",
    source_config: { endpoint: "https://hashlock.com/wp-json/wp/v2/audit", per_page: 100 },
    enabled: true,
  }, { onConflict: "slug" });

  // Fetch all WP posts (small payload, ~3 pages)
  const posts: Array<any> = [];
  let page = 1;
  while (page <= 10) {
    const r = await fetch(WP + page, { headers: { "User-Agent": "auditscope-importer" } });
    if (!r.ok) { if (r.status === 400 || r.status === 404) break; return json(502, { error: `WP page ${page} HTTP ${r.status}` }); }
    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length === 0) break;
    posts.push(...arr);
    if (arr.length < 100) break;
    page++;
  }
  const slice = posts.slice(offset, offset + limit);

  // Pre-fetch all companies into maps (slug + name lookup)
  const slugMap = new Map<string, string>();
  const nameMap = new Map<string, string>();
  let from = 0;
  while (true) {
    const { data, error } = await admin.from("companies").select("slug,name").range(from, from + 999);
    if (error || !data || data.length === 0) break;
    for (const c of data) {
      if (c.slug) slugMap.set(c.slug.toLowerCase(), c.slug);
      if (c.name) nameMap.set(c.name.toLowerCase().trim(), c.slug);
    }
    if (data.length < 1000) break;
    from += 1000;
  }

  function lookupCanonical(slug: string, name: string): string | null {
    const candidates = [slug, slug.replace(/-protocol$|-network$|-finance$|-labs$|-v\d+$/, "")];
    for (const c of candidates) {
      if (c && slugMap.has(c)) return slugMap.get(c)!;
    }
    const byName = nameMap.get(name.toLowerCase().trim());
    return byName || null;
  }

  let inserted = 0, dupes = 0, pendingInserted = 0, linked = 0, errors = 0;
  const errSamples: any[] = [];

  for (const p of slice) {
    const protocolName = String(p?.title?.rendered || p?.slug || "").trim();
    if (!protocolName) { errors++; continue; }
    const wpSlug = String(p?.slug || "").toLowerCase();
    const slugCandidate = wpSlug || toSlug(protocolName);
    const reportUrl = String(p?.link || `https://hashlock.com/audits/${slugCandidate}`);
    const auditDate = String(p?.date || "").slice(0, 10) || null;
    const contentHtml = String(p?.content?.rendered || "");
    const lang = inferLang(contentHtml);

    const canonical = lookupCanonical(slugCandidate, protocolName);
    if (canonical) linked++;

    const { error: upErr } = await admin.from("audit_history").insert({
      audit_firm: FIRM,
      protocol_name: protocolName,
      company_slug: canonical,
      audit_date: auditDate,
      report_url: reportUrl,
      smart_contract_language: lang,
    });
    if (upErr) {
      if (String(upErr.code) === "23505" || /duplicate/i.test(upErr.message || "")) dupes++;
      else { errors++; if (errSamples.length < 3) errSamples.push({ at: "audit_history", slug: slugCandidate, msg: upErr.message }); }
    } else {
      inserted++;
    }

    if (!canonical) {
      const { error: pendErr } = await admin.from("companies_pending").insert({
        raw_name: protocolName,
        suggested_slug: slugCandidate,
        source: "hashlock_wp",
        via_firm: FIRM,
        first_audit_date: auditDate,
        raw_metadata: { wp_post_id: p?.id, link: reportUrl },
        status: "new",
      });
      if (!pendErr) pendingInserted++;
      else if (!(String(pendErr.code) === "23505" || /duplicate/i.test(pendErr.message || ""))) {
        if (errSamples.length < 3) errSamples.push({ at: "companies_pending", slug: slugCandidate, msg: pendErr.message });
      }
    }
  }

  await admin.from("audit_sources").update({
    last_scraped_at: new Date().toISOString(),
    last_scrape_stats: {
      total_posts: posts.length, offset, limit, processed: slice.length,
      inserted, dupes, errors,
      pending_inserted: pendingInserted, canonical_linked: linked,
    },
  }).eq("slug", FIRM_SLUG);

  return json(200, {
    ok: true,
    firm: FIRM,
    total_posts: posts.length, offset, limit, processed: slice.length,
    inserted, dupes, errors,
    canonical_linked: linked,
    pending_inserted: pendingInserted,
    next_offset: offset + slice.length < posts.length ? offset + slice.length : null,
    err_samples: errSamples,
  });
});
