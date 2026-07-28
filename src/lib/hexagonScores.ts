// Score computation for HexagonScore variants.
// All axes return 0-100. Higher = better for fund variant. Higher = bigger opportunity for sales variant.

type ProtocolInputs = {
  audit_count?: number | null;
  unique_auditor_count?: number | null;
  last_audit_date?: string | null;
  last_audit_firm?: string | null;
  has_bug_bounty?: boolean | null;
  max_bounty_usd?: number | null;
  bounty_platforms_count?: number | null;
  tvl_usd?: number | null;
  tvl_change_pct_30d?: number | null;
  has_been_hacked?: boolean | null;
  open_critical?: number | null;
  open_high?: number | null;
  fix_rate?: number | null; // 0-100
  multisig_count?: number | null;
  // Activity
  last_audit_ago_days?: number | null;
  recent_funding_days?: number | null;
  news_30d?: number | null;
  contract_count?: number | null;
  // Maturity
  first_audit_ago_days?: number | null;
};

const TIER1_FIRMS = new Set([
  "trail of bits", "openzeppelin", "consensys", "consensys diligence", "spearbit", "cantina",
  "zellic", "code4rena", "sherlock", "trail of bits inc", "halborn", "certora",
]);

function clamp(n: number) { return Math.max(0, Math.min(100, n)); }
function tier1Bonus(firm: string | null | undefined) {
  if (!firm) return 0;
  return TIER1_FIRMS.has(firm.trim().toLowerCase()) ? 1 : 0;
}

export function computeProtocolAxes(p: ProtocolInputs) {
  // 1. AUDIT COVERAGE — count + diversity + tier
  const audits = p.audit_count ?? 0;
  const firms = p.unique_auditor_count ?? 0;
  let audit = 0;
  if (audits >= 8) audit = 90; else if (audits >= 4) audit = 70; else if (audits >= 2) audit = 50; else if (audits === 1) audit = 30;
  if (firms >= 3) audit += 10; else if (firms >= 2) audit += 5;
  if (tier1Bonus(p.last_audit_firm)) audit += 8;
  audit = clamp(audit);

  // 2. BUG BOUNTY
  let bounty = 0;
  if (p.has_bug_bounty) {
    bounty = 50;
    const max = Number(p.max_bounty_usd) || 0;
    if (max >= 1_000_000) bounty += 35;
    else if (max >= 100_000) bounty += 20;
    else if (max >= 10_000) bounty += 10;
    if ((p.bounty_platforms_count ?? 0) >= 2) bounty += 10;
  }
  bounty = clamp(bounty);

  // 3. ACTIVITY — news cadence + audit recency + contracts mapped
  let activity = 30;
  if (p.last_audit_ago_days != null) {
    if (p.last_audit_ago_days <= 180) activity += 30;
    else if (p.last_audit_ago_days <= 365) activity += 18;
    else if (p.last_audit_ago_days <= 540) activity += 8;
  }
  if ((p.news_30d ?? 0) >= 3) activity += 15;
  else if ((p.news_30d ?? 0) >= 1) activity += 8;
  if ((p.contract_count ?? 0) >= 5) activity += 10;
  else if ((p.contract_count ?? 0) >= 1) activity += 5;
  activity = clamp(activity);

  // 4. TVL — size + trend
  let tvl = 0;
  const t = p.tvl_usd ?? 0;
  if (t >= 1_000_000_000) tvl = 90;
  else if (t >= 100_000_000) tvl = 75;
  else if (t >= 10_000_000) tvl = 55;
  else if (t >= 1_000_000) tvl = 35;
  else if (t > 0) tvl = 15;
  if (p.tvl_change_pct_30d != null) {
    if (p.tvl_change_pct_30d >= 25) tvl += 10;
    else if (p.tvl_change_pct_30d <= -25) tvl -= 15;
  }
  tvl = clamp(tvl);

  // 5. FINDINGS POSTURE — high fix rate + few open criticals
  let findings = 70; // start neutral-positive (most positions have no findings data)
  if ((p.open_critical ?? 0) > 0) findings -= 25 * Math.min(3, p.open_critical!);
  if ((p.open_high ?? 0) > 0) findings -= 8 * Math.min(5, p.open_high!);
  if (p.fix_rate != null) {
    if (p.fix_rate >= 80) findings += 20;
    else if (p.fix_rate >= 60) findings += 10;
    else if (p.fix_rate < 30) findings -= 15;
  }
  if (p.has_been_hacked) findings -= 12;
  findings = clamp(findings);

  // 6. MATURITY — depth of audit history + multisig governance + diversity
  let maturity = 0;
  if (p.first_audit_ago_days != null) {
    if (p.first_audit_ago_days >= 730) maturity += 35;
    else if (p.first_audit_ago_days >= 365) maturity += 25;
    else if (p.first_audit_ago_days >= 180) maturity += 15;
    else if (p.first_audit_ago_days > 0) maturity += 8;
  }
  if (firms >= 3) maturity += 25;
  else if (firms >= 2) maturity += 15;
  else if (firms >= 1) maturity += 8;
  if ((p.multisig_count ?? 0) >= 1) maturity += 20;
  if (audits >= 5) maturity += 15;
  maturity = clamp(maturity);

  const composite = Math.round((audit * 1.2 + bounty * 0.8 + activity * 0.8 + tvl * 1 + findings * 1.4 + maturity * 0.8) / 6);
  return {
    axes: [
      { label: "Audit cov.", value: audit, display: `${audits} audit${audits === 1 ? "" : "s"}`, sub: firms ? `${firms} firms` : null },
      { label: "Bug bounty", value: bounty, display: p.has_bug_bounty ? (p.max_bounty_usd ? `$${(p.max_bounty_usd / 1000).toFixed(0)}K+` : "active") : "none", sub: null },
      { label: "Activity", value: activity, display: p.last_audit_ago_days != null ? `audit ${Math.floor(p.last_audit_ago_days / 30)}mo ago` : "—", sub: (p.news_30d ?? 0) > 0 ? `${p.news_30d} news 30d` : null },
      { label: "TVL", value: tvl, display: t > 0 ? compactUsd(t) : "—", sub: p.tvl_change_pct_30d != null ? `${p.tvl_change_pct_30d > 0 ? "+" : ""}${p.tvl_change_pct_30d.toFixed(0)}% 30d` : null },
      { label: "Findings", value: findings, display: (p.open_critical ?? 0) > 0 ? `${p.open_critical}C open` : "clean", sub: p.fix_rate != null ? `${Math.round(p.fix_rate)}% fix rate` : null },
      { label: "Maturity", value: maturity, display: p.first_audit_ago_days ? `${Math.floor(p.first_audit_ago_days / 365)}y track record` : "—", sub: (p.multisig_count ?? 0) > 0 ? `${p.multisig_count} multisig` : null },
    ] as const,
    composite: clamp(composite),
  };
}

