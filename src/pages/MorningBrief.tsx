import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ShieldCheck, Newspaper, TrendingUp, TrendingDown, Calendar, Skull, Activity,
  Sparkles, ArrowRight, RefreshCw, Banknote, ChevronDown, Search, Filter,
  ShieldAlert, Lock, Vote, ExternalLink, ArrowUpRight, ArrowDownRight, Dot,
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, Tooltip as ReTooltip, LineChart, Line } from "recharts";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";
import { useAuth } from "@/hooks/useAuth";

function compactUsd(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n === 0) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function tightAgo(d: string | null | undefined): string {
  if (!d) return "—";
  const ms = Date.now() - new Date(d).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

type Sections = { [k: string]: string | undefined };
type XActivity = { last_x_post_at: string | null; x_posts_30d: number | null };
type FundBrief = { fund_slug: string; headline: string | null; brief: string | null; sections: Sections | null; posture_rating: string; data_confidence: string; generated_at: string };
type FilterChip = "all" | "concerning" | "movers" | "events" | "unaudited";

export default function MorningBrief() {
  const { user } = useAuth();
  const qc = useQueryClient();

  // ---- Profile fund + all funds (for peer picker) ----
  const profileQ = useQuery({
    queryKey: ["mb-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("user_profiles").select("fund_slug").eq("user_id", user!.id).maybeSingle();
      return data as { fund_slug: string | null } | null;
    },
  });
  const ownFundSlug = profileQ.data?.fund_slug ?? null;

  const allFundsQ = useQuery({
    queryKey: ["mb-all-funds"],
    queryFn: async () => {
      const { data } = await supabase.from("funds").select("slug,name").order("name", { ascending: true }).limit(500);
      return (data ?? []) as Array<{ slug: string; name: string }>;
    },
  });

  const [selectedFundSlug, setSelectedFundSlug] = useState<string | null>(null);
  const fundSlug = selectedFundSlug ?? ownFundSlug;

  const fundLabel = useMemo(() => {
    if (!fundSlug) return "Select a fund";
    const f = (allFundsQ.data ?? []).find(x => x.slug === fundSlug);
    return f?.name || fundSlug;
  }, [fundSlug, allFundsQ.data]);

  // ---- Fund brief (sectioned) ----
  const fundBriefQ = useQuery({
    queryKey: ["fund-brief", fundSlug],
    enabled: !!fundSlug,
    queryFn: async () => {
      const { data } = await supabase
        .from("fund_briefs")
        .select("fund_slug,headline,brief,sections,posture_rating,data_confidence,generated_at")
        .eq("fund_slug", fundSlug!).maybeSingle();
      return data as FundBrief | null;
    },
  });

  const [briefRefreshing, setBriefRefreshing] = useState(false);
  const refreshBrief = async (force: boolean) => {
    if (!fundSlug) return;
    setBriefRefreshing(true);
    try {
      await fetch(`${import.meta.env.VITE_SUPABASE_URL || "https://qktjbtmcjrwzmtqnszbq.supabase.co"}/functions/v1/generate-fund-brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fund_slug: fundSlug, force }),
      });
      qc.invalidateQueries({ queryKey: ["fund-brief", fundSlug] });
    } catch (e) { console.error(e); }
    finally { setBriefRefreshing(false); }
  };

  // ---- Portfolio ----
  const slugsQ = useQuery({
    queryKey: ["mb-slugs", fundSlug],
    enabled: !!fundSlug,
    queryFn: async (): Promise<string[]> => {
      const { data } = await supabase.from("fund_portfolio").select("company_slug").eq("fund_slug", fundSlug!);
      return Array.from(new Set((data ?? []).map((r: any) => r.company_slug as string).filter(Boolean)));
    },
  });
  const slugs = slugsQ.data ?? [];

  const companiesQ = useQuery({
    queryKey: ["mb-companies", slugs.length, slugs.join(",")],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("companies")
        .select("slug,name,url,logo,category,has_been_hacked,has_bug_bounty,last_audit_date,last_audit_firm")
        .in("slug", slugs);
      return (data ?? []) as any[];
    },
  });
  const companiesMap = useMemo(() => {
    const m = new Map<string, any>(); for (const c of companiesQ.data ?? []) m.set(c.slug, c); return m;
  }, [companiesQ.data]);

  // ---- Per-position TVL — latest point per slug ----
  const tvlSeriesQ = useQuery({
    queryKey: ["mb-tvl-latest", slugs.length, fundSlug],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("protocol_metrics").select("company_slug,tvl_usd,date")
        .in("company_slug", slugs).not("tvl_usd", "is", null).gte("date", cutoff)
        .order("date", { ascending: false }).limit(5000);
      const latestBySlug = new Map<string, number>();
      let aggregate = 0;
      for (const r of (data ?? []) as any[]) {
        if (latestBySlug.has(r.company_slug)) continue;
        latestBySlug.set(r.company_slug, Number(r.tvl_usd));
        aggregate += Number(r.tvl_usd);
      }
      return { latestBySlug, aggregate };
    },
  });

  // ---- Risk scores + history (for trend sparklines) ----
  const scoresQ = useQuery({
    queryKey: ["mb-scores", slugs.length, fundSlug],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("protocol_risk_scores").select("company_slug,composite_score,band").in("company_slug", slugs);
      const m = new Map<string, { score: number; band: string }>();
      for (const r of (data ?? []) as any[]) m.set(r.company_slug, { score: r.composite_score, band: r.band });
      return m;
    },
  });

  const riskHistoryQ = useQuery({
    queryKey: ["mb-risk-history", slugs.length, fundSlug],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 32 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("protocol_risk_scores_history").select("company_slug,composite_score,snapshot_date")
        .in("company_slug", slugs).gte("snapshot_date", cutoff)
        .order("snapshot_date", { ascending: true });
      const m = new Map<string, Array<{ date: string; score: number }>>();
      for (const r of (data ?? []) as any[]) {
        const arr = m.get(r.company_slug) ?? [];
        arr.push({ date: r.snapshot_date, score: r.composite_score });
        m.set(r.company_slug, arr);
      }
      return m;
    },
  });

  // ---- Per-protocol briefs (posture chip) ----
  const briefsByPositionQ = useQuery({
    queryKey: ["mb-position-briefs", slugs.length, fundSlug],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("risk_landscape_briefs").select("company_slug,headline,posture_rating").in("company_slug", slugs);
      const m = new Map<string, { headline: string | null; posture_rating: string | null }>();
      for (const r of (data ?? []) as any[]) m.set(r.company_slug, { headline: r.headline, posture_rating: r.posture_rating });
      return m;
    },
  });

  // ---- Findings (open) per slug ----
  const findingsQ = useQuery({
    queryKey: ["mb-findings", slugs.length, fundSlug],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("audit_findings_detail").select("company_slug,severity,status").in("company_slug", slugs).limit(8000);
      const isOpen = (s: string) => !["fixed", "resolved", "remediated", "acknowledged", "won't fix", "wontfix"].includes((s || "").toLowerCase());
      const m = new Map<string, { critical: number; high: number }>();
      let totalC = 0, totalH = 0;
      for (const r of (data ?? []) as any[]) {
        if (!isOpen(r.status)) continue;
        const e = m.get(r.company_slug) ?? { critical: 0, high: 0 };
        if (r.severity === "critical") { e.critical++; totalC++; }
        else if (r.severity === "high") { e.high++; totalH++; }
        m.set(r.company_slug, e);
      }
      return { perSlug: m, totalC, totalH };
    },
  });

  // ---- Recent events for activity rail (news + hacks + anomalies) ----
  const newsQ = useQuery({
    queryKey: ["mb-news", slugs.length, fundSlug],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data } = await supabase
        .from("news_items").select("company_slug,title,url,source,sentiment,published_at")
        .in("company_slug", slugs).gte("published_at", cutoff)
        .order("published_at", { ascending: false }).limit(40);
      return (data ?? []) as any[];
    },
  });

  const hacksQ = useQuery({
    queryKey: ["mb-hacks", slugs.length, fundSlug],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase.from("hacks").select("company_slug,name,hack_date,amount_usd,technique").in("company_slug", slugs).gte("hack_date", cutoff).order("hack_date", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  const anomQ = useQuery({
    queryKey: ["mb-anom", slugs.length, fundSlug],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("metric_anomalies").select("company_slug,chain,date,z_score,direction,metric_kind")
        .in("company_slug", slugs).gte("date", cutoff).order("date", { ascending: false }).limit(30);
      return (data ?? []) as any[];
    },
  });

  // ---- Forward calendar ----
  const unlocksQ = useQuery({
    queryKey: ["mb-unlocks", slugs.length, fundSlug],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase.from("token_unlocks").select("company_slug,next_unlock_date,next_unlock_pct_supply").in("company_slug", slugs).gte("next_unlock_date", today).lte("next_unlock_date", future).order("next_unlock_date", { ascending: true });
      return (data ?? []) as any[];
    },
  });

  const fundingQ = useQuery({
    queryKey: ["mb-funding", slugs.length, fundSlug],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase.from("funding_rounds").select("company_slug,amount_usd,round_type,date").in("company_slug", slugs).gte("date", cutoff).order("date", { ascending: false });
      const m = new Map<string, { date: string; amount_usd: number | null; round_type: string | null }>();
      for (const r of (data ?? []) as any[]) if (!m.has(r.company_slug)) m.set(r.company_slug, { date: r.date, amount_usd: Number(r.amount_usd) || null, round_type: r.round_type });
      return m;
    },
  });

  const recentAuditsQ = useQuery({
    queryKey: ["mb-recent-audits", slugs.length, fundSlug],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase.from("audit_history").select("company_slug,audit_firm,audit_date").in("company_slug", slugs).gte("audit_date", cutoff).not("audit_firm", "is", null).order("audit_date", { ascending: false });
      const m = new Map<string, { date: string; firm: string }>();
      for (const r of (data ?? []) as any[]) if (!m.has(r.company_slug)) m.set(r.company_slug, { date: r.audit_date, firm: r.audit_firm });
      return m;
    },
  });

  // All-time audit history → for last-audit column and auditor concentration
  const allAuditsQ = useQuery({
    queryKey: ["mb-all-audits", slugs.length, fundSlug],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_history").select("company_slug,audit_firm,audit_date")
        .in("company_slug", slugs).not("audit_firm", "is", null);
      return (data ?? []) as any[];
    },
  });

  const bountiesQ = useQuery({
    queryKey: ["mb-bounties", slugs.length, fundSlug],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("bug_bounties").select("company_slug,is_active,max_bounty_usd").in("company_slug", slugs);
      return (data ?? []) as any[];
    },
  });

  // Aggregate revenue (fund-level total revenue 30d)
  const economicsQ = useQuery({
    queryKey: ["mb-economics", slugs.length, fundSlug],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("protocol_economics").select("company_slug,revenue_30d,fees_30d,mcap,treasury_usd").in("company_slug", slugs);
      return (data ?? []) as any[];
    },
  });

  // ---- Aggregates ----
  const latestBookTvl = tvlSeriesQ.data?.aggregate ?? 0;
  const positionsWithTvl = tvlSeriesQ.data?.latestBySlug.size ?? 0;

  const hackBySlug = useMemo(() => {
    const m = new Map<string, { date: string; amount_usd: number; technique: string | null }>();
    for (const h of (hacksQ.data ?? [])) if (!m.has(h.company_slug)) m.set(h.company_slug, { date: h.hack_date, amount_usd: Number(h.amount_usd), technique: h.technique });
    return m;
  }, [hacksQ.data]);

  // Latest-audit-ever per slug (firm + date)
  const lastAuditBySlug = useMemo(() => {
    const m = new Map<string, { date: string; firm: string }>();
    for (const a of (allAuditsQ.data ?? [])) {
      if (!a.audit_date) continue;
      const existing = m.get(a.company_slug);
      if (!existing || a.audit_date > existing.date) m.set(a.company_slug, { date: a.audit_date, firm: a.audit_firm });
    }
    return m;
  }, [allAuditsQ.data]);

  // Auditor concentration: which firms touch the most positions
  const auditorConcentration = useMemo(() => {
    const counts = new Map<string, Set<string>>();
    for (const a of (allAuditsQ.data ?? [])) {
      const firm = (a.audit_firm || "").trim(); if (!firm) continue;
      if (!counts.has(firm)) counts.set(firm, new Set());
      counts.get(firm)!.add(a.company_slug);
    }
    return Array.from(counts.entries())
      .map(([firm, set]) => ({ firm, count: set.size, pct: slugs.length > 0 ? (set.size / slugs.length) * 100 : 0 }))
      .sort((a, b) => b.count - a.count).slice(0, 6);
  }, [allAuditsQ.data, slugs.length]);

  // Sector concentration
  const sectorConcentration = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of (companiesQ.data ?? [])) {
      const cat = c.category || "Uncategorized";
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([sector, count]) => ({ sector, count, pct: slugs.length > 0 ? (count / slugs.length) * 100 : 0 }))
      .sort((a, b) => b.count - a.count).slice(0, 6);
  }, [companiesQ.data, slugs.length]);

  // Aggregate book economics
  const bookEconomics = useMemo(() => {
    let rev30d = 0, mcap = 0, treasury = 0, with_revenue = 0;
    for (const e of (economicsQ.data ?? [])) {
      if (e.revenue_30d) { rev30d += Number(e.revenue_30d); with_revenue++; }
      if (e.mcap) mcap += Number(e.mcap);
      if (e.treasury_usd) treasury += Number(e.treasury_usd);
    }
    return { rev30d, mcap, treasury, with_revenue };
  }, [economicsQ.data]);

  const bountyCoverage = useMemo(() => {
    const activeBountySlugs = new Set<string>();
    for (const b of (bountiesQ.data ?? [])) if (b.is_active !== false) activeBountySlugs.add(b.company_slug);
    return { covered: activeBountySlugs.size, total: slugs.length, pct: slugs.length > 0 ? (activeBountySlugs.size / slugs.length) * 100 : 0 };
  }, [bountiesQ.data, slugs.length]);

  // ---- Filters + search ----
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterChip>("all");
  const [sortKey, setSortKey] = useState<"activity" | "tvl" | "findings" | "name">("activity");

  // ---- Portfolio rows ----
  const portfolioRows = useMemo(() => {
    function pickLatestActivity(slug: string): { date: string | null; kind: string; label: string } {
      const candidates: Array<{ date: string; kind: string; label: string; weight: number }> = [];
      const audit = recentAuditsQ.data?.get(slug);
      if (audit) candidates.push({ date: audit.date, kind: "audit", label: `Audited · ${audit.firm}`, weight: 1 });
      const fund = fundingQ.data?.get(slug);
      if (fund) candidates.push({ date: fund.date, kind: "fund", label: `Raised ${fund.amount_usd ? compactUsd(fund.amount_usd) : "round"}${fund.round_type ? " " + fund.round_type : ""}`, weight: 1 });
      const hack = hackBySlug.get(slug);
      if (hack) candidates.push({ date: hack.date, kind: "hack", label: `Hack · ${compactUsd(hack.amount_usd)}`, weight: 3 });
      if (candidates.length === 0) return { date: null, kind: "none", label: "" };
      candidates.sort((a, b) => b.weight - a.weight || (b.date || "").localeCompare(a.date || ""));
      return candidates[0];
    }

    const rows = slugs.map((slug) => {
      const co = companiesMap.get(slug);
      const latestTvl = tvlSeriesQ.data?.latestBySlug.get(slug) ?? null;
      const findings = findingsQ.data?.perSlug.get(slug);
      const brief = briefsByPositionQ.data?.get(slug);
      const activity = pickLatestActivity(slug);
      const lastAudit = lastAuditBySlug.get(slug) ?? (co?.last_audit_date ? { date: co.last_audit_date, firm: co.last_audit_firm || "—" } : null);
      return {
        slug, name: co?.name || slug,
        category: co?.category ?? null,
        url: co?.url ?? null, logo: co?.logo ?? null,
        has_hacked: !!co?.has_been_hacked,
        has_bounty: !!co?.has_bug_bounty,
        last_audit_date: lastAudit?.date ?? null,
        last_audit_firm: lastAudit?.firm ?? null,
        tvl: latestTvl,
        headline: brief?.headline ?? null,
        critical: findings?.critical ?? 0, high: findings?.high ?? 0,
        activity,
      };
    });

    // Filter
    let filtered = rows;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(r => r.name.toLowerCase().includes(q) || (r.category || "").toLowerCase().includes(q));
    }
    if (filter === "concerning") {
      filtered = filtered.filter(r => r.critical > 0 || (r.high > 0 && !r.last_audit_date));
    } else if (filter === "movers") {
      // No TVL history available — fallback: positions with recent material activity
      filtered = filtered.filter(r => r.activity.date && (Date.now() - new Date(r.activity.date).getTime()) / 86400000 <= 30);
    } else if (filter === "events") {
      filtered = filtered.filter(r => r.activity.date && (Date.now() - new Date(r.activity.date).getTime()) / 86400000 <= 30);
    } else if (filter === "unaudited") {
      filtered = filtered.filter(r => !r.last_audit_date);
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "tvl": return (b.tvl ?? 0) - (a.tvl ?? 0);
        case "findings": return (b.critical * 5 + b.high) - (a.critical * 5 + a.high);
        case "name": return a.name.localeCompare(b.name);
        case "activity":
        default: {
          const ad = a.activity.date || ""; const bd = b.activity.date || "";
          if (ad && bd) return bd.localeCompare(ad);
          if (ad) return -1; if (bd) return 1;
          return a.name.localeCompare(b.name);
        }
      }
    });
    return filtered;
  }, [slugs, companiesMap, tvlSeriesQ.data, findingsQ.data, briefsByPositionQ.data, recentAuditsQ.data, fundingQ.data, hackBySlug, lastAuditBySlug, search, filter, sortKey]);

  // Unfiltered counts for chip labels
  const chipCounts = useMemo(() => {
    let concerning = 0, events = 0, unaudited = 0;
    for (const slug of slugs) {
      const findings = findingsQ.data?.perSlug.get(slug);
      const co = companiesMap.get(slug);
      if ((findings?.critical ?? 0) > 0 || ((findings?.high ?? 0) > 0 && !co?.last_audit_date)) concerning++;
      const lastAudit = lastAuditBySlug.get(slug);
      const auditDate = lastAudit?.date || co?.last_audit_date;
      if (!auditDate) unaudited++;
      const hack = hackBySlug.get(slug);
      const fund = fundingQ.data?.get(slug);
      const audit = recentAuditsQ.data?.get(slug);
      const latestDate = [hack?.date, fund?.date, audit?.date].filter(Boolean).sort().at(-1);
      if (latestDate && (Date.now() - new Date(latestDate).getTime()) / 86400000 <= 30) events++;
    }
    return { concerning, events, unaudited };
  }, [slugs, findingsQ.data, companiesMap, lastAuditBySlug, hackBySlug, fundingQ.data, recentAuditsQ.data]);

  // ---- Live activity stream (right rail) ----
  const liveStream = useMemo(() => {
    const items: Array<{ kind: "news" | "hack" | "anomaly"; ts: string; slug: string; title: string; sub: string; sev: "alert" | "warn" | "info"; url?: string }> = [];
    for (const h of (hacksQ.data ?? [])) {
      items.push({ kind: "hack", ts: h.hack_date, slug: h.company_slug, title: `Hack · ${compactUsd(Number(h.amount_usd))}`, sub: h.technique || "incident", sev: "alert" });
    }
    for (const a of (anomQ.data ?? [])) {
      if (Math.abs(Number(a.z_score) || 0) < 2.5) continue;
      items.push({ kind: "anomaly", ts: a.date, slug: a.company_slug, title: `${a.direction === "up" ? "Spike" : "Drop"} ${Math.abs(Number(a.z_score)).toFixed(1)}σ`, sub: `${a.metric_kind || "tx"} · ${a.chain || ""}`, sev: Math.abs(Number(a.z_score)) >= 4 ? "alert" : "warn" });
    }
    for (const n of (newsQ.data ?? [])) {
      items.push({ kind: "news", ts: n.published_at, slug: n.company_slug, title: n.title, sub: n.source || "news", sev: n.sentiment === "negative" ? "warn" : "info", url: n.url });
    }
    return items.sort((a, b) => (b.ts > a.ts ? 1 : -1)).slice(0, 40);
  }, [hacksQ.data, anomQ.data, newsQ.data]);

  // ---- Top-strip KPIs ----
  const kpis = useMemo(() => {
    const recentEvents = liveStream.filter(e => (Date.now() - new Date(e.ts).getTime()) / 86400000 <= 1).length;
    const totalRaised90d = (fundingQ.data ? Array.from(fundingQ.data.values()) : []).filter((r: any) => r.date && (Date.now() - new Date(r.date).getTime()) / 86400000 <= 90).reduce((s: number, r: any) => s + (Number(r.amount_usd) || 0), 0);
    const bands = { low: 0, medium: 0, high: 0, critical: 0 } as Record<string, number>;
    for (const s of scoresQ.data?.values() ?? []) if (s.band in bands) bands[s.band]++;
    return {
      bookTvl: latestBookTvl,
      positionsWithTvl,
      positions: slugs.length,
      openCritical: findingsQ.data?.totalC ?? 0,
      openHigh: findingsQ.data?.totalH ?? 0,
      eventsToday: recentEvents,
      raised90d: totalRaised90d,
      bands,
      unlocks30d: (unlocksQ.data ?? []).length,
    };
  }, [liveStream, latestBookTvl, positionsWithTvl, slugs.length, findingsQ.data, fundingQ.data, scoresQ.data, unlocksQ.data]);

  const [fundPickerOpen, setFundPickerOpen] = useState(false);
  const [fundSearch, setFundSearch] = useState("");
  const filteredFunds = useMemo(() => {
    const q = fundSearch.toLowerCase();
    return (allFundsQ.data ?? []).filter(f => f.name.toLowerCase().includes(q) || f.slug.includes(q)).slice(0, 25);
  }, [allFundsQ.data, fundSearch]);

  const [briefExpanded, setBriefExpanded] = useState(false);

  if (!ownFundSlug && !selectedFundSlug) {
    return (
      <div className="space-y-4 max-w-3xl">
        <div className="as-card p-8 text-center text-sm text-muted-foreground">
          <h2 className="text-base text-white mb-2 font-medium">No fund selected</h2>
          <p>Set your fund on <Link to="/profile" className="text-primary hover:underline">your profile</Link>, or pick a fund below to monitor.</p>
          <div className="mt-4 max-h-[420px] overflow-y-auto border border-white/[0.06] rounded-md">
            {filteredFunds.map(f => (
              <button key={f.slug} onClick={() => setSelectedFundSlug(f.slug)} className="block w-full text-left px-3 py-2 text-xs text-white/85 hover:bg-white/[0.04]">{f.name}</button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-[1800px]">
      {/* === TOP BAR: fund picker + brief refresh + search === */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Fund picker */}
        <div className="relative">
          <button onClick={() => setFundPickerOpen(v => !v)} className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-white/[0.08] bg-white/[0.02] hover:border-primary/40 hover:bg-white/[0.04] text-sm">
            <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Fund</span>
            <span className="font-semibold text-white">{fundLabel}</span>
            {selectedFundSlug && selectedFundSlug !== ownFundSlug && (
              <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-200 border border-violet-500/30">peer</span>
            )}
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          {fundPickerOpen && (
            <div className="absolute z-50 mt-1 w-[340px] max-h-[480px] overflow-hidden flex flex-col border border-white/[0.08] bg-[#0a0a0a] rounded-md shadow-2xl">
              <div className="p-2 border-b border-white/[0.06]">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input autoFocus value={fundSearch} onChange={e => setFundSearch(e.target.value)} placeholder="Search funds…" className="w-full pl-7 pr-2 py-1.5 text-xs bg-white/[0.04] border border-white/[0.06] rounded text-white placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40" />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {ownFundSlug && (
                  <div className="px-2 pt-1">
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground px-1 py-1">Your fund</div>
                    <button onClick={() => { setSelectedFundSlug(null); setFundPickerOpen(false); }} className={`block w-full text-left px-2 py-1.5 text-xs rounded hover:bg-white/[0.04] ${!selectedFundSlug ? "bg-primary/10 text-primary" : "text-white/85"}`}>
                      {(allFundsQ.data ?? []).find(f => f.slug === ownFundSlug)?.name || ownFundSlug}
                    </button>
                  </div>
                )}
                <div className="px-2 pt-2 pb-1">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground px-1 py-1">Peers · monitor any fund</div>
                  {filteredFunds.filter(f => f.slug !== ownFundSlug).map(f => (
                    <button key={f.slug} onClick={() => { setSelectedFundSlug(f.slug); setFundPickerOpen(false); }} className={`block w-full text-left px-2 py-1.5 text-xs rounded hover:bg-white/[0.04] truncate ${selectedFundSlug === f.slug ? "bg-primary/10 text-primary" : "text-white/85"}`}>
                      {f.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Brief refresh control */}
        <button
          onClick={() => refreshBrief(true)}
          disabled={briefRefreshing || !fundSlug}
          className="text-[11px] px-2.5 py-2 rounded border border-white/[0.08] hover:border-primary/40 hover:bg-white/[0.03] text-muted-foreground hover:text-white inline-flex items-center gap-1.5 disabled:opacity-40"
          title="Regenerate AI brief"
        >
          <RefreshCw className={`w-3 h-3 ${briefRefreshing ? "animate-spin" : ""}`} /> Refresh brief
        </button>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search positions…" className="pl-7 pr-3 py-1.5 text-xs bg-white/[0.03] border border-white/[0.08] rounded text-white placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40 w-56" />
        </div>
      </div>

      {/* === KPI STRIP === */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <KpiTile label="Book TVL" value={compactUsd(kpis.bookTvl)} hint={`${kpis.positionsWithTvl}/${kpis.positions} on-chain`} tone="neutral" />
        <KpiTile label="Positions" value={String(kpis.positions)} hint={`${kpis.positionsWithTvl} with TVL`} tone="neutral" />
        <KpiTile label="Crit at audit" value={String(kpis.openCritical)} hint={`${kpis.openHigh} high · audit snapshot`} tone={kpis.openCritical > 0 ? "alert" : "good"} />
        <KpiTile label="Events 24h" value={String(kpis.eventsToday)} hint={`${liveStream.length} in 7d`} tone={kpis.eventsToday > 0 ? "warn" : "good"} />
        <KpiTile label="Raised 90d" value={compactUsd(kpis.raised90d)} hint="portfolio total" tone="neutral" />
        <KpiTile label="Unlocks 30d" value={String(kpis.unlocks30d)} hint="upcoming" tone={kpis.unlocks30d > 0 ? "warn" : "good"} />
      </div>

      {/* === BRIEF (collapsed by default) === */}
      {fundBriefQ.data && (
        <BriefBar brief={fundBriefQ.data} expanded={briefExpanded} onToggle={() => setBriefExpanded(v => !v)} refreshing={briefRefreshing} />
      )}

      {/* === FILTER CHIPS === */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Filter className="w-3 h-3 text-muted-foreground mr-1" />
        <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>All · {slugs.length}</FilterButton>
        <FilterButton active={filter === "concerning"} onClick={() => setFilter("concerning")} tone="alert">Concerning · {chipCounts.concerning}</FilterButton>
        <FilterButton active={filter === "events"} onClick={() => setFilter("events")}>Recent events · {chipCounts.events}</FilterButton>
        <FilterButton active={filter === "unaudited"} onClick={() => setFilter("unaudited")} tone="warn">Unaudited · {chipCounts.unaudited}</FilterButton>
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground">Showing {portfolioRows.length}</span>
      </div>

      {/* === MAIN: 2-COLUMN — TABLE + LIVE ACTIVITY === */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-3">
        {/* Portfolio table */}
        <div className="as-card p-0 overflow-hidden">
          <div className="overflow-x-auto max-h-[760px]">
            <table className="w-full text-[11.5px]">
              <thead className="bg-white/[0.025] border-b border-white/[0.06] sticky top-0 z-10">
                <tr className="text-left text-[9.5px] uppercase tracking-[0.08em] font-semibold text-muted-foreground">
                  <Th onClick={() => setSortKey("name")} active={sortKey === "name"} className="px-3 py-2">Position</Th>
                  <Th onClick={() => setSortKey("tvl")} active={sortKey === "tvl"} className="px-2 py-2 text-right">TVL</Th>
                  <Th onClick={() => setSortKey("findings")} active={sortKey === "findings"} className="px-2 py-2 w-[120px] text-center" title="Findings unresolved as of the audit report. We do not verify live patch status.">Findings (audit)</Th>
                  <th className="px-2 py-2 w-[130px]">Last audit</th>
                  <Th onClick={() => setSortKey("activity")} active={sortKey === "activity"} className="px-3 py-2">Latest activity</Th>
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {portfolioRows.map((r) => (
                  <tr key={r.slug} className="hover:bg-white/[0.025] align-middle group">
                    <td className="px-3 py-2">
                      <Link to={`/protocol/${r.slug}`} className="flex items-center gap-2 hover:text-primary min-w-0">
                        <BrandLogo name={r.name} url={r.url} logo={r.logo} className="w-6 h-6 rounded-md shrink-0" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12.5px] font-medium text-white truncate max-w-[160px]">{r.name}</span>
                            {r.has_bounty && <ShieldCheck className="w-3 h-3 text-emerald-300 shrink-0" aria-label="Active bug bounty" />}
                            {r.has_hacked && <Skull className="w-3 h-3 text-rose-400 shrink-0" aria-label="Past hack on record" />}
                          </div>
                          {r.category && <div className="text-[9.5px] text-muted-foreground/80 truncate">{r.category}</div>}
                        </div>
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-white/90">{compactUsd(r.tvl)}</td>
                    <td className="px-2 py-2 text-center">
                      <FindingsCell critical={r.critical} high={r.high} auditDate={r.last_audit_date} />
                    </td>
                    <td className="px-2 py-2">
                      <LastAuditCell date={r.last_audit_date} firm={r.last_audit_firm} />
                    </td>
                    <td className="px-3 py-2">
                      {r.activity.date ? <ActivityCell kind={r.activity.kind} label={r.activity.label} date={r.activity.date} /> : <span className="text-muted-foreground/40 text-[10.5px]">quiet</span>}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Link to={`/protocol/${r.slug}`} className="text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Live activity rail */}
        <div className="space-y-3">
          {/* Activity feed */}
          <div className="as-card p-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-white/[0.06] bg-white/[0.02] flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-primary" />
              <h3 className="text-[11px] font-semibold text-white uppercase tracking-wider">Live activity</h3>
              <span className="text-[10px] text-muted-foreground ml-auto">{liveStream.length} · 7d</span>
            </div>
            {liveStream.length === 0 ? (
              <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">No activity in the last 7 days.</div>
            ) : (
              <div className="divide-y divide-white/[0.04] max-h-[420px] overflow-y-auto">
                {liveStream.map((e, i) => {
                  const co = companiesMap.get(e.slug);
                  const sevDot = e.sev === "alert" ? "bg-rose-400" : e.sev === "warn" ? "bg-amber-400" : "bg-sky-400";
                  return (
                    <a key={i} href={e.url || `/protocol/${e.slug}`} target={e.url ? "_blank" : undefined} rel={e.url ? "noopener noreferrer" : undefined} className="block px-3 py-2 hover:bg-white/[0.02]">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${sevDot}`} />
                        <span className="text-[11px] font-medium text-white truncate">{co?.name || e.slug}</span>
                        <span className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground ml-auto">{e.kind}</span>
                        <span className="text-[9px] text-muted-foreground tabular-nums">{tightAgo(e.ts)}</span>
                      </div>
                      <div className="text-[11px] text-white/80 line-clamp-2 mt-0.5">{e.title}</div>
                      <div className="text-[10px] text-muted-foreground/80 truncate mt-0.5">{e.sub}</div>
                    </a>
                  );
                })}
              </div>
            )}
            <Link to="/book/news" className="block px-3 py-2 text-center text-[10px] text-primary hover:bg-primary/5 border-t border-white/[0.04]">
              Open full feed →
            </Link>
          </div>

          {/* Concentration */}
          <div className="as-card p-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-white/[0.06] bg-white/[0.02] flex items-center gap-2">
              <ShieldAlert className="w-3.5 h-3.5 text-violet-300" />
              <h3 className="text-[11px] font-semibold text-white uppercase tracking-wider">Concentration</h3>
              <span className="text-[10px] text-muted-foreground ml-auto">top-of-book</span>
            </div>
            <div className="px-3 py-3 space-y-3">
              <div>
                <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground mb-1.5">Sector mix</div>
                <div className="space-y-1">
                  {sectorConcentration.slice(0, 5).map(s => (
                    <ConcentrationBar key={s.sector} label={s.sector} value={s.pct} max={100} count={s.count} color="#06b6d4" />
                  ))}
                </div>
              </div>
              <div className="border-t border-white/[0.04] pt-3">
                <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground mb-1.5">Auditor concentration</div>
                <div className="space-y-1">
                  {auditorConcentration.slice(0, 5).map(a => (
                    <ConcentrationBar key={a.firm} label={a.firm} value={a.pct} max={100} count={a.count} color="#8b5cf6" />
                  ))}
                  {auditorConcentration.length === 0 && <div className="text-[10.5px] text-muted-foreground italic">No audit data mapped.</div>}
                </div>
              </div>
              <div className="border-t border-white/[0.04] pt-3 grid grid-cols-2 gap-2 text-[10.5px]">
                <div>
                  <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Bounty cov.</div>
                  <div className={`text-base font-bold tabular-nums mt-0.5 ${bountyCoverage.pct > 60 ? "text-emerald-300" : bountyCoverage.pct > 30 ? "text-amber-200" : "text-rose-300"}`}>
                    {bountyCoverage.pct.toFixed(0)}%
                  </div>
                  <div className="text-[10px] text-muted-foreground">{bountyCoverage.covered}/{bountyCoverage.total} positions</div>
                </div>
                <div>
                  <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Rev 30d</div>
                  <div className="text-base font-bold tabular-nums mt-0.5 text-white">{compactUsd(bookEconomics.rev30d)}</div>
                  <div className="text-[10px] text-muted-foreground">{bookEconomics.with_revenue} earning</div>
                </div>
              </div>
            </div>
          </div>

          {/* Upcoming calendar */}
          <div className="as-card p-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-white/[0.06] bg-white/[0.02] flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-amber-300" />
              <h3 className="text-[11px] font-semibold text-white uppercase tracking-wider">Forward calendar</h3>
              <span className="text-[10px] text-muted-foreground ml-auto">{(unlocksQ.data ?? []).length} unlocks</span>
            </div>
            {(unlocksQ.data ?? []).length === 0 ? (
              <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">No unlocks in next 30d.</div>
            ) : (
              <div className="divide-y divide-white/[0.04] max-h-[260px] overflow-y-auto">
                {(unlocksQ.data ?? []).slice(0, 10).map((u: any, i: number) => {
                  const co = companiesMap.get(u.company_slug);
                  const d = Math.ceil((new Date(u.next_unlock_date).getTime() - Date.now()) / 86400000);
                  return (
                    <Link key={i} to={`/protocol/${u.company_slug}`} className="block px-3 py-2 hover:bg-white/[0.02]">
                      <div className="flex items-center gap-1.5">
                        <Lock className="w-2.5 h-2.5 text-amber-300" />
                        <span className="text-[11px] font-medium text-white truncate">{co?.name || u.company_slug}</span>
                        <span className="text-[9px] text-muted-foreground ml-auto tabular-nums">in {d}d</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground/85 mt-0.5">
                        {u.next_unlock_pct_supply != null ? `${u.next_unlock_pct_supply}% of supply` : "size unknown"} · {new Date(u.next_unlock_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
            <Link to="/book/calendar" className="block px-3 py-2 text-center text-[10px] text-primary hover:bg-primary/5 border-t border-white/[0.04]">
              Open full calendar →
            </Link>
          </div>
        </div>
      </div>

      {/* Footer link strip — drill-deeper */}
      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-white/[0.04]">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Deep dives</span>
        <Link to="/book/security" className="text-[11px] px-2 py-1 rounded border border-white/[0.08] hover:border-primary/40 hover:bg-white/[0.03] text-muted-foreground hover:text-white inline-flex items-center gap-1.5">
          <ShieldCheck className="w-3 h-3" /> Security
        </Link>
        <Link to="/book/news" className="text-[11px] px-2 py-1 rounded border border-white/[0.08] hover:border-primary/40 hover:bg-white/[0.03] text-muted-foreground hover:text-white inline-flex items-center gap-1.5">
          <Newspaper className="w-3 h-3" /> News
        </Link>
        <Link to="/book/growth" className="text-[11px] px-2 py-1 rounded border border-white/[0.08] hover:border-primary/40 hover:bg-white/[0.03] text-muted-foreground hover:text-white inline-flex items-center gap-1.5">
          <TrendingUp className="w-3 h-3" /> Growth
        </Link>
        <Link to="/book/calendar" className="text-[11px] px-2 py-1 rounded border border-white/[0.08] hover:border-primary/40 hover:bg-white/[0.03] text-muted-foreground hover:text-white inline-flex items-center gap-1.5">
          <Calendar className="w-3 h-3" /> Calendar
        </Link>
      </div>
    </div>
  );
}

function Th({ children, onClick, active, className }: { children: React.ReactNode; onClick?: () => void; active?: boolean; className?: string }) {
  return (
    <th className={className}>
      <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 ${onClick ? "hover:text-white cursor-pointer" : "cursor-default"} ${active ? "text-primary" : ""}`}>
        {children}
        {active && <Dot className="w-3 h-3" />}
      </button>
    </th>
  );
}

function FilterButton({ children, active, onClick, tone }: { children: React.ReactNode; active: boolean; onClick: () => void; tone?: "alert" | "warn" }) {
  const activeCls = tone === "alert" ? "bg-rose-500/15 text-rose-200 border-rose-500/40" : tone === "warn" ? "bg-amber-500/15 text-amber-200 border-amber-500/35" : "bg-primary/15 text-primary border-primary/30";
  return (
    <button type="button" onClick={onClick} className={`text-[10.5px] px-2 py-1 rounded border font-medium transition-colors ${active ? activeCls : "border-white/[0.08] text-muted-foreground hover:text-white hover:border-white/15"}`}>
      {children}
    </button>
  );
}

function KpiTile({ label, value, delta, hint, spark, tone }: { label: string; value: string; delta?: number | null; hint?: string; spark?: Array<{ y: number }>; tone: "good" | "warn" | "alert" | "neutral" }) {
  const cls = ({ neutral: "border-white/[0.06] bg-white/[0.02]", good: "border-emerald-500/20 bg-emerald-500/[0.03]", warn: "border-amber-500/25 bg-amber-500/[0.03]", alert: "border-rose-500/30 bg-rose-500/[0.05]" } as Record<string, string>)[tone];
  const valCls = ({ neutral: "text-white", good: "text-white", warn: "text-amber-100", alert: "text-rose-200" } as Record<string, string>)[tone];
  const sparkColor = tone === "alert" ? "#f43f5e" : tone === "warn" ? "#fbbf24" : (delta ?? 0) >= 0 ? "#10b981" : "#f43f5e";
  return (
    <div className={`rounded-md border px-3 py-2.5 ${cls}`}>
      <div className="flex items-baseline gap-2">
        <span className="text-[9.5px] uppercase tracking-[0.08em] font-medium text-muted-foreground/90">{label}</span>
        {delta != null && (
          <span className={`text-[10px] font-semibold tabular-nums ${delta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
            {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
          </span>
        )}
      </div>
      <div className={`text-[20px] leading-none font-bold tabular-nums mt-1.5 ${valCls}`}>{value}</div>
      {spark && spark.length > 1 ? (
        <div className="h-[18px] mt-1.5">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`kpi-${label}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sparkColor} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="y" stroke={sparkColor} strokeWidth={1.25} fill={`url(#kpi-${label})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : hint ? (
        <div className="text-[10px] text-muted-foreground/80 mt-1.5">{hint}</div>
      ) : null}
    </div>
  );
}

function BriefBar({ brief, expanded, onToggle, refreshing }: { brief: FundBrief; expanded: boolean; onToggle: () => void; refreshing: boolean }) {
  const rating = brief.posture_rating || "solid";
  const ratingTone =
    rating === "strong" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" :
    rating === "solid" ? "border-sky-500/25 bg-sky-500/10 text-sky-200" :
    rating === "concerning" ? "border-amber-500/30 bg-amber-500/10 text-amber-200" :
    rating === "weak" ? "border-orange-500/30 bg-orange-500/10 text-orange-200" :
    "border-rose-500/40 bg-rose-500/10 text-rose-200";
  return (
    <div className="as-card p-0 overflow-hidden border-primary/15">
      <button onClick={onToggle} className="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/[0.02] text-left">
        <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-[10px] uppercase tracking-[0.1em] font-bold text-primary/90 shrink-0">AI brief</span>
        <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border ${ratingTone} shrink-0`}>{rating}</span>
        <span className="text-[12px] text-white/90 truncate flex-1">{brief.headline || "Tap to expand"}</span>
        {refreshing && <RefreshCw className="w-3 h-3 text-primary animate-spin" />}
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && brief.sections && (
        <div className="px-4 pb-4 pt-2 border-t border-white/[0.04] space-y-3">
          {(brief.sections.overview || brief.sections.aggregate) && <BriefSection label="Overview" body={brief.sections.overview || brief.sections.aggregate!} />}
          {brief.sections.security && <BriefSection label="Security" body={brief.sections.security} />}
          {brief.sections.growth && <BriefSection label="Growth" body={brief.sections.growth} />}
          {brief.sections.concentration && <BriefSection label="Concentration" body={brief.sections.concentration} />}
          {brief.sections.calendar && <BriefSection label="Calendar" body={brief.sections.calendar} />}
          {brief.sections.bottom_line && <BriefSection label="Bottom line" body={brief.sections.bottom_line} accent />}
        </div>
      )}
    </div>
  );
}

function BriefSection({ label, body, accent }: { label: string; body: string; accent?: boolean }) {
  return (
    <div className={accent ? "border-l-2 border-primary/40 pl-3" : "border-l-2 border-white/[0.08] pl-3"}>
      <div className={`text-[9.5px] uppercase tracking-[0.1em] font-bold mb-0.5 ${accent ? "text-primary/90" : "text-muted-foreground"}`}>{label}</div>
      <p className="text-[12.5px] text-white/85 leading-relaxed">{body}</p>
    </div>
  );
}

function Spark({ data, positive }: { data: Array<{ y: number }>; positive: boolean }) {
  if (!data || data.length < 2) return <span className="text-muted-foreground/30 text-[10px]">—</span>;
  const color = positive ? "#10b981" : "#f43f5e";
  return (
    <div className="h-5 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 1, right: 1, left: 1, bottom: 1 }}>
          <Line type="monotone" dataKey="y" stroke={color} strokeWidth={1.25} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RiskTrendSpark({ data }: { data: Array<{ y: number }> }) {
  if (!data || data.length < 2) return <span className="text-muted-foreground/30 text-[10px]">—</span>;
  // Risk UP = worse (red), DOWN = better (green)
  const delta = data[data.length - 1].y - data[0].y;
  const color = delta > 1 ? "#f43f5e" : delta < -1 ? "#10b981" : "#94a3b8";
  return (
    <div className="h-5 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 1, right: 1, left: 1, bottom: 1 }}>
          <Line type="monotone" dataKey="y" stroke={color} strokeWidth={1.25} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RiskScoreBadge({ score, band }: { score: number | null; band: string | null }) {
  if (score == null) return <span className="text-muted-foreground/40 text-[10px]">—</span>;
  const cls = band === "critical" ? "bg-rose-500/20 text-rose-200 border-rose-500/40" :
    band === "high" ? "bg-orange-500/15 text-orange-200 border-orange-500/35" :
    band === "medium" ? "bg-amber-500/15 text-amber-200 border-amber-500/30" :
    "bg-emerald-500/15 text-emerald-200 border-emerald-500/30";
  return <span className={`inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 rounded border text-[11px] font-bold tabular-nums ${cls}`}>{score}</span>;
}

function FindingsCell({ critical, high, auditDate }: { critical: number; high: number; auditDate?: string | null }) {
  if (critical === 0 && high === 0) return <span className="text-emerald-500/60 text-[10px]">clean</span>;
  const months = auditDate ? Math.floor((Date.now() - new Date(auditDate).getTime()) / (30 * 86400000)) : null;
  const stale = months != null && months >= 6;
  const tooltip = auditDate
    ? `Unresolved as of audit (${months}mo ago). Patch status not verified live.`
    : "Unresolved as of latest audit. Patch status not verified live.";
  return (
    <div className="inline-flex items-center gap-1" title={tooltip}>
      {critical > 0 && (
        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold tabular-nums ${stale ? "bg-rose-500/10 text-rose-200/60 border-rose-500/25" : "bg-rose-500/20 text-rose-200 border-rose-500/40"}`}>
          {critical}C
        </span>
      )}
      {high > 0 && (
        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold tabular-nums ${stale ? "bg-orange-500/10 text-orange-200/60 border-orange-500/20" : "bg-orange-500/15 text-orange-200 border-orange-500/30"}`}>
          {high}H
        </span>
      )}
      {stale && <span className="text-[9px] text-muted-foreground/70 italic">stale</span>}
    </div>
  );
}

function PostureChip({ rating }: { rating: string | null }) {
  if (!rating) return <span className="text-muted-foreground/40 text-[10px]">—</span>;
  const meta: Record<string, { grade: string; cls: string }> = {
    strong: { grade: "A", cls: "bg-emerald-500/15 text-emerald-200 border-emerald-500/40" },
    solid: { grade: "B", cls: "bg-sky-500/15 text-sky-200 border-sky-500/35" },
    concerning: { grade: "C", cls: "bg-amber-500/15 text-amber-200 border-amber-500/35" },
    weak: { grade: "D", cls: "bg-orange-500/15 text-orange-200 border-orange-500/40" },
    critical: { grade: "F", cls: "bg-rose-500/20 text-rose-200 border-rose-500/50" },
  };
  const m = meta[rating]; if (!m) return <span className="text-muted-foreground/40 text-[10px]">—</span>;
  return <span className={`inline-flex items-center justify-center w-6 h-6 rounded border text-[11px] font-bold ${m.cls}`} title={`Posture: ${rating}`}>{m.grade}</span>;
}

function LastAuditCell({ date, firm }: { date: string | null; firm: string | null }) {
  if (!date) return <span className="text-rose-300/70 text-[10px] uppercase tracking-wider font-medium">none</span>;
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  const ago = days < 30 ? `${days}d` : days < 365 ? `${Math.floor(days / 30)}mo` : `${Math.floor(days / 365)}y`;
  const tone = days > 730 ? "text-rose-300" : days > 365 ? "text-amber-300" : "text-white/80";
  return (
    <div className="text-[10.5px] flex flex-col leading-tight">
      <span className={`${tone} font-medium tabular-nums`}>{ago} ago</span>
      <span className="text-muted-foreground/70 truncate max-w-[100px]">{firm || "—"}</span>
    </div>
  );
}

function ConcentrationBar({ label, value, max, count, color }: { label: string; value: number; max: number; count: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-[10.5px]">
      <span className="w-[90px] truncate text-white/85">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-white/[0.04] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-muted-foreground tabular-nums w-[44px] text-right">{count} · {value.toFixed(0)}%</span>
    </div>
  );
}

function ActivityCell({ kind, label, date }: { kind: string; label: string; date: string }) {
  const meta = ({
    audit: { icon: <ShieldCheck className="w-3 h-3" />, color: "text-emerald-300" },
    fund: { icon: <Banknote className="w-3 h-3" />, color: "text-sky-300" },
    hack: { icon: <Skull className="w-3 h-3" />, color: "text-rose-300" },
    anomaly: { icon: <Activity className="w-3 h-3" />, color: "text-amber-300" },
  } as Record<string, { icon: React.ReactNode; color: string }>)[kind] || { icon: <Activity className="w-3 h-3" />, color: "text-muted-foreground" };
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className={meta.color}>{meta.icon}</span>
      <span className="text-white/85 truncate max-w-[200px]">{label}</span>
      <span className="text-muted-foreground/70 ml-auto tabular-nums shrink-0">{tightAgo(date)}</span>
    </div>
  );
}
