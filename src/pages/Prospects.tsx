import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Target, TrendingUp, ShieldCheck, AlertTriangle, Banknote, Briefcase,
  ArrowRight, Sparkles, ExternalLink, Flame, Boxes, Bug, Skull,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { BrandLogo } from "@/components/BrandLogo";

function compactUsd(n: number | null | undefined): string {
  if (!n) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}
function daysAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400000);
  if (d < 1) return "today";
  if (d === 1) return "1d";
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}

// Heuristic opportunity score for auditor/security-vendor sales
// Inverse of risk: high risk = high opportunity, but ALSO weight in TVL (bigger = more revenue potential)
function computeOpportunity(row: any): { score: number; reasons: string[] } {
  let s = 0; const reasons: string[] = [];
  // Risk gap
  if (row.risk?.composite_score) {
    s += row.risk.composite_score * 0.5;
  }
  if (!row.audit) { s += 25; reasons.push("no audit on file"); }
  if (row.audit && row.audit.audit_date) {
    const days = Math.floor((Date.now() - new Date(row.audit.audit_date).getTime()) / 86400000);
    if (days > 540) { s += 25; reasons.push(`last audit ${Math.floor(days/30)}mo ago`); }
    else if (days > 365) { s += 15; reasons.push(`last audit ${Math.floor(days/30)}mo ago`); }
    else if (days > 180) { s += 8; reasons.push(`last audit ${Math.floor(days/30)}mo ago`); }
  }
  if (row.findings?.critical > 0) { s += 10; reasons.push(`${row.findings.critical} unresolved criticals on record`); }
  if (row.meta?.has_been_hacked) { s += 15; reasons.push("past hack = wants better security"); }
  if (row.recent_funding?.date && (Date.now() - new Date(row.recent_funding.date).getTime()) < 180 * 86400000) {
    s += 18; reasons.push(`raised ${compactUsd(row.recent_funding.amount_usd)} in last 6mo (budget unlocked)`);
  }
  if (row.tvl?.tvl) {
    if (row.tvl.tvl > 100_000_000) { s += 20; reasons.push(`$${(row.tvl.tvl/1_000_000).toFixed(0)}M TVL — high-value target`); }
    else if (row.tvl.tvl > 10_000_000) { s += 10; reasons.push(`$${(row.tvl.tvl/1_000_000).toFixed(0)}M TVL`); }
  }
  if (row.hiring?.security_count > 0) { s += 12; reasons.push(`${row.hiring.security_count} security role open (buying signal)`); }
  if (row.hiring?.smart_contract_count >= 3) { s += 8; reasons.push(`${row.hiring.smart_contract_count} SC eng open`); }
  if (row.contracts?.proxies > 2) { s += 6; reasons.push(`${row.contracts.proxies} upgradeable proxies`); }
  if (row.contracts?.total === 0 && !row.audit) { s -= 10; } // No contracts + no audit = probably not a real protocol
  if (row.meta?.has_bug_bounty) { s -= 8; reasons.push("already has bug bounty (active buyer)"); }
  return { score: Math.max(0, Math.min(100, Math.round(s))), reasons };
}

