// backfill-tvl v3 — scan every company against DefiLlama, write current TVL.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

async function fetchTvl(slug: string): Promise<number | null> {
  try {
    const r = await fetch(`https://api.llama.fi/tvl/${encodeURIComponent(slug)}`, { headers: { "User-Agent": "AuditScope/1.0" } });
    if (!r.ok) return null;
    const txt = await r.text();
    const n = Number(txt.trim());
    if (!isFinite(n)) return null;
    return n;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronKey = req.headers.get("x-cron-key") || "";
  if (cronKey !== CRON_KEY) return json(401, { error: "Unauthorized" });
  const admin = createClient(supabaseUrl, serviceKey);

  const body = (await req.json().catch(() => ({}))) as {
    slugs?: string[]; mode?: "all" | "missing" | "refresh"; offset?: number; limit?: number; concurrency?: number;
  };
  const mode = body.mode || "all";
  const concurrency = Math.min(Math.max(body.concurrency || 12, 1), 30);
  const limit = body.limit || 1500;
  const offset = body.offset || 0;

  let slugs: string[] = [];
  if (body.slugs && body.slugs.length > 0) {
    slugs = body.slugs;
  } else if (mode === "missing") {
    // Companies WITHOUT any TVL row yet
    const { data } = await admin.from("companies").select("slug").is("parent_slug", null).order("slug").range(offset, offset + limit - 1);
    const candSlugs = (data ?? []).map((r: any) => r.slug);
    const { data: have } = await admin.from("protocol_metrics").select("company_slug").gt("tvl_usd", 0).in("company_slug", candSlugs);
    const haveSet = new Set((have ?? []).map((r: any) => r.company_slug));
    slugs = candSlugs.filter(s => !haveSet.has(s));
  } else if (mode === "refresh") {
    // Companies that DO have TVL — refresh today's value
    const { data } = await admin.from("protocol_metrics").select("company_slug").gt("tvl_usd", 0).order("date", { ascending: false }).range(offset, offset + limit - 1);
    slugs = Array.from(new Set((data ?? []).map((r: any) => r.company_slug).filter(Boolean)));
  } else {
    // mode=all — every top-level company
    const { data } = await admin.from("companies").select("slug").is("parent_slug", null).order("slug").range(offset, offset + limit - 1);
    slugs = (data ?? []).map((r: any) => r.slug);
  }

  const today = new Date().toISOString().slice(0, 10);
  let hits = 0, misses = 0, errors = 0;
  const sample: Array<{ slug: string; tvl: number }> = [];

  for (let i = 0; i < slugs.length; i += concurrency) {
    const batch = slugs.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(async (slug) => {
      const tvl = await fetchTvl(slug);
      if (tvl == null || tvl <= 0) return { slug, hit: false };
      const { error } = await admin.from("protocol_metrics").upsert({
        company_slug: slug, defillama_slug: slug, date: today, tvl_usd: tvl, source: "defillama",
      }, { onConflict: "company_slug,date,source" });
      if (error) return { slug, hit: false, err: true };
      return { slug, hit: true, tvl };
    }));
    for (const r of results) {
      if (r.hit) { hits++; if (sample.length < 12) sample.push({ slug: r.slug, tvl: r.tvl! }); }
      else if ((r as any).err) errors++;
      else misses++;
    }
  }

  return json(200, { ok: true, mode, offset, limit, scanned: slugs.length, hits, misses, errors, sample, next_offset: offset + limit });
});
