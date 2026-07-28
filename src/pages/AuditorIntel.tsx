import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Trophy, Target, BarChart3, Clock, TrendingUp, TrendingDown,
  ArrowRight, Download, Crown, Award, AlertTriangle, ShieldCheck, Layers,
  Banknote, Skull, Briefcase, Flame, Search,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";

function compactUsd(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n === 0) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function daysAgo(d: string | null | undefined): string {
  if (!d) return "—";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

type FirmStat = {
  firm: string;
  total_audits: number;
  unique_clients: number;
  audits_last_90d: number;
  audits_last_365d: number;
  audits_prev_365d: number;
  growth_pct: number | null;
  latest_audit: string | null;
  median_findings_critical: number;
  critical_rate_pct: number; // % of audits with at least 1 critical
  categories: Record<string, number>;
  top_clients: Array<{ slug: string; name: string }>;
};

type CompanyExposure = {
  slug: string;
  name: string;
  category: string | null;
  url: string | null;
  logo: string | null;
  tvl: number | null;
  last_audit_date: string | null;
  last_audit_firm: string | null;
  days_since_audit: number | null;
  exposure_score: number; // TVL log * days/30
};

export default function AuditorIntel() {
  const [tab, setTab] = useState<"hunting" | "leaderboard" | "gaps" | "firms" | "sectors" | "trends">("hunting");
  const [sortBy, setSortBy] = useState<"audits" | "clients" | "growth" | "recent">("audits");
  const [huntFilter, setHuntFilter] = useState<"all" | "recent_fund" | "gap" | "hacked" | "hiring" | "single_auditor">("all");
  const [huntCategory, setHuntCategory] = useState<string | null>(null);
  const [huntMinTvl, setHuntMinTvl] = useState(0);

  // Pull all audit history pages for aggregation
  const auditsQ = useQuery({
    queryKey: ["ai-audits-all"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      let all: any[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data } = await supabase
          .from("audit_history")
          .select("audit_firm,audit_date,company_slug,smart_contract_language,findings_critical,findings_high,findings_extraction_status")
          .not("audit_firm", "is", null)
          .range(from, from + PAGE - 1);
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
        from += PAGE;
        if (all.length > 30000) break;
      }
      return all;
    },
  });

  const companiesQ = useQuery({
    queryKey: ["ai-companies"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("companies")
        .select("slug,name,category,url,logo,last_audit_date,last_audit_firm")
        .order("name");
      return (data ?? []) as any[];
    },
  });

  // Has-contracts signal — protocols that actually have smart contracts deployed
  // (otherwise we'd recommend audits to CEXs / pure off-chain tools / wallets)
  const hasContractsQ = useQuery({
    queryKey: ["ai-has-contracts"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const set = new Set<string>();
      // 1. Anyone with mapped chain_addresses
      const { data: addr } = await supabase.from("chain_addresses").select("company_slug").limit(10000);
      for (const r of (addr ?? []) as any[]) if (r.company_slug) set.add(r.company_slug);
      // 2. Anyone with any audit_history (audited = has contracts)
      const { data: aud } = await supabase.from("audit_history").select("company_slug").not("audit_firm", "is", null);
      for (const r of (aud ?? []) as any[]) if (r.company_slug) set.add(r.company_slug);
      return set;
    },
  });

  // Hunting signals — recent funding rounds (last 90d)
  const recentFundingQ = useQuery({
    queryKey: ["ai-recent-funding"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("funding_rounds")
        .select("company_slug,amount_usd,round_type,date,all_investors")
        .gte("date", cutoff)
        .order("date", { ascending: false })
        .limit(2000);
      const m = new Map<string, { amount_usd: number | null; round_type: string | null; date: string }>();
      for (const r of (data ?? []) as any[]) {
        if (!m.has(r.company_slug)) m.set(r.company_slug, { amount_usd: Number(r.amount_usd) || null, round_type: r.round_type, date: r.date });
      }
      return m;
    },
  });

  // Recent hacks (last 90d)
  const recentHacksQ = useQuery({
    queryKey: ["ai-recent-hacks"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("hacks")
        .select("company_slug,hack_date,amount_usd,technique")
        .gte("hack_date", cutoff)
        .order("hack_date", { ascending: false });
      const m = new Map<string, { hack_date: string; amount_usd: number; technique: string | null }>();
      for (const r of (data ?? []) as any[]) {
        if (!m.has(r.company_slug)) m.set(r.company_slug, { hack_date: r.hack_date, amount_usd: Number(r.amount_usd), technique: r.technique });
      }
      return m;
    },
  });

  // Hiring signals (SC engineers + security)
  const hiringQ = useQuery({
    queryKey: ["ai-hiring"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("hiring_sources")
        .select("company_slug,role_count,smart_contract_count,security_count")
        .order("smart_contract_count", { ascending: false, nullsFirst: false })
        .limit(1500);
      const m = new Map<string, { role_count: number; sc: number; sec: number }>();
      for (const r of (data ?? []) as any[]) {
        m.set(r.company_slug, { role_count: r.role_count || 0, sc: r.smart_contract_count || 0, sec: r.security_count || 0 });
      }
      return m;
    },
  });

  const tvlQ = useQuery({
    queryKey: ["ai-tvl"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("protocol_metrics")
        .select("company_slug,tvl,date")
        .not("tvl", "is", null)
        .order("date", { ascending: false })
        .limit(5000);
      const m = new Map<string, number>();
      for (const r of (data ?? []) as any[]) {
        if (!m.has(r.company_slug)) m.set(r.company_slug, Number(r.tvl));
      }
      return m;
    },
  });

  // Aggregate firm stats
  const firmStats: FirmStat[] = useMemo(() => {
    if (!auditsQ.data || !companiesQ.data) return [];

    const compMap = new Map<string, any>();
    for (const c of companiesQ.data) compMap.set(c.slug, c);

    const byFirm = new Map<string, {
      total: number;
      clients: Set<string>;
      audits90: number;
      audits365: number;
      auditsPrev365: number;
      latest: string | null;
      cats: Map<string, number>;
      criticals: number[];
      withCriticalCount: number;
      extractedCount: number;
      topClients: Map<string, { slug: string; name: string; count: number }>;
    }>();

    const now = Date.now();
    const D90 = 90 * 86400000;
    const D365 = 365 * 86400000;
    const D730 = 730 * 86400000;

    for (const a of auditsQ.data) {
      const firm = (a.audit_firm || "").trim();
      if (!firm) continue;
      const entry = byFirm.get(firm) ?? {
        total: 0, clients: new Set(), audits90: 0, audits365: 0, auditsPrev365: 0,
        latest: null, cats: new Map(), criticals: [], withCriticalCount: 0, extractedCount: 0,
        topClients: new Map(),
      };
      entry.total++;
      if (a.company_slug) {
        entry.clients.add(a.company_slug);
        const co = compMap.get(a.company_slug);
        if (co) {
          const tc = entry.topClients.get(a.company_slug) ?? { slug: a.company_slug, name: co.name, count: 0 };
          tc.count++;
          entry.topClients.set(a.company_slug, tc);
          if (co.category) entry.cats.set(co.category, (entry.cats.get(co.category) ?? 0) + 1);
        }
      }
      if (a.audit_date) {
        const aTime = new Date(a.audit_date).getTime();
        if (now - aTime <= D90) entry.audits90++;
        if (now - aTime <= D365) entry.audits365++;
        else if (now - aTime <= D730) entry.auditsPrev365++;
        if (!entry.latest || a.audit_date > entry.latest) entry.latest = a.audit_date;
      }
      if (a.findings_extraction_status === "extracted") {
        entry.extractedCount++;
        const crit = a.findings_critical || 0;
        entry.criticals.push(crit);
        if (crit > 0) entry.withCriticalCount++;
      }
      byFirm.set(firm, entry);
    }

    const rows: FirmStat[] = [];
    for (const [firm, e] of byFirm) {
      const sorted = e.criticals.slice().sort((a, b) => a - b);
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
      const growth = e.auditsPrev365 > 0
        ? ((e.audits365 - e.auditsPrev365) / e.auditsPrev365) * 100
        : (e.audits365 > 0 ? 100 : null);
      const cats: Record<string, number> = {};
      for (const [k, v] of e.cats) cats[k] = v;
      const topClients = Array.from(e.topClients.values()).sort((a, b) => b.count - a.count).slice(0, 5);
      rows.push({
        firm,
        total_audits: e.total,
        unique_clients: e.clients.size,
        audits_last_90d: e.audits90,
        audits_last_365d: e.audits365,
        audits_prev_365d: e.auditsPrev365,
        growth_pct: growth,
        latest_audit: e.latest,
        median_findings_critical: median,
        critical_rate_pct: e.extractedCount > 0 ? (e.withCriticalCount / e.extractedCount) * 100 : 0,
        categories: cats,
        top_clients: topClients.map((c) => ({ slug: c.slug, name: c.name })),
      });
    }
    return rows;
  }, [auditsQ.data, companiesQ.data]);

  const sortedFirms = useMemo(() => {
    const list = firmStats.slice();
    list.sort((a, b) => {
      switch (sortBy) {
        case "audits": return b.total_audits - a.total_audits;
        case "clients": return b.unique_clients - a.unique_clients;
        case "growth": return (b.growth_pct ?? -999) - (a.growth_pct ?? -999);
        case "recent": return (b.audits_last_90d - a.audits_last_90d);
      }
    });
    return list;
  }, [firmStats, sortBy]);

  // Coverage gap leaderboard: protocols with TVL × stale audit
  // HUNTING OPPORTUNITIES — composite signal-driven leads
  type Opp = {
    slug: string; name: string; category: string | null; url: string | null; logo: string | null;
    tvl: number | null; days_since_audit: number | null; last_audit_firm: string | null; audit_count: number;
    unique_firms: number; has_hacked: boolean;
    signals: Array<{ kind: "recent_fund" | "gap" | "hacked" | "hiring" | "single_auditor" | "high_tvl_no_audit"; label: string; weight: number }>;
    score: number;
    why_now: string;
  };
  const opportunities: Opp[] = useMemo(() => {
    if (!companiesQ.data) return [];
    const firmsPerProtocol = new Map<string, Set<string>>();
    for (const a of auditsQ.data ?? []) {
      const f = (a.audit_firm || "").trim();
      if (!f || !a.company_slug) continue;
      if (!firmsPerProtocol.has(a.company_slug)) firmsPerProtocol.set(a.company_slug, new Set());
      firmsPerProtocol.get(a.company_slug)!.add(f);
    }

    const hasContracts = hasContractsQ.data;
    const opps: Opp[] = [];
    for (const c of companiesQ.data) {
      // Skip companies that don't have smart contracts (CEXs, off-chain tools, wallets, custodians)
      // Signal: must have either chain_addresses mapped OR prior audit history (proven contract presence)
      if (hasContracts && !hasContracts.has(c.slug)) continue;
      const tvl = tvlQ.data?.get(c.slug) ?? null;
      const daysSinceAudit = c.last_audit_date
        ? Math.floor((Date.now() - new Date(c.last_audit_date).getTime()) / 86400000)
        : null;
      const signals: Opp["signals"] = [];
      let score = 0;

      // Signal 1: Recent funding (90d) — they have audit budget
      const fund = recentFundingQ.data?.get(c.slug);
      if (fund) {
        const amt = fund.amount_usd || 0;
        const daysAgoFund = Math.floor((Date.now() - new Date(fund.date).getTime()) / 86400000);
        const w = Math.min(40, 10 + Math.log10(Math.max(amt, 1_000_000)) * 4);
        signals.push({
          kind: "recent_fund",
          label: `Raised ${compactUsd(amt)} ${fund.round_type || ""} ${daysAgoFund}d ago`,
          weight: w,
        });
        score += w;
      }

      // Signal 2: Recent hack (90d) — emergency audit candidate
      const hack = recentHacksQ.data?.get(c.slug);
      if (hack) {
        const daysHack = Math.floor((Date.now() - new Date(hack.hack_date).getTime()) / 86400000);
        const w = Math.min(50, 25 + Math.log10(Math.max(hack.amount_usd, 1000)) * 2);
        signals.push({
          kind: "hacked",
          label: `Hacked ${daysHack}d ago for ${compactUsd(hack.amount_usd)}${hack.technique ? " (" + hack.technique + ")" : ""}`,
          weight: w,
        });
        score += w;
      }

      // Signal 3: Audit gap on TVL'd protocol
      if (tvl && tvl >= 1_000_000) {
        if (!c.last_audit_date) {
          const w = Math.min(35, Math.log10(tvl) * 5);
          signals.push({ kind: "high_tvl_no_audit", label: `${compactUsd(tvl)} TVL · no audit on file`, weight: w });
          score += w;
        } else if (daysSinceAudit != null && daysSinceAudit > 365) {
          const w = Math.min(30, (daysSinceAudit / 30) + Math.log10(tvl) * 3);
          signals.push({
            kind: "gap",
            label: `${Math.floor(daysSinceAudit / 30)}mo since last audit · ${compactUsd(tvl)} TVL`,
            weight: w,
          });
          score += w;
        }
      }

      // Signal 4: Hiring SC engineers — expansion mode
      const hiring = hiringQ.data?.get(c.slug);
      if (hiring && hiring.sc >= 1) {
        const w = Math.min(20, hiring.sc * 4);
        signals.push({
          kind: "hiring",
          label: `Hiring ${hiring.sc} SC engineer${hiring.sc > 1 ? "s" : ""}${hiring.sec > 0 ? " + " + hiring.sec + " sec" : ""}`,
          weight: w,
        });
        score += w;
      }

      // Signal 5: Single-auditor protocol with TVL — second-opinion opportunity
      const firms = firmsPerProtocol.get(c.slug);
      if (firms && firms.size === 1 && tvl && tvl >= 5_000_000) {
        const w = 12;
        signals.push({
          kind: "single_auditor",
          label: `Only audited by ${Array.from(firms)[0]} · second-opinion opportunity`,
          weight: w,
        });
        score += w;
      }

      if (signals.length === 0) continue;

      // Compose why-now
      const topSignals = signals.slice().sort((a, b) => b.weight - a.weight).slice(0, 2);
      const why_now = topSignals.map(s => s.label).join(" · ");

      opps.push({
        slug: c.slug, name: c.name, category: c.category, url: c.url, logo: c.logo,
        tvl, days_since_audit: daysSinceAudit, last_audit_firm: c.last_audit_firm,
        audit_count: c.audit_count || 0,
        unique_firms: firms?.size || 0,
        has_hacked: !!c.has_been_hacked,
        signals, score, why_now,
      });
    }
    return opps.sort((a, b) => b.score - a.score).slice(0, 200);
  }, [companiesQ.data, tvlQ.data, recentFundingQ.data, recentHacksQ.data, hiringQ.data, auditsQ.data, hasContractsQ.data]);

  const huntCategories = useMemo(() => Array.from(new Set(opportunities.map(o => o.category).filter(Boolean) as string[])).sort(), [opportunities]);

  const filteredOpps = useMemo(() => {
    return opportunities.filter(o => {
      if (huntCategory && o.category !== huntCategory) return false;
      if (huntMinTvl > 0 && (!o.tvl || o.tvl < huntMinTvl)) return false;
      if (huntFilter !== "all" && !o.signals.some(s => s.kind === huntFilter)) return false;
      return true;
    });
  }, [opportunities, huntFilter, huntCategory, huntMinTvl]);

  const gapList: CompanyExposure[] = useMemo(() => {
    if (!companiesQ.data) return [];
    const rows: CompanyExposure[] = [];
    for (const c of companiesQ.data) {
      const tvl = tvlQ.data?.get(c.slug) ?? null;
      if (!tvl || tvl < 1_000_000) continue;
      const days = c.last_audit_date
        ? Math.floor((Date.now() - new Date(c.last_audit_date).getTime()) / 86400000)
        : 9999;
      // Gap score: TVL log * days since audit
      const tvlLog = Math.log10(tvl + 1);
      const score = tvlLog * Math.min(days, 1825); // cap at 5y
      rows.push({
        slug: c.slug, name: c.name, category: c.category,
        url: c.url, logo: c.logo, tvl,
        last_audit_date: c.last_audit_date,
        last_audit_firm: c.last_audit_firm,
        days_since_audit: c.last_audit_date ? days : null,
        exposure_score: score,
      });
    }
    return rows.sort((a, b) => b.exposure_score - a.exposure_score).slice(0, 200);
  }, [companiesQ.data, tvlQ.data]);

  // Sector market share
  const sectorMatrix = useMemo(() => {
    const sectors = new Map<string, Map<string, number>>(); // category -> firm -> count
    for (const f of firmStats) {
      for (const [cat, count] of Object.entries(f.categories)) {
        if (!sectors.has(cat)) sectors.set(cat, new Map());
        sectors.get(cat)!.set(f.firm, count);
      }
    }
    const result: Array<{ category: string; total: number; top: Array<{ firm: string; count: number; share_pct: number }> }> = [];
    for (const [cat, firmMap] of sectors) {
      const list = Array.from(firmMap.entries()).map(([firm, count]) => ({ firm, count }));
      const total = list.reduce((s, x) => s + x.count, 0);
      const top = list.sort((a, b) => b.count - a.count).slice(0, 6).map(x => ({ ...x, share_pct: (x.count / total) * 100 }));
      result.push({ category: cat, total, top });
    }
    return result.sort((a, b) => b.total - a.total).slice(0, 12);
  }, [firmStats]);

  // Trends: total audits by quarter (last 8 quarters)
  const quarterlyTrend = useMemo(() => {
    if (!auditsQ.data) return [];
    const byQ = new Map<string, number>();
    for (const a of auditsQ.data) {
      if (!a.audit_date) continue;
      const d = new Date(a.audit_date);
      const q = `${d.getFullYear()}Q${Math.floor(d.getMonth() / 3) + 1}`;
      byQ.set(q, (byQ.get(q) ?? 0) + 1);
    }
    const sorted = Array.from(byQ.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.slice(-8);
  }, [auditsQ.data]);

  const headlineStats = useMemo(() => {
    const totalAudits = firmStats.reduce((s, f) => s + f.total_audits, 0);
    const totalFirms = firmStats.length;
    const totalClients = new Set<string>();
    for (const f of firmStats) for (const c of f.top_clients) totalClients.add(c.slug);
    const totalLast90 = firmStats.reduce((s, f) => s + f.audits_last_90d, 0);
    return { totalAudits, totalFirms, totalClients: totalClients.size, totalLast90 };
  }, [firmStats]);

  const exportLeaderboardCsv = () => {
    const header = ["firm", "total_audits", "unique_clients", "audits_last_90d", "audits_last_365d", "growth_pct_yoy", "latest_audit", "critical_rate_pct"];
    const rows = sortedFirms.map((f) => [
      f.firm, f.total_audits, f.unique_clients, f.audits_last_90d, f.audits_last_365d,
      f.growth_pct?.toFixed(1) ?? "", f.latest_audit ?? "", f.critical_rate_pct.toFixed(1),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auditor-leaderboard-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5 max-w-[1700px]">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight">Sales Floor</h1>
            <p className="text-[11px] text-muted-foreground mt-1">
              Hunting: protocols with budget, gaps, or incidents — ranked. Plus market intel, firm leaderboard, sector dominance.
            </p>
          </div>
        </div>
        <button onClick={exportLeaderboardCsv} className="text-xs text-muted-foreground hover:text-white inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-white/[0.08] hover:bg-white/[0.03]">
          <Download className="w-3 h-3" /> CSV
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Audit firms tracked" value={headlineStats.totalFirms.toString()} hint="across the market" tone="neutral" />
        <Tile label="Total audits indexed" value={headlineStats.totalAudits.toLocaleString()} hint="all-time" tone="neutral" />
        <Tile label="Audits last 90d" value={headlineStats.totalLast90.toLocaleString()} hint="market pace" tone="neutral" />
        <Tile label="Coverage gaps" value={gapList.length.toString()} hint="$1M+ TVL with stale audit" tone={gapList.length > 50 ? "warn" : "good"} />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-white/[0.06] -mb-2">
        <TabBtn active={tab === "hunting"} onClick={() => setTab("hunting")}><Flame className="w-3.5 h-3.5" /> Hunting</TabBtn>
        <TabBtn active={tab === "leaderboard"} onClick={() => setTab("leaderboard")}><Crown className="w-3.5 h-3.5" /> Leaderboard</TabBtn>
        <TabBtn active={tab === "firms"} onClick={() => setTab("firms")}><ShieldCheck className="w-3.5 h-3.5" /> Firms grid</TabBtn>
        <TabBtn active={tab === "gaps"} onClick={() => setTab("gaps")}><AlertTriangle className="w-3.5 h-3.5" /> Coverage gaps</TabBtn>
        <TabBtn active={tab === "sectors"} onClick={() => setTab("sectors")}><Layers className="w-3.5 h-3.5" /> Sector dominance</TabBtn>
        <TabBtn active={tab === "trends"} onClick={() => setTab("trends")}><BarChart3 className="w-3.5 h-3.5" /> Market trends</TabBtn>
      </div>

      {/* LEADERBOARD */}
      {/* HUNTING — composite leads with why-now reasoning */}
      {tab === "hunting" && (
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="as-card p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">Signal:</span>
              {([
                { k: "all", label: "All signals" },
                { k: "recent_fund", label: "Recently funded" },
                { k: "hacked", label: "Recently hacked" },
                { k: "gap", label: "Audit gap" },
                { k: "hiring", label: "Hiring SC eng" },
                { k: "single_auditor", label: "Single auditor" },
              ] as const).map((f) => (
                <button
                  key={f.k}
                  type="button"
                  onClick={() => setHuntFilter(f.k as any)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border ${huntFilter === f.k ? "border-primary/50 bg-primary/15 text-primary" : "border-white/[0.08] text-muted-foreground hover:text-white"}`}
                >
                  {f.label}
                </button>
              ))}
              <div className="w-px h-4 bg-white/[0.08]" />
              <select value={huntCategory ?? ""} onChange={(e) => setHuntCategory(e.target.value || null)} className="as-input text-xs">
                <option value="">All categories</option>
                {huntCategories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={huntMinTvl} onChange={(e) => setHuntMinTvl(Number(e.target.value))} className="as-input text-xs">
                <option value="0">Any TVL</option>
                <option value="1000000">$1M+</option>
                <option value="10000000">$10M+</option>
                <option value="100000000">$100M+</option>
              </select>
              <span className="text-[11px] text-muted-foreground ml-auto">{filteredOpps.length} opportunities</span>
            </div>
          </div>

          {/* Opp cards */}
          {filteredOpps.length === 0 ? (
            <div className="as-card p-8 text-center text-xs text-muted-foreground">
              No opportunities match these filters. Try widening the signal or category.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredOpps.slice(0, 60).map((o, idx) => (
                <Link
                  key={o.slug}
                  to={`/protocol/${o.slug}`}
                  className="as-card p-4 hover:border-primary/40 transition-colors group"
                >
                  <div className="flex items-start gap-3">
                    <div className={`shrink-0 w-7 h-7 rounded-full border flex items-center justify-center text-[11px] font-bold tabular-nums ${
                      idx < 5 ? "border-rose-500/50 bg-rose-500/10 text-rose-200" :
                      idx < 15 ? "border-amber-500/40 bg-amber-500/10 text-amber-200" :
                      "border-white/[0.1] bg-white/[0.04] text-muted-foreground"
                    }`}>{idx + 1}</div>
                    <BrandLogo name={o.name} url={o.url} logo={o.logo} className="w-10 h-10 rounded-md shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white truncate group-hover:text-primary">{o.name}</span>
                        {o.category && <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-white/[0.04] px-1.5 py-0.5 rounded">{o.category}</span>}
                        {o.has_hacked && <Skull className="w-3 h-3 text-rose-400" title="Past hack" />}
                      </div>
                      <div className="text-[12.5px] text-white/85 mt-1.5 leading-snug">{o.why_now}</div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {o.signals.map((s, i) => (
                          <span key={i} className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${
                            s.kind === "hacked" ? "border-rose-500/30 bg-rose-500/[0.06] text-rose-200" :
                            s.kind === "recent_fund" ? "border-sky-500/30 bg-sky-500/[0.06] text-sky-200" :
                            s.kind === "hiring" ? "border-indigo-500/30 bg-indigo-500/[0.06] text-indigo-200" :
                            s.kind === "single_auditor" ? "border-amber-500/30 bg-amber-500/[0.06] text-amber-200" :
                            s.kind === "high_tvl_no_audit" ? "border-rose-400/30 bg-rose-500/[0.05] text-rose-200" :
                            "border-orange-500/30 bg-orange-500/[0.06] text-orange-200"
                          }`}>
                            {s.kind === "hacked" && <Skull className="w-2.5 h-2.5" />}
                            {s.kind === "recent_fund" && <Banknote className="w-2.5 h-2.5" />}
                            {s.kind === "hiring" && <Briefcase className="w-2.5 h-2.5" />}
                            {s.kind === "single_auditor" && <ShieldCheck className="w-2.5 h-2.5" />}
                            {(s.kind === "gap" || s.kind === "high_tvl_no_audit") && <Clock className="w-2.5 h-2.5" />}
                            {s.kind.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                      <div className="text-[10.5px] text-muted-foreground mt-2 flex items-center gap-3 flex-wrap">
                        {o.tvl != null && <span>TVL {compactUsd(o.tvl)}</span>}
                        {o.audit_count > 0 ? (
                          <span>{o.audit_count} audit{o.audit_count === 1 ? "" : "s"}{o.unique_firms > 1 ? ` / ${o.unique_firms} firms` : ""}</span>
                        ) : <span className="text-rose-300">no audits</span>}
                        {o.last_audit_firm && <span>last: {o.last_audit_firm}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-base font-bold tabular-nums text-white">{Math.round(o.score)}</div>
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">score</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "leaderboard" && (
        <div className="as-card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-3">
            <h3 className="text-sm font-semibold text-white">Firm leaderboard</h3>
            <div className="flex-1" />
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="as-input text-xs">
              <option value="audits">Sort: total audits</option>
              <option value="clients">Sort: unique clients</option>
              <option value="growth">Sort: YoY growth</option>
              <option value="recent">Sort: 90d momentum</option>
            </select>
          </div>
          <div className="overflow-x-auto max-h-[700px]">
            <table className="w-full text-xs">
              <thead className="bg-white/[0.02] border-b border-white/[0.04] sticky top-0 z-10">
                <tr className="text-left text-[10px] uppercase tracking-[0.08em] font-medium text-muted-foreground">
                  <th className="px-3 py-2.5 w-8">#</th>
                  <th className="px-3 py-2.5">Firm</th>
                  <th className="px-2 py-2.5 text-right">Total</th>
                  <th className="px-2 py-2.5 text-right">Clients</th>
                  <th className="px-2 py-2.5 text-right">L90d</th>
                  <th className="px-2 py-2.5 text-right">L365d</th>
                  <th className="px-2 py-2.5 text-right">YoY</th>
                  <th className="px-2 py-2.5 text-right">Crit rate</th>
                  <th className="px-2 py-2.5">Top sectors</th>
                  <th className="px-2 py-2.5">Top clients</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {sortedFirms.slice(0, 100).map((f, i) => (
                  <tr key={f.firm} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-2 text-[10px] text-muted-foreground tabular-nums">
                      {i === 0 && <Crown className="w-3 h-3 text-yellow-300 inline" />}
                      {i === 1 && <Award className="w-3 h-3 text-zinc-300 inline" />}
                      {i === 2 && <Award className="w-3 h-3 text-amber-700 inline" />}
                      {i > 2 && (i + 1)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <BrandLogo name={f.firm} className="w-6 h-6 rounded shrink-0" />
                        <span className="text-sm text-white truncate max-w-[160px]">{f.firm}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-bold">{f.total_audits}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{f.unique_clients}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{f.audits_last_90d}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{f.audits_last_365d}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-[11px]">
                      {f.growth_pct == null ? <span className="text-muted-foreground">—</span> : (
                        <span className={f.growth_pct > 20 ? "text-emerald-300" : f.growth_pct < -20 ? "text-rose-300" : "text-muted-foreground"}>
                          {f.growth_pct > 0 ? "+" : ""}{f.growth_pct.toFixed(0)}%
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-[11px]">
                      <span className={f.critical_rate_pct > 40 ? "text-rose-300" : f.critical_rate_pct > 20 ? "text-amber-300" : "text-muted-foreground"}>
                        {f.critical_rate_pct.toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(f.categories).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cat, n]) => (
                          <span key={cat} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-muted-foreground">{cat} ·{n}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        {f.top_clients.slice(0, 3).map((c) => (
                          <Link key={c.slug} to={`/protocol/${c.slug}`} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary/80 hover:text-primary border border-primary/15">
                            {c.name}
                          </Link>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* FIRMS GRID — clickable cards */}
      {tab === "firms" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {sortedFirms.slice(0, 80).map((f) => (
            <Link
              key={f.firm}
              to={`/auditors/${encodeURIComponent(f.firm.toLowerCase())}`}
              className="as-card p-4 hover:border-primary/40 transition-colors group"
            >
              <div className="flex items-center gap-3 mb-3">
                <BrandLogo name={f.firm} className="w-10 h-10 rounded-lg shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white truncate group-hover:text-primary">{f.firm}</div>
                  <div className="text-[10.5px] text-muted-foreground mt-0.5">
                    {f.latest_audit ? `Last audit ${daysAgo(f.latest_audit)} ago` : "no recent audits"}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <FirmStat label="Audits" value={f.total_audits.toString()} />
                <FirmStat label="Clients" value={f.unique_clients.toString()} />
                <FirmStat label="L90d" value={f.audits_last_90d.toString()} tone={f.audits_last_90d > 0 ? "good" : "neutral"} />
              </div>
              {Object.keys(f.categories).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(f.categories).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([cat, n]) => (
                    <span key={cat} className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.04] text-muted-foreground">{cat} ·{n}</span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}

      {/* COVERAGE GAPS */}
      {tab === "gaps" && (
        <div className="as-card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <h3 className="text-sm font-semibold text-white">Coverage gaps — your next lead list</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Ranked by TVL exposure × time since last audit. High-value, low-coverage prospects.</p>
          </div>
          <div className="overflow-x-auto max-h-[700px]">
            <table className="w-full text-xs">
              <thead className="bg-white/[0.02] border-b border-white/[0.04] sticky top-0 z-10">
                <tr className="text-left text-[10px] uppercase tracking-[0.08em] font-medium text-muted-foreground">
                  <th className="px-3 py-2.5 w-8">#</th>
                  <th className="px-3 py-2.5">Protocol</th>
                  <th className="px-2 py-2.5">Category</th>
                  <th className="px-2 py-2.5 text-right">TVL</th>
                  <th className="px-2 py-2.5">Last audit</th>
                  <th className="px-2 py-2.5 text-right">Days stale</th>
                  <th className="px-2 py-2.5 text-right">Gap score</th>
                  <th className="px-2 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {gapList.slice(0, 100).map((g, i) => (
                  <tr key={g.slug} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-2 text-[10px] text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2">
                      <Link to={`/protocol/${g.slug}`} className="flex items-center gap-2 hover:text-primary">
                        <BrandLogo name={g.name} url={g.url} logo={g.logo} className="w-6 h-6 rounded shrink-0" />
                        <span className="text-sm text-white truncate max-w-[160px]">{g.name}</span>
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-[11px] text-muted-foreground">{g.category || "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-bold">{compactUsd(g.tvl)}</td>
                    <td className="px-2 py-2 text-[11px]">
                      {g.last_audit_firm ? (
                        <>
                          <div className="text-white/85 truncate max-w-[120px]">{g.last_audit_firm}</div>
                          <div className="text-muted-foreground">{g.last_audit_date}</div>
                        </>
                      ) : <span className="text-rose-300">no audit on file</span>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-[11px]">
                      {g.days_since_audit != null ? (
                        <span className={g.days_since_audit > 365 ? "text-rose-300" : g.days_since_audit > 180 ? "text-amber-300" : "text-muted-foreground"}>
                          {g.days_since_audit}d
                        </span>
                      ) : <span className="text-rose-300">∞</span>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-[11px] text-rose-200">{Math.round(g.exposure_score)}</td>
                    <td className="px-2 py-2">
                      <Link to={`/protocol/${g.slug}`} className="text-muted-foreground hover:text-primary inline-flex items-center"><ArrowRight className="w-3 h-3" /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTOR DOMINANCE */}
      {tab === "sectors" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {sectorMatrix.map((s) => (
            <div key={s.category} className="as-card p-4">
              <div className="flex items-baseline gap-2 mb-3">
                <h3 className="text-sm font-semibold text-white">{s.category}</h3>
                <span className="text-[11px] text-muted-foreground">{s.total} audits</span>
              </div>
              <div className="space-y-2">
                {s.top.map((row) => (
                  <div key={row.firm} className="flex items-center gap-2">
                    <BrandLogo name={row.firm} className="w-5 h-5 rounded shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-[12.5px] text-white truncate">{row.firm}</span>
                        <span className="text-[10px] tabular-nums text-muted-foreground">{row.count} · {row.share_pct.toFixed(0)}%</span>
                      </div>
                      <div className="h-1 bg-white/[0.05] rounded overflow-hidden">
                        <div className="h-full bg-primary/60" style={{ width: `${Math.min(100, row.share_pct)}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MARKET TRENDS */}
      {tab === "trends" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="as-card p-5 lg:col-span-2">
            <h3 className="text-sm font-semibold text-white mb-3">Audits per quarter</h3>
            {quarterlyTrend.length === 0 ? (
              <div className="text-xs text-muted-foreground">No data yet.</div>
            ) : (
              <div className="flex items-end gap-3 h-48">
                {quarterlyTrend.map(([q, n]) => {
                  const max = Math.max(...quarterlyTrend.map(([, v]) => v));
                  const h = (n / max) * 100;
                  return (
                    <div key={q} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                      <span className="text-[11px] tabular-nums text-white/85 font-bold">{n}</span>
                      <div className="w-full bg-gradient-to-t from-primary/40 to-primary/15 rounded-t" style={{ height: `${h}%`, minHeight: 4 }} />
                      <span className="text-[10px] text-muted-foreground">{q}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="text-[10px] text-muted-foreground mt-3">Market velocity. Look for protocols you should be pitching during the build-up.</div>
          </div>

          <div className="as-card p-5">
            <h3 className="text-sm font-semibold text-white mb-3">Fastest-growing firms (YoY)</h3>
            <div className="space-y-2">
              {sortedFirms.slice().sort((a, b) => (b.growth_pct ?? -999) - (a.growth_pct ?? -999)).filter(f => f.audits_last_365d >= 5).slice(0, 8).map((f) => (
                <div key={f.firm} className="flex items-center gap-2">
                  <BrandLogo name={f.firm} className="w-5 h-5 rounded shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] text-white truncate">{f.firm}</div>
                    <div className="text-[10px] text-muted-foreground">{f.audits_prev_365d} → {f.audits_last_365d} audits</div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-[12px] font-bold tabular-nums inline-flex items-center gap-0.5 ${(f.growth_pct ?? 0) > 0 ? "text-emerald-300" : "text-rose-300"}`}>
                      {(f.growth_pct ?? 0) > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {(f.growth_pct ?? 0) > 0 ? "+" : ""}{(f.growth_pct ?? 0).toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint?: string; tone?: "neutral" | "good" | "warn" | "alert" }) {
  const cls = ({
    neutral: "border-white/[0.06] bg-white/[0.02] text-white",
    good: "border-emerald-500/25 bg-emerald-500/[0.04] text-emerald-200",
    warn: "border-amber-500/30 bg-amber-500/[0.05] text-amber-200",
    alert: "border-rose-500/30 bg-rose-500/[0.06] text-rose-200",
  } as Record<string, string>)[tone];
  return (
    <div className={`rounded-lg border px-4 py-4 ${cls} transition-colors hover:bg-white/[0.04]`}>
      <div className="text-[10px] uppercase tracking-[0.08em] font-medium opacity-90">{label}</div>
      <div className="text-[28px] leading-none font-bold tabular-nums mt-2">{value}</div>
      {hint && <div className="text-[11px] opacity-70 mt-2">{hint}</div>}
    </div>
  );
}

function FirmStat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "good" | "warn" | "alert" | "neutral" }) {
  const cls = ({
    good: "text-emerald-300",
    warn: "text-amber-300",
    alert: "text-rose-300",
    neutral: "text-white",
  } as Record<string, string>)[tone];
  return (
    <div className="rounded border border-white/[0.05] bg-white/[0.015] px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/80">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-xs inline-flex items-center gap-1.5 border-b-2 -mb-[1px] ${active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-white"}`}
    >
      {children}
    </button>
  );
}
