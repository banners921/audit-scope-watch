// v3 — fix: companies.github is text[], wrap as array. + parallel updates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

function slugify(s: string): string {
  return (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function normalizeTwitter(t: string | null | undefined): string | null {
  if (!t) return null;
  const s = String(t).trim().replace(/^@/, "").replace(/^https?:\/\/(www\.|mobile\.)?(twitter|x)\.com\//i, "").replace(/\/$/, "");
  if (!s || s.includes(" ")) return null;
  return s;
}
function normalizeGithub(g: string[] | string | null | undefined): string | null {
  if (!g) return null;
  const arr = Array.isArray(g) ? g : [g];
  const first = arr[0];
  if (!first) return null;
  const s = String(first).trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/$/, "");
  return s || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronKey = req.headers.get("x-cron-key") || "";
  if (cronKey !== CRON_KEY) return json(401, { error: "Unauthorized" });
  const admin = createClient(supabaseUrl, serviceKey);

  const body = (await req.json().catch(() => ({}))) as { mode?: "bare" | "missing_desc" | "all"; limit?: number; concurrency?: number; dry_run?: boolean };
  const mode = body.mode || "missing_desc";
  const dryRun = body.dry_run === true;
  const concurrency = Math.min(Math.max(body.concurrency ?? 20, 1), 50);

  const r = await fetch("https://api.llama.fi/protocols", { headers: { "User-Agent": "AuditScope/1.0" } });
  if (!r.ok) return json(502, { error: `llama ${r.status}` });
  const protocols = await r.json() as any[];

  type P = { slug: string; name: string; url: string | null; twitter: string | null; github: string | null; logo: string | null; category: string | null; description: string | null };
  const bySlug = new Map<string, P>();
  const byName = new Map<string, P>();
  for (const p of protocols) {
    const slug = String(p.slug || slugify(p.name || "")).toLowerCase();
    if (!slug) continue;
    const rec: P = {
      slug, name: p.name || "",
      url: p.url || null,
      twitter: normalizeTwitter(p.twitter),
      github: normalizeGithub(p.github),
      logo: p.logo || null,
      category: p.category || null,
      description: p.description || null,
    };
    if (!bySlug.has(slug)) bySlug.set(slug, rec);
    const nk = String(p.name || "").toLowerCase().trim();
    if (nk && !byName.has(nk)) byName.set(nk, rec);
  }

  let query = admin.from("companies").select("slug,name,url,twitter,github,logo,category,description").is("parent_slug", null);
  if (mode === "bare") {
    query = query.is("url", null).is("twitter", null).is("github", null).is("logo", null);
  } else if (mode === "missing_desc") {
    query = query.or("description.is.null,description.eq.");
  }
  const { data: companies } = await query.limit(body.limit ?? 10000);
  if (!companies) return json(500, { error: "failed to load companies" });

  type Update = { slug: string; updates: Record<string, any> };
  const batch: Update[] = [];
  let matched = 0, no_match = 0;
  for (const c of companies as any[]) {
    const slug = String(c.slug || "").toLowerCase();
    const name = String(c.name || "").toLowerCase().trim();
    const hit = bySlug.get(slug) || byName.get(name) || bySlug.get(slug.replace(/-finance$|-protocol$|-network$|-labs$/, "")) || null;
    if (!hit) { no_match++; continue; }
    matched++;
    const updates: any = {};
    if (!c.url && hit.url) updates.url = hit.url;
    if (!c.twitter && hit.twitter) updates.twitter = hit.twitter;
    // github is TEXT[] in Postgres — wrap as array
    const hasGh = Array.isArray(c.github) ? c.github.length > 0 : !!c.github;
    if (!hasGh && hit.github) updates.github = [hit.github];
    if (!c.logo && hit.logo) updates.logo = hit.logo;
    if (!c.category && hit.category) updates.category = hit.category;
    if ((!c.description || c.description.trim() === "") && hit.description) updates.description = hit.description.slice(0, 2000);
    if (Object.keys(updates).length === 0) continue;
    batch.push({ slug: c.slug, updates });
  }

  if (dryRun) return json(200, { ok: true, mode, candidates: companies.length, matched, would_update: batch.length, samples: batch.slice(0, 5) });

  let updated = 0, errors = 0;
  const errorSamples: any[] = [];
  for (let i = 0; i < batch.length; i += concurrency) {
    const chunk = batch.slice(i, i + concurrency);
    const results = await Promise.all(chunk.map(async (u) => {
      const { error } = await admin.from("companies").update(u.updates).eq("slug", u.slug);
      return error ? { error: error.message, slug: u.slug } : null;
    }));
    for (const x of results) {
      if (x) { errors++; if (errorSamples.length < 5) errorSamples.push(x); }
      else updated++;
    }
  }

  return json(200, { ok: true, mode, candidates: companies.length, matched, updated, errors, no_match, catalog_size: protocols.length, error_samples: errorSamples });
});
