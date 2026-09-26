// enrich-bug-bounty v2 — deep-enriches each bug_bounties row with scope, severity, payouts.
// Parallel chunks to avoid wall-clock timeout.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const UA = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

async function fetchPage(url: string): Promise<string | null> {
  try {
    const r = await fetch(`https://r.jina.ai/${url}`, { headers: { "User-Agent": UA, "X-Return-Format": "text" } });
    if (r.ok) { const t = await r.text(); if (t.length > 1000) return t.slice(0, 60_000); }
  } catch {}
  const fcKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (fcKey) {
    try {
      const r = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${fcKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats: ["markdown"], waitFor: 5000, timeout: 60000 }),
      });
      if (r.ok) { const j = await r.json(); const md = j?.data?.markdown || ""; if (md.length > 500) return md.slice(0, 60_000); }
    } catch {}
  }
  return null;
}

function extractJson(s: string): any {
  if (!s) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : s;
  const start = candidate.indexOf("{"); const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

const SYSTEM_PROMPT = `You extract structured intel from a crypto bug bounty program page. Return ONLY JSON:

{
  "critical_max_usd": number | null,
  "high_max_usd": number | null,
  "medium_max_usd": number | null,
  "low_max_usd": number | null,
  "max_bounty_usd": number | null,
  "scope_chains": string[],
  "scope_contracts": string[],
  "scope_repos": string[],
  "scope_summary": string | null,
  "out_of_scope": string | null,
  "reward_tokens": string[],
  "program_launched_at": "YYYY-MM-DD" | null,
  "last_payout_date": "YYYY-MM-DD" | null,
  "last_payout_amount_usd": number | null,
  "total_paid_lifetime_usd": number | null,
  "reports_valid_count": number | null,
  "triage_sla": string | null,
  "kyc_required": boolean | null,
  "geo_restrictions": string | null
}

Rules:
- Parse '$1.2M' → 1200000, '$500K' → 500000, '5%/10%/50%' staged caps → max value.
- Only return values explicitly stated. Use null for unknown.
- scope_chains: lowercase canonical names (ethereum, bsc, polygon, arbitrum, etc).
- scope_contracts: only valid 0x... addresses, up to 20.
- scope_repos: github.com URLs, up to 10.
- Be strict — don't hallucinate.`;

async function enrich(apiKey: string, page: string, programUrl: string): Promise<any | null> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5", max_tokens: 2000, system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Program URL: ${programUrl}\n\n${page.slice(0, 20000)}` }],
    }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return extractJson(j?.content?.[0]?.text || "");
}

async function processOne(admin: any, anthropicKey: string, r: any): Promise<"enriched" | "fetch_failed" | "parse_failed" | "error"> {
  try {
    const page = await fetchPage(r.program_url);
    if (!page) {
      await admin.from("bug_bounties").update({ deep_extraction_status: "fetch_failed", deep_extracted_at: new Date().toISOString() }).eq("id", r.id);
      return "fetch_failed";
    }
    const ex = await enrich(anthropicKey, page, r.program_url);
    if (!ex) {
      await admin.from("bug_bounties").update({ deep_extraction_status: "parse_failed", deep_extracted_at: new Date().toISOString() }).eq("id", r.id);
      return "parse_failed";
    }
    const update: any = {
      critical_max_usd: ex.critical_max_usd, high_max_usd: ex.high_max_usd, medium_max_usd: ex.medium_max_usd, low_max_usd: ex.low_max_usd,
      max_bounty_usd: ex.max_bounty_usd || ex.critical_max_usd || undefined,
      scope_chains: Array.isArray(ex.scope_chains) ? ex.scope_chains.slice(0, 20) : null,
      scope_contracts: Array.isArray(ex.scope_contracts) ? ex.scope_contracts.filter((x: string) => /^0x[a-f0-9]{40}$/i.test(x)).slice(0, 30) : null,
      scope_repos: Array.isArray(ex.scope_repos) ? ex.scope_repos.filter((x: string) => /^https?:\/\/(www\.)?github\.com/i.test(x)).slice(0, 10) : null,
      scope_summary: ex.scope_summary ? String(ex.scope_summary).slice(0, 600) : null,
      out_of_scope: ex.out_of_scope ? String(ex.out_of_scope).slice(0, 600) : null,
      reward_tokens: Array.isArray(ex.reward_tokens) ? ex.reward_tokens.slice(0, 8) : null,
      program_launched_at: ex.program_launched_at,
      last_payout_date: ex.last_payout_date,
      last_payout_amount_usd: ex.last_payout_amount_usd,
      total_paid_lifetime_usd: ex.total_paid_lifetime_usd,
      reports_valid_count: ex.reports_valid_count,
      triage_sla: ex.triage_sla ? String(ex.triage_sla).slice(0, 80) : null,
      kyc_required: typeof ex.kyc_required === "boolean" ? ex.kyc_required : null,
      geo_restrictions: ex.geo_restrictions ? String(ex.geo_restrictions).slice(0, 200) : null,
      deep_extracted_at: new Date().toISOString(),
      deep_extraction_status: "enriched",
    };
    Object.keys(update).forEach(k => update[k] === undefined && delete update[k]);
    await admin.from("bug_bounties").update(update).eq("id", r.id);
    return "enriched";
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
  const body = (await req.json().catch(() => ({}))) as { limit?: number; bounty_ids?: string[]; force?: boolean; concurrency?: number };
  const limit = Math.min(Math.max(body.limit ?? 30, 1), 80);
  const concurrency = Math.min(Math.max(body.concurrency ?? 5, 1), 10);

  let query = admin.from("bug_bounties").select("id,program_url,platform,company_slug").not("program_url", "is", null);
  if (body.bounty_ids?.length) query = query.in("id", body.bounty_ids);
  else if (!body.force) query = query.is("deep_extracted_at", null);
  query = query.limit(limit);
  const { data: rows } = await query;
  if (!rows || rows.length === 0) return json(200, { ok: true, scanned: 0, note: "no candidates" });

  let enriched = 0, fetchFailed = 0, parseFailed = 0, errs = 0;
  for (let i = 0; i < rows.length; i += concurrency) {
    const chunk = rows.slice(i, i + concurrency);
    const outcomes = await Promise.all(chunk.map((r: any) => processOne(admin, anthropicKey, r)));
    for (const o of outcomes) {
      if (o === "enriched") enriched++;
      else if (o === "fetch_failed") fetchFailed++;
      else if (o === "parse_failed") parseFailed++;
      else errs++;
    }
  }
  return json(200, { ok: true, scanned: rows.length, enriched, fetch_failed: fetchFailed, parse_failed: parseFailed, errors: errs });
});