export default function Prospects() {
  const { user } = useAuth();

  // ICP filters (audit firm picks what they sell)
  const [chainFilter, setChainFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [languageFilter, setLanguageFilter] = useState<string | null>(null);
  const [minTvl, setMinTvl] = useState<number>(0);
  const [auditGapMin, setAuditGapMin] = useState<number>(0);
  const [excludeAudited, setExcludeAudited] = useState(false);
  const [hideHasBounty, setHideHasBounty] = useState(false);
  const [searchQ, setSearchQ] = useState("");

  // Profile (to filter out existing clients later)
  const profileQ = useQuery({
    queryKey: ["prospects-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("user_profiles").select("existing_client_slugs,hide_existing_clients").eq("user_id", user!.id).maybeSingle();
      return data as { existing_client_slugs: string[]; hide_existing_clients: boolean } | null;
    },
  });

  // Pull ~500 companies + their signals to score
  const universeQ = useQuery({
    queryKey: ["prospects-universe"],
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("slug,name,category,url,logo,has_been_hacked,has_bug_bounty").limit(2000);
      return (data ?? []) as Array<{ slug: string; name: string; category: string | null; url: string | null; logo: string | null; has_been_hacked: boolean; has_bug_bounty: boolean }>;
    },
  });

  const slugs = useMemo(() => (universeQ.data ?? []).map((c) => c.slug), [universeQ.data]);

  const enrichQ = useQuery({
    queryKey: ["prospects-enrich", slugs.length],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const [risk, audits, anom, tvl, funding, hiring, contracts] = await Promise.all([
        supabase.from("protocol_risk_scores").select("company_slug,composite_score,band,coverage_pct").in("company_slug", slugs),
        supabase.from("audit_history").select("company_slug,audit_firm,audit_date,findings_critical,findings_high").in("company_slug", slugs).order("audit_date", { ascending: false, nullsFirst: false }),
        supabase.from("metric_anomalies").select("company_slug,z_score,direction,date").in("company_slug", slugs).order("date", { ascending: false }).limit(500),
        supabase.from("protocol_metrics").select("company_slug,tvl,date").in("company_slug", slugs).not("tvl", "is", null).order("date", { ascending: false }).limit(2000),
        supabase.from("funding_rounds").select("company_slug,amount_usd,date,round_type").in("company_slug", slugs).order("date", { ascending: false, nullsFirst: false }).limit(2000),
        supabase.from("hiring_aggregates").select("company_slug,role_count,smart_contract_count,security_count").in("company_slug", slugs),
        supabase.from("chain_addresses").select("company_slug,chain,proxy_pattern").in("company_slug", slugs),
      ]);
      return {
        risk: (risk.data ?? []) as any[],
        audits: (audits.data ?? []) as any[],
        anom: (anom.data ?? []) as any[],
        tvl: (tvl.data ?? []) as any[],
        funding: (funding.data ?? []) as any[],
        hiring: (hiring.data ?? []) as any[],
        contracts: (contracts.data ?? []) as any[],
      };
    },
  });

  // Findings aggregated per company
  const findingsQ = useQuery({
    queryKey: ["prospects-findings", slugs.length],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("audit_history").select("company_slug,findings_critical,findings_high").in("company_slug", slugs).eq("findings_extraction_status", "extracted");
      const m = new Map<string, { critical: number; high: number }>();
      for (const r of (data ?? []) as any[]) {
        const e = m.get(r.company_slug) ?? { critical: 0, high: 0 };
        e.critical += r.findings_critical || 0;
        e.high += r.findings_high || 0;
        m.set(r.company_slug, e);
      }
      return m;
    },
  });

  // Build the prospect rows with opportunity score
  const prospects = useMemo(() => {
    if (!universeQ.data || !enrichQ.data || !findingsQ.data) return [];
    const e = enrichQ.data;
    const riskMap = new Map(e.risk.map((r: any) => [r.company_slug, r]));
    const tvlMap = new Map<string, { tvl: number; date: string }>();
    for (const m of e.tvl) if (!tvlMap.has(m.company_slug)) tvlMap.set(m.company_slug, m);
    const auditMap = new Map<string, any>();
    for (const a of e.audits) if (!auditMap.has(a.company_slug)) auditMap.set(a.company_slug, a);
    const fundingMap = new Map<string, any>();
    for (const f of e.funding) if (!fundingMap.has(f.company_slug)) fundingMap.set(f.company_slug, f);
    const hiringMap = new Map(e.hiring.map((h: any) => [h.company_slug, h]));
    const anomMap = new Map<string, any>();
    for (const a of e.anom) if (!anomMap.has(a.company_slug)) anomMap.set(a.company_slug, a);
    const contractMap = new Map<string, { total: number; proxies: number; chains: Set<string> }>();
    for (const c of e.contracts) {
      const v = contractMap.get(c.company_slug) ?? { total: 0, proxies: 0, chains: new Set<string>() };
      v.total++;
      if (c.proxy_pattern && c.proxy_pattern !== "non_proxy") v.proxies++;
      if (c.chain) v.chains.add(c.chain);
      contractMap.set(c.company_slug, v);
    }
    const excluded = new Set(profileQ.data?.hide_existing_clients ? profileQ.data.existing_client_slugs ?? [] : []);
    const rows = universeQ.data.map((c) => {
      const row = {
        slug: c.slug, name: c.name, category: c.category, meta: c,
        risk: riskMap.get(c.slug),
        audit: auditMap.get(c.slug),
        recent_funding: fundingMap.get(c.slug),
        tvl: tvlMap.get(c.slug),
        hiring: hiringMap.get(c.slug),
        anomaly: anomMap.get(c.slug),
        contracts: contractMap.get(c.slug) ? { ...contractMap.get(c.slug)!, chains: Array.from(contractMap.get(c.slug)!.chains) } : null,
        findings: findingsQ.data.get(c.slug),
      };
      const { score, reasons } = computeOpportunity(row);
      return { ...row, opportunity_score: score, opportunity_reasons: reasons };
    }).filter((r) => !excluded.has(r.slug));
    return rows;
  }, [universeQ.data, enrichQ.data, findingsQ.data, profileQ.data]);

  // Apply user-chosen ICP filters
  const filtered = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return prospects.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (categoryFilter && p.category !== categoryFilter) return false;
      if (chainFilter && !(p.contracts?.chains || []).includes(chainFilter)) return false;
      if (minTvl > 0 && (!p.tvl || p.tvl.tvl < minTvl)) return false;
      if (excludeAudited && p.audit?.audit_date) {
        const daysSince = Math.floor((Date.now() - new Date(p.audit.audit_date).getTime()) / 86400000);
        if (daysSince < auditGapMin) return false;
      }
      if (auditGapMin > 0 && (!p.audit?.audit_date)) {
        // no audit on file == treat as max gap, keep
      } else if (auditGapMin > 0 && p.audit?.audit_date) {
        const daysSince = Math.floor((Date.now() - new Date(p.audit.audit_date).getTime()) / 86400000);
        if (daysSince < auditGapMin * 30) return false;
      }
      if (hideHasBounty && p.meta.has_bug_bounty) return false;
      return p.opportunity_score >= 25;
    }).sort((a, b) => b.opportunity_score - a.opportunity_score);
  }, [prospects, searchQ, categoryFilter, chainFilter, minTvl, excludeAudited, auditGapMin, hideHasBounty]);

  const categories = useMemo(() => Array.from(new Set(prospects.map((p) => p.category).filter(Boolean) as string[])).sort(), [prospects]);
  const chains = useMemo(() => {
    const s = new Set<string>();
    for (const p of prospects) for (const c of (p.contracts?.chains ?? [])) s.add(c);
    return Array.from(s).sort();
  }, [prospects]);

  // Stats
  const hot = filtered.filter((p) => p.opportunity_score >= 60).length;
  const warm = filtered.filter((p) => p.opportunity_score >= 40 && p.opportunity_score < 60).length;

  return (
    <div className="space-y-5 max-w-[1600px]">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight">Prospects</h1>
            <p className="text-[11px] text-muted-foreground mt-1">
              Contact the HOT list this week. Opportunity = audit gap × TVL × hiring × past risk.
            </p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Total prospects" value={filtered.length.toString()} hint={`${prospects.length} in universe`} />
        <Tile label="🔥 Hot (60+)" value={hot.toString()} hint="contact this week" tone="alert" />
        <Tile label="Warm (40-59)" value={warm.toString()} hint="add to pipeline" tone="warn" />
        <Tile label="Tier 1 firm gap" value={filtered.filter((p) => !p.audit).length.toString()} hint="never audited" />
      </div>

      {/* ICP filter bar */}
      <div className="as-card p-4 space-y-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Filter by ICP</div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
          <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Search…" className="as-input text-xs" />
          <select value={categoryFilter ?? ""} onChange={(e) => setCategoryFilter(e.target.value || null)} className="as-input text-xs">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={chainFilter ?? ""} onChange={(e) => setChainFilter(e.target.value || null)} className="as-input text-xs">
            <option value="">All chains</option>
            {chains.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={minTvl} onChange={(e) => setMinTvl(Number(e.target.value))} className="as-input text-xs">
            <option value="0">Any TVL</option>
            <option value="1000000">$1M+</option>
            <option value="10000000">$10M+</option>
            <option value="50000000">$50M+</option>
            <option value="100000000">$100M+</option>
          </select>
          <select value={auditGapMin} onChange={(e) => setAuditGapMin(Number(e.target.value))} className="as-input text-xs">
            <option value="0">Any audit recency</option>
            <option value="6">6+ months stale</option>
            <option value="12">12+ months stale</option>
            <option value="18">18+ months stale</option>
          </select>
          <label className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <input type="checkbox" checked={hideHasBounty} onChange={(e) => setHideHasBounty(e.target.checked)} className="accent-primary" />
            Hide already-bounty
          </label>
        </div>
      </div>

      {/* Prospect list */}
      <div className="as-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Prospects sorted by opportunity</h3>
          <span className="text-xs text-muted-foreground">{filtered.length} matching</span>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {filtered.slice(0, 80).map((p) => (
            <Link key={p.slug} to={`/protocol/${p.slug}`} className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02]">
              <OpportunityBadge score={p.opportunity_score} />
              <BrandLogo name={p.name} url={p.meta?.url} logo={p.meta?.logo} className="w-8 h-8 rounded-md shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-white truncate">{p.name}</span>
                  {p.category && <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-white/[0.04] px-1.5 py-0.5 rounded">{p.category}</span>}
                  {p.tvl && <span className="text-[10px] text-emerald-300/80 bg-emerald-500/[0.06] px-1.5 py-0.5 rounded inline-flex items-center gap-1"><TrendingUp className="w-2.5 h-2.5" /> TVL {compactUsd(p.tvl.tvl)}</span>}
                  {p.meta.has_bug_bounty && <span className="text-[10px] text-emerald-300 bg-emerald-500/[0.06] px-1.5 py-0.5 rounded inline-flex items-center gap-1"><Bug className="w-2.5 h-2.5" /> bounty</span>}
                  {p.meta.has_been_hacked && <span className="text-[10px] text-rose-300 bg-rose-500/[0.08] px-1.5 py-0.5 rounded inline-flex items-center gap-1"><Skull className="w-2.5 h-2.5" /> hacked</span>}
                </div>
                <div className="text-[11px] text-amber-300/90 mt-0.5">{p.opportunity_reasons.slice(0, 4).join(" · ")}</div>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
            </Link>
          ))}
          {filtered.length > 80 && (
            <div className="px-4 py-3 text-xs text-muted-foreground text-center">
              Showing 80 of {filtered.length}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OpportunityBadge({ score }: { score: number }) {
  const tone = score >= 60 ? { bg: "bg-rose-500/15", txt: "text-rose-200", border: "border-rose-500/40", label: "HOT" }
    : score >= 40 ? { bg: "bg-amber-500/15", txt: "text-amber-200", border: "border-amber-500/40", label: "WARM" }
    : { bg: "bg-white/[0.04]", txt: "text-muted-foreground", border: "border-white/[0.06]", label: "" };
  return (
    <div className={`w-12 h-12 rounded-md border ${tone.bg} ${tone.txt} ${tone.border} flex flex-col items-center justify-center shrink-0`}>
      <span className="text-base font-bold tabular-nums leading-none">{score}</span>
      <span className="text-[8px] uppercase tracking-wider opacity-80 mt-0.5">{tone.label || "—"}</span>
    </div>
  );
}

function Tile({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint?: string; tone?: "neutral" | "warn" | "alert" }) {
  const cls = ({
    neutral: "border-white/[0.06] bg-white/[0.02] text-white",
    warn: "border-amber-500/30 bg-amber-500/[0.05] text-amber-200",
    alert: "border-rose-500/30 bg-rose-500/[0.06] text-rose-200",
  } as Record<string, string>)[tone];
  return (
    <div className={`rounded-lg border px-3 py-3 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-xl font-semibold tabular-nums mt-1">{value}</div>
      {hint && <div className="text-[11px] opacity-70 mt-0.5">{hint}</div>}
    </div>
  );
}
