// v2 — plain INSERT with ON CONFLICT DO NOTHING (cleaner than upsert with quirks)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

async function fetchSitemap(url: string): Promise<string[]> {
  const r = await fetch(url, { headers: { "User-Agent": "AuditScope/1.0" } });
  if (!r.ok) return [];
  const xml = await r.text();
  const urls: string[] = [];
  const re = /<loc>([^<]+\/issues\/[^<]+)<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) urls.push(m[1]);
  return urls;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronKey = req.headers.get("x-cron-key") || "";
  if (cronKey !== CRON_KEY) return json(401, { error: "Unauthorized" });
  const admin = createClient(supabaseUrl, serviceKey);

  const allUrls = new Set<string>();
  for (const i of [1, 2, 3, 4, 5]) {
    const u = `https://solodit.cyfrin.io/sitemap_${i}.xml`;
    const list = await fetchSitemap(u);
    if (list.length === 0 && i > 2) break;
    for (const x of list) allUrls.add(x);
  }
  if (allUrls.size === 0) return json(502, { error: "sitemap fetch failed" });

  const arr = Array.from(allUrls);
  let inserted = 0;
  const errSamples: any[] = [];
  for (let i = 0; i < arr.length; i += 500) {
    const chunk = arr.slice(i, i + 500).map(u => ({ url: u }));
    const { data, error } = await admin.from("solodit_ingest_queue")
      .insert(chunk)
      .select("id");
    if (error) {
      if (error.code === "23505") {
        // dup-key collision; do row-by-row to count what's new
        for (const c of chunk) {
          const { error: e2 } = await admin.from("solodit_ingest_queue").insert(c);
          if (!e2) inserted++;
        }
      } else if (errSamples.length < 3) {
        errSamples.push({ chunk_start: i, error: error.message });
      }
    } else {
      inserted += data?.length || 0;
    }
  }

  const { count: total } = await admin.from("solodit_ingest_queue").select("*", { count: "exact", head: true });
  const { count: pending } = await admin.from("solodit_ingest_queue").select("*", { count: "exact", head: true }).eq("status", "pending");

  return json(200, {
    ok: true,
    sitemap_urls: allUrls.size,
    inserted_new: inserted,
    queue_total: total,
    queue_pending: pending,
    error_samples: errSamples,
    note: errSamples.length > 0 ? "some chunks errored — see samples" : "queue ready"
  });
});
