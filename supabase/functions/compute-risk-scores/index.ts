import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

type Driver = { dimension: string; factor: string; severity: number; value?: string | number; evidence_url?: string | null; good?: boolean };
const MS_DAY = 86400000;
function daysSince(d: string | null | undefined): number | null {
  if (!d) return null; const t = new Date(d).getTime(); if (!isFinite(t)) return null;
  return Math.floor((Date.now() - t) / MS_DAY);
}
function clamp(n: number, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, Math.round(n))); }
function bandOf(s: number) { if (s >= 70) return "critical"; if (s >= 50) return "high"; if (s >= 30) return "medium"; return "low"; }

function scoreAudit(audits: any[], tiers: Map<string, number>, hasBounty: boolean, hasHack: boolean) {
  const drivers: Driver[] = []; let s = 30;
  if (audits.length === 0) {
    s = 75; drivers.push({ dimension: "audit", factor: "No audit on file", severity: 45 });
  } else {
    s = 0;
    const latest = audits[0];
    const days = daysSince(latest.audit_date);
    const firms = Array.from(new Set(audits.map((a) => a.audit_firm).filter(Boolean)));
    const firmTiers = firms.map((f) => tiers.get(f as string)).filter((t): t is number => !!t);
    const bestTier = firmTiers.length ? Math.min(...firmTiers) : 3;
    if (days == null) { drivers.push({ dimension: "audit", factor: "Audit date unknown", severity: 10 }); s += 10; }
    else if (days > 540) { drivers.push({ dimension: "audit", factor: `Last audit ${Math.floor(days/30)}mo ago`, severity: 40, value: days, evidence_url: latest.report_url }); s += 40; }
    else if (days > 365) { drivers.push({ dimension: "audit", factor: `Last audit ${Math.floor(days/30)}mo ago`, severity: 25, value: days, evidence_url: latest.report_url }); s += 25; }
    else if (days > 180) { drivers.push({ dimension: "audit", factor: `Last audit ${Math.floor(days/30)}mo ago`, severity: 12, value: days, evidence_url: latest.report_url }); s += 12; }
    else if (days <= 90) { drivers.push({ dimension: "audit", factor: `Recently audited (${days}d ago)`, severity: -5, value: days, evidence_url: latest.report_url, good: true }); s -= 5; }
    if (bestTier === 1) { drivers.push({ dimension: "audit", factor: `Top-tier firm (${firms.find((f) => tiers.get(f as string) === 1)})`, severity: -8, good: true }); s -= 8; }
    else if (bestTier === 2) { drivers.push({ dimension: "audit", factor: "Mid-tier firm only", severity: 8 }); s += 8; }
    else { drivers.push({ dimension: "audit", factor: "Low-tier firm only", severity: 18 }); s += 18; }
    if (firms.length >= 3) { drivers.push({ dimension: "audit", factor: `Multi-firm coverage (${firms.length} firms)`, severity: -7, good: true }); s -= 7; }
    else if (firms.length === 1 && audits.length >= 3) { drivers.push({ dimension: "audit", factor: `Single auditor for ${audits.length} engagements`, severity: 6 }); s += 6; }

    // ✅ NEW: weight actual findings counts (only counts audits where we extracted findings)
    const extracted = audits.filter((a) => a.findings_extraction_status === "extracted");
    if (extracted.length > 0) {
      const sumCrit = extracted.reduce((sum, a) => sum + (a.findings_critical || 0), 0);
      const sumHigh = extracted.reduce((sum, a) => sum + (a.findings_high || 0), 0);
      const sumMed = extracted.reduce((sum, a) => sum + (a.findings_medium || 0), 0);
      if (sumCrit > 0) {
        drivers.push({ dimension: "audit", factor: `${sumCrit} critical finding${sumCrit === 1 ? "" : "s"} on record`, severity: 18 + Math.min(12, sumCrit * 3), value: sumCrit });
        s += 18 + Math.min(12, sumCrit * 3);
      }
      if (sumHigh >= 3) {
        drivers.push({ dimension: "audit", factor: `${sumHigh} high-severity findings on record`, severity: 12, value: sumHigh });
        s += 12;
      } else if (sumHigh >= 1) {
        drivers.push({ dimension: "audit", factor: `${sumHigh} high finding${sumHigh === 1 ? "" : "s"} on record`, severity: 6, value: sumHigh });
        s += 6;
      }
      // Clean track record
      if (sumCrit === 0 && sumHigh === 0 && extracted.length >= 2 && sumMed === 0) {
        drivers.push({ dimension: "audit", factor: `Clean across ${extracted.length} audits (no critical/high/medium)`, severity: -12, good: true });
        s -= 12;
      }
      // Re-audit after findings = positive (fixes were verified)
      const reauditAfterFindings = extracted.slice(1).some((a) => (a.findings_critical || 0) + (a.findings_high || 0) > 0);
      if (reauditAfterFindings && days != null && days < 365) {
        drivers.push({ dimension: "audit", factor: "Re-audited after findings (fixes likely verified)", severity: -6, good: true });
        s -= 6;
      }
    } else if (audits.length > 0) {
      // We have audits but no findings extracted yet — acknowledge with a small "coverage gap" driver (not a penalty against the protocol)
      drivers.push({ dimension: "audit", factor: "Findings not yet extracted for these reports", severity: 0 });
    }
  }
  if (hasBounty) { drivers.push({ dimension: "audit", factor: "Active bug bounty program", severity: -8, good: true }); s -= 8; }
  else { drivers.push({ dimension: "audit", factor: "No public bug bounty", severity: 6 }); s += 6; }
  if (hasHack) { drivers.push({ dimension: "audit", factor: "Past security incident on record", severity: 20 }); s += 20; }
  return { score: clamp(s), drivers };
}

