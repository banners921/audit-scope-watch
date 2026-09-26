import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL"); const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Missing supabase env" });
  const cronKey = req.headers.get("x-cron-key") || ""; const authHeader = req.headers.get("Authorization") || "";
  if (cronKey !== CRON_KEY) {
    if (!authHeader) return json(401, { error: "Unauthorized" });
    const u = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data } = await u.auth.getUser(); if (!data?.user) return json(401, { error: "Unauthorized" });
  }
  const admin = createClient(supabaseUrl, serviceKey);
  const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean; min_tvl?: number; ingest?: boolean; limit?: number };
  const minTvl = body.min_tvl ?? 100_000;
  const ingest = body.ingest === true;
  const limit = Math.min(Math.max(body.limit ?? 500, 1), 5000);

  // Fetch DefiLlama protocol list
  const r = await fetch("https://api.llama.fi/protocols", { headers: { "User-Agent": "AuditScope/1.0" } });
  if (!r.ok) return json(500, { error: `defillama ${r.status}` });
  const arr = await r.json();
  if (!Array.isArray(arr)) return json(500, { error: "defillama unexpected format" });

  // Filter by min TVL (skip dead/insignificant projects)
  type LlamaP = { slug?: string; name?: string; url?: string; logo?: string; category?: string; description?: string; tvl?: number; chains?: string[]; chain?: string; twitter?: string };
  const candidates: LlamaP[] = arr.filter((p: any) => typeof p?.slug === "string" && typeof p?.name === "string" && (Number(p.tvl) || 0) >= minTvl);

  // Pull our slug universe
  const ourSlugs = new Set<string>();
  const ourNames = new Set<string>();
  for (let off = 0; off < 50000; off += 1000) {
    const { data } = await admin.from("companies").select("slug,name").range(off, off + 999);
    if (!data || data.length === 0) break;
    for (const r of data as any[]) { ourSlugs.add((r.slug || "").toLowerCase()); ourNames.add(slugify(r.name || "")); }
    if (data.length < 1000) break;
  }

  // Identify gaps
  const gaps: any[] = [];
  for (const p of candidates) {
    const slug = (p.slug || "").toLowerCase();
    const nameSlug = slugify(p.name || "");
    if (ourSlugs.has(slug) || ourNames.has(nameSlug)) continue;
    gaps.push({
      slug,
      name: p.name,
      url: p.url || null,
      logo: p.logo || null,
      category: p.category || null,
      description: (p.description || "").slice(0, 800) || null,
      tvl: Number(p.tvl) || 0,
      chains: Array.isArray(p.chains) ? p.chains : (p.chain ? [p.chain] : []),
      twitter: p.twitter ? (p.twitter.includes("twitter.com") || p.twitter.includes("x.com") ? p.twitter : `https://x.com/${p.twitter.replace(/^@/, "")}`) : null,
    });
  }

  // Sort by TVL desc
  gaps.sort((a, b) => b.tvl - a.tvl);
  const top = gaps.slice(0, limit);

  let inserted = 0; let conflicts = 0; let errors = 0;
  if (ingest && !body.dry_run) {
    const rows = top.map(g => ({
      slug: g.slug,
      name: g.name,
      url: g.url,
      logo: g.logo,
      category: g.category,
      description: g.description,
      twitter: g.twitter,
      total_raised_usd: null,
      has_been_hacked: false,
      has_bug_bounty: false,
      data_source: "defillama_gap_ingest",
    }));
    // Upsert in chunks
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error, count } = await admin.from("companies").upsert(batch, { onConflict: "slug", ignoreDuplicates: true, count: "exact" });
      if (error) errors++; else inserted += count || batch.length;
    }
  }

  return json(200, {
    ok: true,
    defillama_total: candidates.length,
    our_universe: ourSlugs.size,
    gap_count: gaps.length,
    top_returned: top.length,
    inserted: ingest ? inserted : 0,
    conflicts, errors,
    sample: top.slice(0, 20).map(g => ({ slug: g.slug, name: g.name, tvl: g.tvl, category: g.category })),
  });
});
