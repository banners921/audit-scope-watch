// v8 — debug output for single-slug runs so we can see what's happening
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const UA = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0";

function json(s: number, b: unknown): Response {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
}

function extractDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : "https://" + url);
    return u.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch { return null; }
}

function probeUrls(url: string | null): string[] {
  if (!url) return [];
  const d = extractDomain(url);
  if (!d) return [];
  const docs = "https://docs." + d;
  const base = "https://" + d;
  return [
    docs + "/resources/audits", docs + "/security/audits", docs + "/audits", docs + "/security",
    docs + "/resources/security", docs + "/protocol/security",
    base + "/security", base + "/audits", base + "/security/audits",
    base + "/resources/audits", base + "/about/security", base + "/protocol/security",
  ];
}

async function tryFetch(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(7000) });
    if (!r.ok) return null;
    const html = await r.text();
    return html.length > 800 ? html.slice(0, 200000) : null;
  } catch { return null; }
}

function htmlToText(html: string): string {
  let t = html;
  t = t.replace(/<script[\s\S]*?<\/script>/gi, " ");
  t = t.replace(/<style[\s\S]*?<\/style>/gi, " ");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  t = t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
  return t.replace(/\s+/g, " ").trim();
}

function extractPdfUrls(html: string): string[] {
  const urls: string[] = [];
  const re = /href="([^"]+\.pdf[^"]*)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let u = m[1];
    if (u.startsWith("//")) u = "https:" + u;
    if (u.startsWith("/")) continue;
    if (u.startsWith("http")) urls.push(u);
  }
  return urls;
}

function extractJson(s: string): any {
  if (!s) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const c = fenced ? fenced[1] : s;
  const start = c.indexOf("{"); const end = c.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(c.slice(start, end + 1)); } catch { return null; }
}

const SYSTEM_PROMPT = "You analyze a protocol's security/audits/bug-bounty page. Return ONLY JSON:\n\n{\n  \"audits\": [ {\"firm\": str, \"date\": str|null, \"report_url\": str|null, \"audited_scope\": str|null, \"language\": str|null} ],\n  \"bug_bounty\": {\"has_bounty\": bool, \"platform\": str|null, \"max_bounty_usd\": int|null, \"critical_max_usd\": int|null, \"high_max_usd\": int|null, \"medium_max_usd\": int|null, \"low_max_usd\": int|null, \"program_url\": str|null, \"scope_summary\": str|null} | null\n}\n\nRules: audits need a real firm name + date or URL. Accept boutique firms (Adevar Labs, Highland Security, OShield, sec3, Bramah). Private audits: report_url=null. Date YYYY-MM-DD preferred. Bounty USD: $1.2M->1200000, $500K->500000.";

async function callAnthropic(apiKey: string, pageText: string, pdfUrls: string[], name: string): Promise<{ audits: any[]; bug_bounty: any | null; raw: string | null }> {
  const userContent = "Protocol: " + name + "\n\nKnown PDF links on page:\n" + pdfUrls.slice(0, 30).join("\n") + "\n\nPage text:\n" + pageText.slice(0, 18000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 3500, system: SYSTEM_PROMPT, messages: [{ role: "user", content: userContent }] }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) { const t = await r.text().catch(() => ""); return { audits: [], bug_bounty: null, raw: "http_" + r.status + ":" + t.slice(0, 200) }; }
    const j = await r.json();
    const raw = j?.content?.[0]?.text || "";
    const parsed = extractJson(raw);
    return {
      audits: Array.isArray(parsed?.audits) ? parsed.audits : [],
      bug_bounty: parsed?.bug_bounty && typeof parsed.bug_bounty === "object" ? parsed.bug_bounty : null,
      raw: raw.slice(0, 600),
    };
  } catch (e) { return { audits: [], bug_bounty: null, raw: "exception:" + String(e).slice(0, 200) }; }
}