function scoreOnchain(signals: any[], anomalies: any[]) {
  const drivers: Driver[] = []; let s = 15;
  const since90 = Date.now() - 90 * MS_DAY; const since30 = Date.now() - 30 * MS_DAY;
  const recent30 = signals.filter((sg) => new Date(sg.fired_at).getTime() > since30);
  const recent90 = signals.filter((sg) => new Date(sg.fired_at).getTime() > since90);
  const upgrades30 = recent30.filter((sg) => sg.signal_type === "onchain-upgrade" || sg.signal_subtype === "upgrade");
  const pauses = signals.filter((sg) => sg.signal_type === "onchain-pause" || sg.signal_subtype === "pause");
  const multisig90 = recent90.filter((sg) => sg.signal_type === "onchain-multisig" || sg.signal_subtype === "multisig" || /signer|admin|owner/i.test(sg.title || ""));
  if (upgrades30.length >= 3) { drivers.push({ dimension: "onchain", factor: `${upgrades30.length} contract upgrades in last 30d`, severity: 20, value: upgrades30.length }); s += 20; }
  else if (upgrades30.length >= 1) { drivers.push({ dimension: "onchain", factor: `${upgrades30.length} recent contract upgrade(s)`, severity: 8, value: upgrades30.length }); s += 8; }
  if (pauses.length >= 1) { drivers.push({ dimension: "onchain", factor: `${pauses.length} pause event(s) on record`, severity: 25, value: pauses.length }); s += 25; }
  if (multisig90.length >= 2) { drivers.push({ dimension: "onchain", factor: `${multisig90.length} multisig/admin changes in 90d`, severity: 15, value: multisig90.length }); s += 15; }
  else if (multisig90.length === 1) { drivers.push({ dimension: "onchain", factor: "1 recent multisig/admin change", severity: 6 }); s += 6; }
  const recentAnoms = anomalies.filter((a) => a.date && new Date(a.date).getTime() > since30);
  for (const a of recentAnoms) {
    const z = Math.abs(a.z_score || 0);
    if (z >= 4) { drivers.push({ dimension: "onchain", factor: `Extreme tx anomaly ${a.direction === "up" ? "+" : "-"}${z.toFixed(1)}σ`, severity: 18, value: z }); s += 18; }
    else if (z >= 3) { drivers.push({ dimension: "onchain", factor: `Major tx anomaly ${a.direction === "up" ? "+" : "-"}${z.toFixed(1)}σ`, severity: 10, value: z }); s += 10; }
  }
  return { score: clamp(s), drivers };
}

