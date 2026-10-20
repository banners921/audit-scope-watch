import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Risk scores stopped updating on 2026-05-23 (compute-risk-scores has no
// schedule). While false, frozen scores are left out of everything this
// function produces. Matches RISK_SCORES_LIVE in src/lib/riskScores.ts.
const RISK_SCORES_LIVE = false;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

type Filters = {
  kind: "fund_portfolio" | "companies" | "categories" | "funds" | "custom";
  fund_slug?: string; company_slugs?: string[]; categories?: string[]; fund_slugs?: string[];
  date_from?: string; date_to?: string;
  include_news?: boolean; include_social?: boolean;
  title?: string; push_to_slack?: boolean;
};

async function exaSearch(apiKey: string, query: string, numResults: number, daysAgo: number, category?: string): Promise<any[]> {
  const startDate = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const r = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      query, numResults, type: "neural",
      startPublishedDate: startDate,
      contents: { text: { maxCharacters: 1000 }, summary: { query: "key facts in one sentence" } },
      category: category || undefined,
    }),
  });
  if (!r.ok) return [];
  const j = await r.json();
  return Array.isArray(j.results) ? j.results : [];
}

async function grokCompose(apiKey: string, system: string, user: string): Promise<string> {
  const r = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "grok-4-fast-reasoning",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: 4000,
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Grok ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return j?.choices?.[0]?.message?.content || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const grokKey = Deno.env.get("XAI_API_KEY") || Deno.env.get("GROK_API_KEY");
  const exaKey = Deno.env.get("EXA_API_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Missing supabase env" });
  if (!grokKey) return json(500, { error: "Missing XAI_API_KEY (Grok)" });

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return json(401, { error: "Unauthorized" });
  const u = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await u.auth.getUser();
  if (!userData?.user) return json(401, { error: "Unauthorized" });
  const userId = userData.user.id;
  const admin = createClient(supabaseUrl, serviceKey);

  const body = (await req.json().catch(() => ({}))) as Filters;
  const kind = body.kind || "fund_portfolio";
  const dateFrom = body.date_from || new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const dateTo = body.date_to || new Date().toISOString().slice(0, 10);
  const includeNews = body.include_news !== false;
  const includeSocial = body.include_social === true;

  let companySlugs: string[] = [];
  let scopeLabel = "";
  if (kind === "fund_portfolio" || kind === "funds") {
    let fundSlugs: string[] = [];
    if (kind === "fund_portfolio") {
      const { data: prof } = await admin.from("user_profiles").select("fund_slug").eq("user_id", userId).maybeSingle();
      const fSlug = body.fund_slug || prof?.fund_slug;
      if (!fSlug) return json(400, { error: "No fund affiliation" });
      fundSlugs = [fSlug];
    } else { fundSlugs = body.fund_slugs || []; if (fundSlugs.length === 0) return json(400, { error: "funds kind requires fund_slugs[]" }); }
    const { data: portfolio } = await admin.from("fund_portfolio").select("company_slug").in("fund_slug", fundSlugs);
    companySlugs = Array.from(new Set((portfolio || []).map((r: any) => r.company_slug).filter(Boolean)));
    const { data: fundRows } = await admin.from("funds").select("name").in("slug", fundSlugs);
    scopeLabel = (fundRows || []).map((f: any) => f.name).join(", ") || fundSlugs.join(", ");
  } else if (kind === "companies") {
    companySlugs = body.company_slugs || [];
    if (companySlugs.length === 0) return json(400, { error: "companies kind requires company_slugs[]" });
    const { data: rows } = await admin.from("companies").select("name").in("slug", companySlugs);
    scopeLabel = (rows || []).map((c: any) => c.name).slice(0, 5).join(", ") + ((rows?.length || 0) > 5 ? ", …" : "");
  } else if (kind === "categories") {
    const cats = body.categories || [];
    if (cats.length === 0) return json(400, { error: "categories kind requires categories[]" });
    const { data: rows } = await admin.from("companies").select("slug").in("category", cats).limit(200);
    companySlugs = (rows || []).map((c: any) => c.slug);
    scopeLabel = cats.join(", ");
  } else {
    companySlugs = body.company_slugs || [];
    scopeLabel = "custom";
  }
  if (companySlugs.length === 0) return json(400, { error: "No companies match the filters" });
  const capped = companySlugs.slice(0, 80);

  const [companyRows, audits, anomalies, funding, hiring, hacks, newsFromDb, risks, contracts] = await Promise.all([
    admin.from("companies").select("slug,name,category,description,url,last_audit_firm,last_audit_date,has_been_hacked,has_bug_bounty").in("slug", capped),
    admin.from("audit_history").select("company_slug,audit_firm,protocol_name,audit_date,report_url,findings_critical,findings_high,findings_medium,findings_low,ai_summary").in("company_slug", capped).order("audit_date", { ascending: false }).limit(120),
    admin.from("metric_anomalies").select("company_slug,chain,date,detail,direction,z_score").in("company_slug", capped).gte("date", dateFrom).lte("date", dateTo).order("date", { ascending: false }).limit(40),
    admin.from("funding_rounds").select("company_slug,company_name,round_type,amount_usd,date,all_investors,announcement_url").in("company_slug", capped).gte("date", dateFrom).lte("date", dateTo).order("date", { ascending: false }).limit(40),
    admin.from("hiring_sources").select("company_slug,role_count,smart_contract_count,security_count,last_seen_at").in("company_slug", capped).order("last_seen_at", { ascending: false }).limit(80),
    admin.from("hacks").select("company_slug,name,hack_date,amount_usd,classification,technique").in("company_slug", capped).order("hack_date", { ascending: false }).limit(30),
    admin.from("news_items").select("company_slug,title,url,source,summary,sentiment,published_at").in("company_slug", capped).gte("published_at", dateFrom).order("published_at", { ascending: false }).limit(80),
    RISK_SCORES_LIVE
      ? admin.from("protocol_risk_scores").select("company_slug,composite_score,band,drivers").in("company_slug", capped)
      : Promise.resolve({ data: [] as any[] }),
    admin.from("chain_addresses").select("company_slug,chain,proxy_pattern,is_contract").in("company_slug", capped),
  ]);

  // 3. Live news via Exa for the top-10 companies (filter to date window)
  const topNames = (companyRows.data || []).slice(0, 10).map((c: any) => ({ slug: c.slug, name: c.name }));
  let exaItems: any[] = [];
  if (includeNews && exaKey && topNames.length) {
    const dateDays = Math.max(1, Math.ceil((Date.now() - new Date(dateFrom).getTime()) / 86400000));
    for (const tn of topNames.slice(0, 6)) {
      const results = await exaSearch(exaKey, `${tn.name} crypto web3 news partnerships funding security`, 3, dateDays, "news");
      for (const r of results) {
        exaItems.push({
          company: tn.slug, title: r.title, url: r.url, source: (() => { try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch { return null; } })(),
          snippet: r.summary || (r.text || "").slice(0, 300), date: r.publishedDate,
        });
      }
    }
  }

  const dossier = {
    scope: scopeLabel,
    window: { from: dateFrom, to: dateTo },
    portfolio_count: capped.length,
    risk_scores: (risks.data || []).map((r: any) => ({ company: r.company_slug, score: r.composite_score, band: r.band, top_drivers: (r.drivers || []).slice(0, 3) })),
    companies: (companyRows.data || []).map((c: any) => ({ slug: c.slug, name: c.name, category: c.category, last_audit_firm: c.last_audit_firm, last_audit_date: c.last_audit_date, hacked: c.has_been_hacked, bug_bounty: c.has_bug_bounty })),
    audits_in_window: (audits.data || []).filter((a: any) => !a.audit_date || (a.audit_date >= dateFrom && a.audit_date <= dateTo)).map((a: any) => ({ protocol: a.protocol_name, firm: a.audit_firm, date: a.audit_date, url: a.report_url, slug: a.company_slug, critical: a.findings_critical, high: a.findings_high, medium: a.findings_medium, summary: a.ai_summary })),
    risk_anomalies: (anomalies.data || []).map((a: any) => ({ company: a.company_slug, chain: a.chain, date: a.date, direction: a.direction, z: a.z_score, detail: a.detail })),
    funding_in_window: (funding.data || []).map((f: any) => ({ company: f.company_slug, name: f.company_name, type: f.round_type, amount_usd: f.amount_usd, date: f.date, investors: f.all_investors, url: f.announcement_url })),
    hiring_signals: (hiring.data || []).filter((h: any) => h.role_count > 0).map((h: any) => ({ company: h.company_slug, total: h.role_count, sc: h.smart_contract_count, sec: h.security_count, seen: h.last_seen_at })),
    hack_history: (hacks.data || []).map((h: any) => ({ company: h.company_slug, name: h.name, date: h.hack_date, amount_usd: h.amount_usd, classification: h.classification, technique: h.technique })),
    news_cached: (newsFromDb.data || []).map((n: any) => ({ company: n.company_slug, title: n.title, url: n.url, source: n.source, snippet: n.summary, sentiment: n.sentiment, date: n.published_at })),
    news_live: exaItems,
    contracts: (contracts.data || []).reduce((acc: any, c: any) => { acc[c.company_slug] = acc[c.company_slug] || { total: 0, proxies: 0, chains: new Set() }; acc[c.company_slug].total++; if (c.proxy_pattern && c.proxy_pattern !== "non_proxy") acc[c.company_slug].proxies++; acc[c.company_slug].chains.add(c.chain); return acc; }, {}),
  };
  // Flatten contract summary
  const contractSummary: any = {};
  for (const [slug, val] of Object.entries(dossier.contracts as any)) {
    contractSummary[slug] = { total: (val as any).total, proxies: (val as any).proxies, chains: Array.from((val as any).chains) };
  }
  dossier.contracts = contractSummary;

  const system = `You write portfolio intelligence reports for crypto fund analysts. Be specific, terse, and only state facts that appear in the provided dossier. Do NOT predict or speculate. Cite dates and sources.

Structure as markdown:

# {Title}
_Scope · Window_

## TL;DR
3-5 bullet sentences summarizing key changes.

## Risk movers
Protocols whose risk profile changed materially. Use risk_scores + audits_in_window + hack_history + risk_anomalies.

## Funding activity
New rounds. Cite lead investors and amounts.

## Audit & operational events
Audits published (note critical/high counts where extracted), upgrades, multisig changes, hiring spikes.

## News & sentiment
Most interesting items from news_cached + news_live. Brief quote + source.

## What to watch next
Flag obvious follow-ups based ONLY on dossier facts.

Keep under 700 words. Be useful.`;

  const userMsg = `Generate the portfolio report.\n\nTITLE: ${body.title || `${scopeLabel} — ${dateFrom} to ${dateTo}`}\n\nDOSSIER:\n${JSON.stringify(dossier, null, 2).slice(0, 60000)}`;

  let markdown: string;
  try { markdown = await grokCompose(grokKey, system, userMsg); }
  catch (e) { return json(502, { error: `Grok compose failed: ${String(e)}` }); }

  const { data: saved, error: insErr } = await admin.from("reports").insert({
    user_id: userId,
    title: body.title || `${scopeLabel} — ${dateFrom} to ${dateTo}`,
    filter_kind: kind, filters: body, date_from: dateFrom, date_to: dateTo, markdown,
    meta: {
      portfolio_count: capped.length,
      audits_in_window: dossier.audits_in_window.length,
      anomalies: dossier.risk_anomalies.length,
      funding_rounds: dossier.funding_in_window.length,
      hiring_companies: dossier.hiring_signals.length,
      hacks: dossier.hack_history.length,
      news_cached: dossier.news_cached.length,
      news_live: exaItems.length,
      risk_scored: dossier.risk_scores.length,
    },
  }).select("id").single();
  if (insErr) return json(500, { error: insErr.message });

  let slackDelivered = false;
  if (body.push_to_slack) {
    const { data: prof } = await admin.from("user_profiles").select("slack_webhook_url").eq("user_id", userId).maybeSingle();
    const webhook = prof?.slack_webhook_url;
    if (webhook) {
      try {
        const slackText = markdown.length > 39000 ? markdown.slice(0, 39000) + "\n\n…truncated" : markdown;
        const r = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: slackText, mrkdwn: true }) });
        slackDelivered = r.ok;
        if (r.ok) await admin.from("reports").update({ delivered_to_slack: true, delivered_at: new Date().toISOString() }).eq("id", saved!.id);
      } catch { /* swallow */ }
    }
  }

  return json(200, {
    ok: true, report_id: saved!.id, markdown,
    meta: { portfolio_count: capped.length, audits: dossier.audits_in_window.length, anomalies: dossier.risk_anomalies.length, funding: dossier.funding_in_window.length, hiring: dossier.hiring_signals.length, hacks: dossier.hack_history.length, news_cached: dossier.news_cached.length, news_live: exaItems.length, risk_scored: dossier.risk_scores.length, slack_delivered: slackDelivered },
  });
});