async function processCompany(admin: any, anthropicKey: string, company: any, debug: boolean): Promise<any> {
  const urls = probeUrls(company.url);
  if (urls.length === 0) return { found: 0, no_url: true };

  const results = await Promise.all(urls.map(async (u) => ({ url: u, html: await tryFetch(u) })));
  const probedOk = results.filter((r) => r.html);
  let best: { url: string; html: string; text: string; mentions: number } | null = null;
  for (const r of results) {
    if (!r.html) continue;
    const text = htmlToText(r.html);
    if (text.length < 800) continue;
    const m = (text.match(/\b(audit|bug bounty|security review|security audit)\b/gi) || []).length;
    if (m < 2) continue;
    if (!best || m > best.mentions) best = { url: r.url, html: r.html, text, mentions: m };
  }

  await admin.from("companies").update({ ats_last_checked: new Date().toISOString() }).eq("slug", company.slug);

  if (!best) {
    return { found: 0, probed: probedOk.length, probed_urls: probedOk.map((r) => r.url), reason: "no_security_page" };
  }

  const pdfUrls = extractPdfUrls(best.html);
  const llm = await callAnthropic(anthropicKey, best.text, pdfUrls, company.name);

  let inserted = 0, dupes = 0, errors = 0;
  for (const a of llm.audits) {
    if (!a.firm || typeof a.firm !== "string" || a.firm.length < 2 || a.firm.length > 60) { errors++; continue; }
    let auditDate: string | null = null;
    if (a.date) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(a.date)) auditDate = a.date;
      else if (/^\d{4}-\d{2}$/.test(a.date)) auditDate = a.date + "-01";
      else if (/^\d{4}$/.test(a.date)) auditDate = a.date + "-01-01";
    }
    let reportUrl: string | null = null;
    if (a.report_url && typeof a.report_url === "string" && /^https?:\/\//.test(a.report_url)) reportUrl = a.report_url;

    if (reportUrl) {
      const { data: existing } = await admin.from("audit_history").select("id").eq("report_url", reportUrl).maybeSingle();
      if (existing) { dupes++; continue; }
    } else if (auditDate) {
      const { data: existing } = await admin.from("audit_history").select("id").eq("company_slug", company.slug).eq("audit_firm", a.firm.trim()).eq("audit_date", auditDate).maybeSingle();
      if (existing) { dupes++; continue; }
    }
    const { error } = await admin.from("audit_history").insert({
      company_slug: company.slug, protocol_name: company.name, audit_firm: a.firm.trim(),
      audit_date: auditDate, report_url: reportUrl,
      smart_contract_language: typeof a.language === "string" ? a.language.toLowerCase() : null,
      data_source: "protocol_security_page:direct",
    });
    if (!error) inserted++; else errors++;
  }

  let bounty_inserted = 0;
  if (llm.bug_bounty?.has_bounty) {
    const platform = (llm.bug_bounty.platform || "self-hosted").toLowerCase();
    const max = Number(llm.bug_bounty.max_bounty_usd ?? 0) || null;
    const { data: existing } = await admin.from("bug_bounties").select("id").eq("company_slug", company.slug).maybeSingle();
    if (!existing) {
      const { error } = await admin.from("bug_bounties").insert({
        company_slug: company.slug, platform, max_bounty_usd: max,
        program_url: llm.bug_bounty.program_url || best.url,
        is_active: true, last_updated: new Date().toISOString(),
        critical_max_usd: llm.bug_bounty.critical_max_usd || null,
        high_max_usd: llm.bug_bounty.high_max_usd || null,
        medium_max_usd: llm.bug_bounty.medium_max_usd || null,
        low_max_usd: llm.bug_bounty.low_max_usd || null,
        scope_summary: llm.bug_bounty.scope_summary || null,
      });
      if (!error) bounty_inserted = 1;
    }
    await admin.from("companies").update({ has_bug_bounty: true }).eq("slug", company.slug);
  }

  const result: any = {
    found: llm.audits.length, inserted, dupes, errors, bounty_inserted,
    picked: best.url, mentions: best.mentions, text_chars: best.text.length, pdf_count: pdfUrls.length,
  };
  if (debug) { result.llm_raw = llm.raw; result.audits_returned = llm.audits.slice(0, 3); result.bounty_returned = llm.bug_bounty; }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!supabaseUrl || !serviceKey) return json(500, { error: "missing env" });
    if (!anthropicKey) return json(500, { error: "Missing ANTHROPIC_API_KEY" });
    const cronKey = req.headers.get("x-cron-key") || "";
    if (cronKey !== CRON_KEY) return json(401, { error: "Unauthorized" });

    const admin = createClient(supabaseUrl, serviceKey);
    const body = (await req.json().catch(() => ({}))) as { limit?: number; concurrency?: number; slug?: string; debug?: boolean };
    const limit = Math.min(Math.max(body.limit ?? 15, 1), 40);
    const concurrency = Math.min(Math.max(body.concurrency ?? 3, 1), 6);
    const debug = !!body.debug || !!body.slug;

    let query = admin.from("companies").select("slug,name,url,audit_count,ats_last_checked").not("url", "is", null);
    if (body.slug) query = query.eq("slug", body.slug);
    else query = query.or("ats_last_checked.is.null,ats_last_checked.lt." + new Date(Date.now() - 14 * 86400_000).toISOString())
      .order("ats_last_checked", { ascending: true, nullsFirst: true });
    query = query.limit(limit);
    const { data: companies, error: qerr } = await query;
    if (qerr) return json(500, { error: "query failed: " + qerr.message });
    if (!companies || companies.length === 0) return json(200, { ok: true, scanned: 0 });

    let totalInserted = 0, totalBounty = 0, totalDupes = 0;
    const details: any[] = [];
    for (let i = 0; i < companies.length; i += concurrency) {
      const chunk = companies.slice(i, i + concurrency);
      const outcomes = await Promise.all(chunk.map((c: any) => processCompany(admin, anthropicKey, c, debug)));
      for (let j = 0; j < outcomes.length; j++) {
        const o = outcomes[j] as any;
        totalInserted += o.inserted || 0;
        totalBounty += o.bounty_inserted || 0;
        totalDupes += o.dupes || 0;
        if (debug || (o.inserted || o.bounty_inserted)) details.push({ slug: chunk[j].slug, ...o });
      }
    }
    return json(200, { ok: true, scanned: companies.length, inserted: totalInserted, dupes: totalDupes, bounty_inserted: totalBounty, details });
  } catch (e) {
    return json(500, { error: "Crash: " + String(e).slice(0, 300) });
  }
});