function scoreActivity(metrics: any[]) {
  const drivers: Driver[] = []; let s = 30;
  if (metrics.length === 0) { drivers.push({ dimension: "activity", factor: "No TVL/activity data on file", severity: 10 }); s += 10; return { score: clamp(s), drivers }; }
  const tvlSorted = metrics.filter((m) => m.tvl).sort((a, b) => (b.date > a.date ? 1 : -1));
  if (tvlSorted.length >= 2) {
    const latest = tvlSorted[0];
    const idx30 = tvlSorted.findIndex((m) => new Date(latest.date).getTime() - new Date(m.date).getTime() >= 25 * MS_DAY);
    if (idx30 > 0) {
      const prior = tvlSorted[idx30];
      const pct = ((latest.tvl - prior.tvl) / Math.max(prior.tvl, 1)) * 100;
      if (pct < -30) { drivers.push({ dimension: "activity", factor: `TVL ${pct.toFixed(0)}% in 30d`, severity: 25, value: pct }); s += 25; }
      else if (pct < -15) { drivers.push({ dimension: "activity", factor: `TVL ${pct.toFixed(0)}% in 30d`, severity: 12, value: pct }); s += 12; }
      else if (pct > 30) { drivers.push({ dimension: "activity", factor: `TVL +${pct.toFixed(0)}% in 30d`, severity: -10, value: pct, good: true }); s -= 10; }
    }
    if (latest.tvl < 1_000_000) { drivers.push({ dimension: "activity", factor: `Very low TVL ($${(latest.tvl/1000).toFixed(0)}K)`, severity: 15, value: latest.tvl }); s += 15; }
    else if (latest.tvl > 100_000_000) { drivers.push({ dimension: "activity", factor: `Significant TVL ($${(latest.tvl/1_000_000).toFixed(0)}M)`, severity: -10, value: latest.tvl, good: true }); s -= 10; }
  }
  return { score: clamp(s), drivers };
}

function scoreTeam(h: any | null) {
  const drivers: Driver[] = []; let s = 35;
  if (!h) { drivers.push({ dimension: "team", factor: "No hiring signal on file", severity: 10 }); s += 10; return { score: clamp(s), drivers }; }
  const total = h.role_count || 0, sc = h.smart_contract_count || 0, sec = h.security_count || 0;
  if (total === 0) { drivers.push({ dimension: "team", factor: "No open roles (frozen hiring)", severity: 15 }); s += 15; }
  else if (total >= 10) { drivers.push({ dimension: "team", factor: `${total} open roles (active hiring)`, severity: -8, value: total, good: true }); s -= 8; }
  if (sc >= 3) { drivers.push({ dimension: "team", factor: `${sc} smart-contract engineering roles`, severity: -10, value: sc, good: true }); s -= 10; }
  else if (total > 0 && sc === 0) { drivers.push({ dimension: "team", factor: "Hiring but no SC engineering roles", severity: 5 }); s += 5; }
  if (sec >= 1) { drivers.push({ dimension: "team", factor: `${sec} security role(s) open`, severity: -8, value: sec, good: true }); s -= 8; }
  return { score: clamp(s), drivers };
}

function scoreFunding(funding: any[]) {
  const drivers: Driver[] = []; let s = 30;
  if (funding.length === 0) { drivers.push({ dimension: "funding", factor: "No funding rounds on file", severity: 8 }); s += 8; return { score: clamp(s), drivers }; }
  const latest = funding[0];
  const days = daysSince(latest.date);
  if (days != null) {
    if (days > 730) { drivers.push({ dimension: "funding", factor: `Last raise ${Math.floor(days/365)}yr+ ago (runway risk)`, severity: 20, value: days }); s += 20; }
    else if (days > 365) { drivers.push({ dimension: "funding", factor: `Last raise ${Math.floor(days/30)}mo ago`, severity: 8 }); s += 8; }
    else if (days <= 180) { drivers.push({ dimension: "funding", factor: `Recently funded ($${((latest.amount_usd||0)/1_000_000).toFixed(0)}M, ${days}d ago)`, severity: -10, evidence_url: latest.announcement_url, good: true }); s -= 10; }
  }
  if (latest.amount_usd && latest.amount_usd < 1_000_000 && (latest.round_type || "").toLowerCase().includes("seed")) { drivers.push({ dimension: "funding", factor: "Small seed round, limited capital", severity: 6 }); s += 6; }
  const totalRaised = funding.reduce((sum, f) => sum + (Number(f.amount_usd) || 0), 0);
  if (totalRaised > 50_000_000) { drivers.push({ dimension: "funding", factor: `$${(totalRaised/1_000_000).toFixed(0)}M total raised across rounds`, severity: -8, good: true }); s -= 8; }
  return { score: clamp(s), drivers };
}