type SalesInputs = {
  // Funding momentum
  recent_funding_amount?: number | null;
  recent_funding_days_ago?: number | null;
  // Audit posture — the AuditScope-only differentiator
  last_audit_ago_days?: number | null;
  audit_count?: number | null;
  audit_firms_used_count?: number | null;    // firm rotation
  tier1_audit_count?: number | null;          // they buy premium
  contest_count?: number | null;              // sustained security spend (Sherlock/C4/Cantina)
  fix_rate?: number | null;                   // 0-100, low = needs better audit
  // Deal size proxy
  tvl_usd?: number | null;
  total_raised_usd?: number | null;
  // Hiring
  security_hires?: number | null;
  smart_contract_hires?: number | null;
  // Risk signals
  has_been_hacked?: boolean | null;
  recent_anomaly_z?: number | null;
  open_critical?: number | null;
  // ICP fit (caller passes 0-100)
  icp_fit_score?: number | null;
};

export function computeSalesAxes(s: SalesInputs) {
  // 1. FUNDING — recent + size
  let funding = 0;
  const amt = s.recent_funding_amount ?? 0;
  const days = s.recent_funding_days_ago ?? 999;
  if (days <= 90) funding += 60;
  else if (days <= 180) funding += 40;
  else if (days <= 365) funding += 20;
  if (amt >= 50_000_000) funding += 30;
  else if (amt >= 10_000_000) funding += 20;
  else if (amt >= 1_000_000) funding += 10;
  funding = clamp(funding);

  // 2. AUDIT POSTURE — audit gap + maturity proxies. AuditScope's superpower.
  //    Combines: when last audited, audit count, firm rotation, tier-1 coverage,
  //    contest engagement, and finding fix rate. Higher = better prospect.
  let auditPosture = 0;
  // Base: gap
  if (s.last_audit_ago_days == null) auditPosture = 70;       // never audited = ripe
  else if (s.last_audit_ago_days > 540) auditPosture = 75;
  else if (s.last_audit_ago_days > 365) auditPosture = 55;
  else if (s.last_audit_ago_days > 180) auditPosture = 30;
  else if (s.last_audit_ago_days > 90) auditPosture = 12;
  // Zero audits ever — strong "needs first audit" signal
  if ((s.audit_count ?? 0) === 0) auditPosture += 15;
  // Tier-1 firm in their history → they pay for premium → easier to up-sell to peer T1
  if ((s.tier1_audit_count ?? 0) >= 1) auditPosture += 20;
  // Contest activity (Sherlock/C4/Cantina) → security-budget customer → high-fit ICP
  if ((s.contest_count ?? 0) >= 3) auditPosture += 18;
  else if ((s.contest_count ?? 0) >= 1) auditPosture += 10;
  // Low fix rate on past audits → current firm not enforcing → opening to displace
  const fr = s.fix_rate;
  if (fr != null) {
    if (fr < 40) auditPosture += 20;
    else if (fr < 60) auditPosture += 10;
  }
  // Single-firm lock-in → harder to displace but proven buyer (slight boost)
  const firmsUsed = s.audit_firms_used_count ?? 0;
  if (firmsUsed === 1 && (s.audit_count ?? 0) >= 2) auditPosture += 8;
  auditPosture = clamp(auditPosture);

  // 3. DEAL SIZE — TVL + raised
  let deal = 0;
  const t = s.tvl_usd ?? 0;
  const r = s.total_raised_usd ?? 0;
  if (t >= 100_000_000) deal += 50;
  else if (t >= 10_000_000) deal += 35;
  else if (t >= 1_000_000) deal += 15;
  if (r >= 50_000_000) deal += 35;
  else if (r >= 10_000_000) deal += 20;
  else if (r >= 1_000_000) deal += 10;
  deal = clamp(deal);

  // 4. HIRING — security + SC engineers
  let hiring = 0;
  if ((s.security_hires ?? 0) >= 2) hiring += 60;
  else if ((s.security_hires ?? 0) >= 1) hiring += 35;
  if ((s.smart_contract_hires ?? 0) >= 5) hiring += 30;
  else if ((s.smart_contract_hires ?? 0) >= 2) hiring += 15;
  hiring = clamp(hiring);

  // 5. RISK SIGNALS — past hacks / anomalies / open criticals → wants better security
  let risk = 0;
  if (s.has_been_hacked) risk += 40;
  if ((s.open_critical ?? 0) > 0) risk += 30;
  if (s.recent_anomaly_z != null && Math.abs(s.recent_anomaly_z) >= 3) risk += 25;
  else if (s.recent_anomaly_z != null && Math.abs(s.recent_anomaly_z) >= 2) risk += 12;
  risk = clamp(risk);

  // 6. ICP FIT — caller-supplied
  const icpFit = clamp(s.icp_fit_score ?? 0);

  // Composite weights — Audit posture and ICP fit are now the most influential
  // because they're the AuditScope differentiator + the user's stated ICP.
  const composite = Math.round((funding * 1.1 + auditPosture * 1.4 + deal * 1.2 + hiring * 0.9 + risk * 0.8 + icpFit * 1.3) / 6.7);

  // Build a rich "Audit posture" display string with the strongest available signal
  const auditDisplay = (() => {
    if (s.last_audit_ago_days == null) return "no audit";
    if (s.last_audit_ago_days > 540) return `${Math.floor(s.last_audit_ago_days / 30)}mo ago`;
    return `${Math.floor(s.last_audit_ago_days / 30)}mo ago`;
  })();
  const auditSub = (() => {
    const parts: string[] = [];
    if ((s.tier1_audit_count ?? 0) >= 1) parts.push("T1");
    if ((s.contest_count ?? 0) >= 1) parts.push(`${s.contest_count}c`);
    if (fr != null) parts.push(`${Math.round(fr)}% fix`);
    if (firmsUsed > 0) parts.push(`${firmsUsed} firm${firmsUsed > 1 ? "s" : ""}`);
    return parts.join(" · ") || null;
  })();

  return {
    axes: [
      { label: "Funding", value: funding, display: amt > 0 ? `${compactUsd(amt)}` : "—", sub: days < 999 ? `${days}d ago` : null },
      { label: "Audit posture", value: auditPosture, display: auditDisplay, sub: auditSub },
      { label: "Deal size", value: deal, display: t > 0 ? compactUsd(t) : (r > 0 ? compactUsd(r) : "—"), sub: r > 0 && t > 0 ? `raised ${compactUsd(r)}` : null },
      { label: "Hiring", value: hiring, display: (s.security_hires ?? 0) > 0 ? `${s.security_hires} sec role` : ((s.smart_contract_hires ?? 0) > 0 ? `${s.smart_contract_hires} SC eng` : "—"), sub: null },
      { label: "Risk signals", value: risk, display: s.has_been_hacked ? "hacked" : ((s.open_critical ?? 0) > 0 ? `${s.open_critical} crit` : "quiet"), sub: null },
      { label: "ICP fit", value: icpFit, display: `${Math.round(icpFit)}/100`, sub: null },
    ] as const,
    composite: clamp(composite),
  };
}

function compactUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export function scoreToTone(score: number): "strong" | "solid" | "concerning" | "weak" | "critical" {
  if (score >= 80) return "strong";
  if (score >= 60) return "solid";
  if (score >= 40) return "concerning";
  if (score >= 20) return "weak";
  return "critical";
}
