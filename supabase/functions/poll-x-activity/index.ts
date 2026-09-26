import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

function handleFromTwitterField(t: string | null | undefined): string | null {
  if (!t) return null;
  let s = t.trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^(www\.)?(twitter|x)\.com\//, "");
  s = s.replace(/^@/, "");
  s = s.split(/[\/\?#]/)[0];
  if (!/^[A-Za-z0-9_]{1,15}$/.test(s)) return null;
  return s;
}

async function fetchViaJina(url: string): Promise<{ text: string } | { error: string }> {
  try {
    const r = await fetch(`https://r.jina.ai/${url}`, { headers: { "User-Agent": "AuditScope/1.0", "X-Return-Format": "text" } });
    if (!r.ok) return { error: `jina ${r.status}` };
    const text = await r.text();
    if (!text || text.length < 200) return { error: "jina too short" };
    return { text: text.slice(0, 30_000) };
  } catch (e) { return { error: `jina err: ${String(e).slice(0, 100)}` }; }
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// Parse X-style timestamps. Looks for:
//   · May 22
//   · May 22, 2024
//   · 3h / 45m / 2d
// All dates without year are interpreted as current year if the resulting date is in the past, else previous year.
function parseRecentPostTimestamp(text: string): { iso: string | null; postCount30d: number; snippet: string | null } {
  const dates: Date[] = [];
  const now = Date.now();
  const thisYear = new Date().getFullYear();

  // "· Mon DD" or "· Mon DD, YYYY" (X posts the date with bullet separator)
  const monthRegex = /·\s*([A-Za-z]{3})\s+(\d{1,2})(?:,\s*(\d{4}))?/g;
  let mt: RegExpExecArray | null;
  while ((mt = monthRegex.exec(text)) !== null) {
    const mo = MONTHS[mt[1].toLowerCase()];
    if (mo == null) continue;
    const day = parseInt(mt[2], 10);
    const year = mt[3] ? parseInt(mt[3], 10) : thisYear;
    const d = new Date(Date.UTC(year, mo, day, 12, 0, 0));
    // If no explicit year and resulting date is > 14d in future, assume previous year
    if (!mt[3] && d.getTime() - now > 14 * 86400000) {
      d.setUTCFullYear(year - 1);
    }
    if (d.getTime() <= now + 86400000) dates.push(d);
  }

  // "· 3h" / "· 2d" relative compact
  const relRegex = /·\s*(\d+)\s*(s|m|h|d)\b/g;
  while ((mt = relRegex.exec(text)) !== null) {
    const n = parseInt(mt[1], 10);
    const unit = mt[2].toLowerCase();
    if (!isFinite(n) || n > 366) continue;
    let ms = 0;
    if (unit === "s") ms = n * 1000;
    else if (unit === "m") ms = n * 60 * 1000;
    else if (unit === "h") ms = n * 3600 * 1000;
    else if (unit === "d") ms = n * 86400 * 1000;
    if (ms > 0) dates.push(new Date(now - ms));
  }

  // ISO dates
  const isoRegex = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((mt = isoRegex.exec(text)) !== null) {
    const d = new Date(`${mt[1]}-${mt[2]}-${mt[3]}T00:00:00Z`);
    if (!isNaN(d.getTime()) && d.getTime() <= now + 86400000) dates.push(d);
  }

  let latest: Date | null = null;
  for (const d of dates) {
    if (!latest || d > latest) latest = d;
  }
  const cutoff = now - 30 * 86400000;
  const post30 = dates.filter(d => d.getTime() >= cutoff && d.getTime() <= now).length;
  // Snippet: first content line that's substantial
  const lines = text.split(/\n+/).map(l => l.trim()).filter(l => l.length > 40 && l.length < 280 && !/^@[A-Za-z0-9_]+$/.test(l) && !/^\d+(\.\d+)?[KM]?\s+(Following|Followers|posts)/.test(l));
  const snippet = lines.find(l => !/^(Aave|Reply|Repost|Like)$/.test(l)) ?? null;
  return { iso: latest ? latest.toISOString() : null, postCount30d: post30, snippet };
}

async function pollOne(admin: any, row: { slug: string; twitter: string }): Promise<{ ok: boolean; updated: boolean; reason?: string; iso?: string; posts30?: number; handle?: string }> {
  const handle = handleFromTwitterField(row.twitter);
  if (!handle) return { ok: false, updated: false, reason: "bad_handle" };
  const fetched = await fetchViaJina(`https://x.com/${handle}`);
  if ("error" in fetched) return { ok: false, updated: false, reason: fetched.error, handle };
  const parsed = parseRecentPostTimestamp(fetched.text);
  if (!parsed.iso) {
    await admin.from("companies").update({ x_activity_checked_at: new Date().toISOString() }).eq("slug", row.slug);
    return { ok: true, updated: false, reason: "no_timestamps_parsed", handle };
  }
  await admin.from("companies").update({
    last_x_post_at: parsed.iso,
    last_x_post_text: parsed.snippet ? parsed.snippet.slice(0, 280) : null,
    x_posts_30d: parsed.postCount30d,
    x_activity_checked_at: new Date().toISOString(),
  }).eq("slug", row.slug);
  return { ok: true, updated: true, iso: parsed.iso, posts30: parsed.postCount30d, handle };
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
  const body = (await req.json().catch(() => ({}))) as { slugs?: string[]; fund_slug?: string; limit?: number; max_age_hours?: number; concurrency?: number };
  const limit = Math.min(Math.max(body.limit ?? 30, 1), 120);
  const concurrency = Math.min(Math.max(body.concurrency ?? 2, 1), 4);
  const maxAgeHours = body.max_age_hours ?? 24;

  let targets: Array<{ slug: string; twitter: string }> = [];
  if (body.slugs && body.slugs.length > 0) {
    const { data } = await admin.from("companies").select("slug,twitter").in("slug", body.slugs).not("twitter", "is", null);
    targets = (data ?? []) as any;
  } else if (body.fund_slug) {
    const { data: positions } = await admin.from("fund_portfolio").select("company_slug").eq("fund_slug", body.fund_slug);
    const slugs = Array.from(new Set((positions ?? []).map((r: any) => r.company_slug)));
    if (slugs.length === 0) return json(200, { ok: true, scanned: 0, note: "empty portfolio" });
    const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();
    const { data } = await admin.from("companies").select("slug,twitter,x_activity_checked_at").in("slug", slugs).not("twitter", "is", null);
    targets = ((data ?? []) as any[]).filter((r: any) => !r.x_activity_checked_at || r.x_activity_checked_at < cutoff).map((r: any) => ({ slug: r.slug, twitter: r.twitter })).slice(0, limit);
  } else {
    return json(400, { error: "slugs or fund_slug required" });
  }
  if (targets.length === 0) return json(200, { ok: true, scanned: 0, note: "nothing stale to poll" });

  let updated = 0, failures = 0;
  const sampleUpdates: any[] = [];
  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((row: any) => pollOne(admin, row)));
    for (const r of results) {
      if (r.updated) { updated++; if (sampleUpdates.length < 10) sampleUpdates.push(r); }
      else failures++;
    }
  }
  return json(200, { ok: true, scanned: targets.length, updated, failures, sample: sampleUpdates });
});