function scoreSentiment(_news: any[], _social: any[]) {
  return { score: 30, drivers: [{ dimension: "sentiment", factor: "Sentiment data pending (background collector scheduled next)", severity: 0 }] as Driver[] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) return json(500, { error: "Missing env" });
  const cronKey = req.headers.get("x-cron-key") || "";
  const authHeader = req.headers.get("Authorization") || "";
  if (cronKey !== CRON_KEY) {
    if (!authHeader) return json(401, { error: "Unauthorized" });
    const u = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data } = await u.auth.getUser();
    if (!data?.user) return json(401, { error: "Unauthorized" });
  }
  const admin = createClient(supabaseUrl, serviceKey);
  const body = (await req.json().catch(() => ({}))) as { slugs?: string[]; fund_slug?: string; all?: boolean; limit?: number };
  let slugs: string[] = body.slugs || [];
  if (body.fund_slug) {
    const { data } = await admin.from("fund_portfolio").select("company_slug").eq("fund_slug", body.fund_slug);
    slugs = Array.from(new Set((data || []).map((r: any) => r.company_slug).filter(Boolean)));
  } else if (body.all) {
    const { data } = await admin.from("companies").select("slug").limit(body.limit || 500);
    slugs = (data || []).map((r: any) => r.slug);
  }
  if (slugs.length === 0) return json(400, { error: "Provide slugs[], fund_slug, or all:true" });

  const { data: tierRows } = await admin.from("audit_firm_tiers").select("firm_name,tier");
  const tiers = new Map<string, number>();
  for (const t of (tierRows || [])) tiers.set(t.firm_name, t.tier);

  const [companies, audits, signals, anomalies, metrics, hiring, funding, bounties] = await Promise.all([
    admin.from("companies").select("slug,name,has_bug_bounty,has_been_hacked,category").in("slug", slugs),
    admin.from("audit_history").select("company_slug,audit_firm,audit_date,report_url,protocol_name,findings_critical,findings_high,findings_medium,findings_extraction_status").in("company_slug", slugs).order("audit_date", { ascending: false }),
    admin.from("account_signals").select("company_slug,signal_type,signal_subtype,title,fired_at").in("company_slug", slugs).like("signal_type", "onchain%").order("fired_at", { ascending: false }).limit(2000),
    admin.from("metric_anomalies").select("company_slug,chain,date,direction,z_score,detail").in("company_slug", slugs).order("date", { ascending: false }).limit(1000),
    admin.from("protocol_metrics").select("company_slug,date,tvl,tx_count").in("company_slug", slugs).order("date", { ascending: false }).limit(5000),
    admin.from("hiring_sources").select("company_slug,role_count,smart_contract_count,security_count").in("company_slug", slugs),
    admin.from("funding_rounds").select("company_slug,date,amount_usd,round_type,announcement_url,all_investors").in("company_slug", slugs).order("date", { ascending: false }),
    admin.from("bug_bounties").select("protocol_slug,company_slug,max_bounty_usd,is_active").or(`protocol_slug.in.(${slugs.map((s) => `"${s}"`).join(",")}),company_slug.in.(${slugs.map((s) => `"${s}"`).join(",")})`),
  ]);

  function groupBy<T>(arr: T[] | null, key: keyof T): Map<string, T[]> {
    const m = new Map<string, T[]>();
    for (const r of arr || []) { const k = (r as any)[key] as string; if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
    return m;
  }
  const auditsBy = groupBy(audits.data, "company_slug");
  const signalsBy = groupBy(signals.data, "company_slug");
  const anomBy = groupBy(anomalies.data, "company_slug");
  const metricsBy = groupBy(metrics.data, "company_slug");
  const fundingBy = groupBy(funding.data, "company_slug");
  const hiringBy = new Map<string, any>();
  for (const h of (hiring.data || [])) hiringBy.set(h.company_slug, h);
  const bountyBy = new Set<string>();
  for (const b of (bounties.data || [])) { if (b.protocol_slug) bountyBy.add(b.protocol_slug); if (b.company_slug) bountyBy.add(b.company_slug); }
  const compBy = new Map<string, any>();
  for (const c of (companies.data || [])) compBy.set(c.slug, c);

  const W = { audit: 0.28, onchain: 0.20, activity: 0.18, team: 0.12, funding: 0.12, sentiment: 0.10 };
  const rows: any[] = [];
  for (const slug of slugs) {
    const comp = compBy.get(slug);
    if (!comp) continue;
    const hasBounty = bountyBy.has(slug) || !!comp?.has_bug_bounty;
    const hasHack = !!comp?.has_been_hacked;
    const a = scoreAudit(auditsBy.get(slug) || [], tiers, hasBounty, hasHack);
    const o = scoreOnchain(signalsBy.get(slug) || [], anomBy.get(slug) || []);
    const v = scoreActivity(metricsBy.get(slug) || []);
    const t = scoreTeam(hiringBy.get(slug) || null);
    const f = scoreFunding(fundingBy.get(slug) || []);
    const ss = scoreSentiment([], []);
    const composite = clamp(W.audit*a.score + W.onchain*o.score + W.activity*v.score + W.team*t.score + W.funding*f.score + W.sentiment*ss.score);
    const allDrivers = [...a.drivers, ...o.drivers, ...v.drivers, ...t.drivers, ...f.drivers, ...ss.drivers].sort((x, y) => Math.abs(y.severity) - Math.abs(x.severity));
    const auditsForSlug = auditsBy.get(slug) || [];
    const findingsExtracted = auditsForSlug.filter((a) => a.findings_extraction_status === "extracted");
    const coverageCount = [
      auditsForSlug.length > 0,
      (signalsBy.get(slug) || []).length > 0 || (anomBy.get(slug) || []).length > 0,
      (metricsBy.get(slug) || []).length > 0,
      hiringBy.has(slug),
      (fundingBy.get(slug) || []).length > 0,
      false,
    ].filter(Boolean).length;
    rows.push({
      company_slug: slug,
      composite_score: composite, band: bandOf(composite),
      sub_audit: a.score, sub_onchain: o.score, sub_activity: v.score, sub_team: t.score, sub_funding: f.score, sub_sentiment: ss.score,
      drivers: allDrivers,
      data_points: {
        audits_count: auditsForSlug.length,
        audits_with_findings_extracted: findingsExtracted.length,
        last_audit_date: auditsForSlug[0]?.audit_date || null,
        total_critical_findings: findingsExtracted.reduce((sum, a) => sum + (a.findings_critical || 0), 0),
        total_high_findings: findingsExtracted.reduce((sum, a) => sum + (a.findings_high || 0), 0),
        onchain_signals_30d: (signalsBy.get(slug) || []).filter((sg) => new Date(sg.fired_at).getTime() > Date.now() - 30 * MS_DAY).length,
        anomalies_30d: (anomBy.get(slug) || []).filter((a) => new Date(a.date).getTime() > Date.now() - 30 * MS_DAY).length,
        latest_tvl: (metricsBy.get(slug) || []).find((m) => m.tvl)?.tvl || null,
        open_roles: hiringBy.get(slug)?.role_count || 0,
        sc_roles: hiringBy.get(slug)?.smart_contract_count || 0,
        last_funding_date: (fundingBy.get(slug) || [])[0]?.date || null,
        has_bug_bounty: hasBounty, has_hack_history: hasHack,
      },
      coverage_pct: Math.round((coverageCount / 6) * 100),
      computed_at: new Date().toISOString(),
    });
  }
  const { error: upErr } = await admin.from("protocol_risk_scores").upsert(rows, { onConflict: "company_slug" });
  if (upErr) return json(500, { error: upErr.message });
  return json(200, {
    ok: true, scored: rows.length,
    avg_score: Math.round(rows.reduce((s, r) => s + r.composite_score, 0) / Math.max(rows.length, 1)),
    bands: {
      low: rows.filter((r) => r.band === "low").length, medium: rows.filter((r) => r.band === "medium").length,
      high: rows.filter((r) => r.band === "high").length, critical: rows.filter((r) => r.band === "critical").length,
    },
    findings_aware: rows.filter((r) => r.data_points.audits_with_findings_extracted > 0).length,
    avg_coverage: Math.round(rows.reduce((s, r) => s + r.coverage_pct, 0) / Math.max(rows.length, 1)),
  });
});
