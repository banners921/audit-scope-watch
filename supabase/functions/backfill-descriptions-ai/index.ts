// backfill-descriptions-ai — fills missing company descriptions using Claude Haiku
// knowledge + any context we already have (audits, url, category).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

async function jinaText(url: string): Promise<string | null> {
  try {
    const r = await fetch(`https://r.jina.ai/${url}`, { headers: { "User-Agent": "AuditScope/1.0", "X-Return-Format": "text" } });
    if (!r.ok) return null;
    const t = await r.text();
    return t.length > 200 ? t.slice(0, 12_000) : null;
  } catch { return null; }
}

function extractJson(s: string): any {
  if (!s) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : s;
  const start = candidate.indexOf("{"); const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

const SYSTEM_PROMPT = `You write concise 1-2 sentence factual descriptions of crypto/web3 protocols. Return ONLY JSON:

{
  "description": string | null,  // 1-2 sentences, max 240 chars. Factual. No marketing fluff. Null if you cannot find it.
  "category": string | null,     // 1-2 word category (DEX, Lending, L1, L2, Bridge, Stablecoin, RWA, AI, Gaming, Privacy, Yield, Derivatives, CDP, Wallet, Tooling, etc.)
  "confidence": "high" | "medium" | "low"
}

Rules:
- If you're not confident the protocol exists (could be fake/typo/abandoned), return description: null with confidence: "low".
- Lead with WHAT it is and the chain/standard if known. No "revolutionary", "cutting-edge".
- Examples: "Cross-chain swap aggregator on Axelar. Routes through DEXs to bridge any token across 50+ chains." / "AVS for liquid restaking on EigenLayer; secures bridges and shared sequencers."`;

async function describe(apiKey: string, name: string, context: string): Promise<{ description: string | null; category: string | null; confidence: string } | null> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5", max_tokens: 400, system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Protocol/company name: ${name}\n\nContext we have:\n${context || "(none)"}` }],
    }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return extractJson(j?.content?.[0]?.text || "");
}

async function processOne(admin: any, anthropicKey: string, c: any): Promise<"described" | "unknown" | "error"> {
  try {
    let context = "";
    if (c.url) {
      context += `Website: ${c.url}\n`;
      const text = await jinaText(c.url);
      if (text) context += `\nWebsite content (excerpt):\n${text.slice(0, 6000)}`;
    }
    if (c.category) context += `Existing category tag: ${c.category}\n`;
    if (c.audit_count && c.audit_count > 0) {
      const { data: audits } = await admin.from("audit_history").select("audit_firm,audit_date,smart_contract_language,scope_summary").eq("company_slug", c.slug).order("audit_date", { ascending: false }).limit(3);
      if (audits && audits.length > 0) {
        const lines = audits.map((a: any) => `- ${a.audit_firm}${a.audit_date ? " (" + a.audit_date + ")" : ""}${a.smart_contract_language ? " " + a.smart_contract_language : ""}${a.scope_summary ? " — " + String(a.scope_summary).slice(0, 100) : ""}`);
        context += `Audits:\n${lines.join("\n")}\n`;
      }
    }
    const result = await describe(anthropicKey, c.name, context.trim());
    if (!result || !result.description || result.confidence === "low") {
      // mark as attempted so we don't retry forever
      await admin.from("companies").update({ description_generated_at: new Date().toISOString() }).eq("slug", c.slug);
      return "unknown";
    }
    const updates: any = { description: result.description.slice(0, 600), description_generated_at: new Date().toISOString() };
    if (!c.category && result.category) updates.category = result.category;
    await admin.from("companies").update(updates).eq("slug", c.slug);
    return "described";
  } catch { return "error"; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return json(500, { error: "Missing ANTHROPIC_API_KEY" });
  const cronKey = req.headers.get("x-cron-key") || "";
  if (cronKey !== CRON_KEY) return json(401, { error: "Unauthorized" });
  const admin = createClient(supabaseUrl, serviceKey);
  const body = (await req.json().catch(() => ({}))) as { limit?: number; concurrency?: number; tier?: "audits" | "funding" | "url" | "any" };
  const limit = Math.min(Math.max(body.limit ?? 30, 1), 100);
  const concurrency = Math.min(Math.max(body.concurrency ?? 5, 1), 10);
  const tier = body.tier || "audits";

  let query = admin.from("companies").select("slug,name,url,category,audit_count")
    .or("description.is.null,description.eq.")
    .is("description_generated_at", null);
  if (tier === "audits") query = query.gt("audit_count", 0);
  else if (tier === "funding") query = query.gt("total_raised_usd", 0);
  else if (tier === "url") query = query.not("url", "is", null);
  // "any" — no filter
  const { data: rows } = await query.order("audit_count", { ascending: false, nullsFirst: false }).limit(limit);
  if (!rows || rows.length === 0) return json(200, { ok: true, scanned: 0, tier, note: "no candidates" });

  let described = 0, unknown = 0, errs = 0;
  for (let i = 0; i < rows.length; i += concurrency) {
    const chunk = rows.slice(i, i + concurrency);
    const outcomes = await Promise.all(chunk.map((c: any) => processOne(admin, anthropicKey, c)));
    for (const o of outcomes) {
      if (o === "described") described++;
      else if (o === "unknown") unknown++;
      else errs++;
    }
  }
  return json(200, { ok: true, tier, scanned: rows.length, described, unknown, errors: errs });
});
