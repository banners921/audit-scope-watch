import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

async function exaSearch(apiKey: string, query: string, numResults: number, daysAgo: number): Promise<{ results: any[]; error?: string }> {
  const startDate = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const r = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      query,
      numResults,
      type: "neural",
      startPublishedDate: startDate,
      contents: { text: { maxCharacters: 1500 }, summary: { query: "key facts in one sentence" } },
      category: "news",
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return { results: [], error: `Exa ${r.status}: ${t.slice(0, 200)}` };
  }
  const j = await r.json();
  return { results: Array.isArray(j.results) ? j.results : [] };
}

async function classifySentimentBatch(grokKey: string | undefined, items: Array<{ title: string; summary: string | null }>): Promise<Array<"positive" | "neutral" | "negative" | "mixed" | null>> {
  if (!grokKey || items.length === 0) return items.map(() => null);
  const list = items.map((it, i) => `${i + 1}. ${it.title} — ${(it.summary || "").slice(0, 200)}`).join("\n");
  try {
    const r = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${grokKey}` },
      body: JSON.stringify({
        model: "grok-4-fast-reasoning",
        messages: [
          { role: "system", content: "Classify each news item's sentiment toward the named crypto/web3 project. Return ONLY a JSON object {sentiments: ['positive'|'neutral'|'negative'|'mixed', ...]} with one entry per input item in order." },
          { role: "user", content: `Items:\n${list}` },
        ],
        response_format: { type: "json_object" },
        max_tokens: 500,
      }),
    });
    if (!r.ok) return items.map(() => null);
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed.sentiments) ? parsed.sentiments : [];
    return items.map((_, i) => {
      const s = String(arr[i] || "").toLowerCase();
      return ["positive", "neutral", "negative", "mixed"].includes(s) ? (s as any) : null;
    });
  } catch {
    return items.map(() => null);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const exaKey = Deno.env.get("EXA_API_KEY");
  const grokKey = Deno.env.get("XAI_API_KEY") || Deno.env.get("GROK_API_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Missing supabase env" });
  if (!exaKey) return json(500, { error: "Missing EXA_API_KEY" });
  const cronKey = req.headers.get("x-cron-key") || "";
  const authHeader = req.headers.get("Authorization") || "";
  if (cronKey !== CRON_KEY) {
    if (!authHeader) return json(401, { error: "Unauthorized" });
    const u = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data } = await u.auth.getUser();
    if (!data?.user) return json(401, { error: "Unauthorized" });
  }
  const admin = createClient(supabaseUrl, serviceKey);
  const body = (await req.json().catch(() => ({}))) as { slugs?: string[]; fund_slug?: string; limit?: number; days?: number; classify_sentiment?: boolean };
  const days = body.days || 14;
  let slugs: string[] = body.slugs || [];
  if (body.fund_slug) {
    const { data } = await admin.from("fund_portfolio").select("company_slug").eq("fund_slug", body.fund_slug);
    slugs = Array.from(new Set((data || []).map((r: any) => r.company_slug).filter(Boolean)));
  }
  if (slugs.length === 0) return json(400, { error: "Provide slugs[] or fund_slug" });
  const limit = Math.min(slugs.length, body.limit ?? 8);
  const targets = slugs.slice(0, limit);

  const { data: companies } = await admin.from("companies").select("slug,name,category").in("slug", targets);
  const compMap = new Map<string, { slug: string; name: string; category: string | null }>();
  for (const c of (companies ?? []) as any[]) compMap.set(c.slug, c);

  let totalInserted = 0, totalDupes = 0, totalErrors = 0;
  const perCompany: any[] = [];
  for (const slug of targets) {
    const c = compMap.get(slug);
    if (!c) continue;
    const query = `${c.name} ${c.category ? c.category + " " : ""}crypto web3 news partnerships funding security launch`;
    const r = await exaSearch(exaKey, query, 5, days);
    if (r.error) {
      totalErrors++;
      perCompany.push({ slug, name: c.name, items_found: 0, inserted: 0, error: r.error });
      continue;
    }
    if (r.results.length === 0) {
      perCompany.push({ slug, name: c.name, items_found: 0, inserted: 0 });
      continue;
    }
    // Optional sentiment classification in a single batched call
    let sentiments: Array<string | null> = r.results.map(() => null);
    if (body.classify_sentiment !== false) {
      const batch = r.results.map((it: any) => ({ title: String(it.title || ""), summary: String(it.summary || it.text || "").slice(0, 200) }));
      sentiments = await classifySentimentBatch(grokKey, batch);
    }
    let inserted = 0;
    for (let i = 0; i < r.results.length; i++) {
      const it = r.results[i];
      if (!it.url || !it.title) continue;
      const sourceHost = (() => { try { return new URL(it.url).hostname.replace(/^www\./, ""); } catch { return null; } })();
      const row = {
        company_slug: slug,
        title: String(it.title).slice(0, 400),
        url: String(it.url).slice(0, 600),
        source: sourceHost ? sourceHost.slice(0, 100) : null,
        summary: it.summary || (it.text ? String(it.text).slice(0, 1000) : null),
        sentiment: sentiments[i],
        published_at: it.publishedDate && /\d{4}-\d{2}-\d{2}/.test(it.publishedDate) ? it.publishedDate.slice(0, 10) : null,
      };
      const { error } = await admin.from("news_items").upsert(row, { onConflict: "company_slug,url" });
      if (error) { if (error.code === "23505") totalDupes++; else totalErrors++; }
      else { totalInserted++; inserted++; }
    }
    perCompany.push({ slug, name: c.name, items_found: r.results.length, inserted, sentiments });
  }
  return json(200, { ok: true, targets: targets.length, inserted: totalInserted, dupes: totalDupes, errors: totalErrors, per_company: perCompany });
});
