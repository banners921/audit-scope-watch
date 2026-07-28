import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  BarChart3, PieChart as PieIcon, TrendingUp, ShieldCheck, AlertTriangle,
  Skull, Banknote, Activity, Sparkles, Settings, ArrowRight, X,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, AreaChart, Area, LineChart, Line, Legend,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { BrandLogo } from "@/components/BrandLogo";
import { canonicalCategory } from "@/lib/categories";

const PALETTE = [
  "#22D3EE", "#67E8F9", "#A78BFA", "#F472B6", "#FB923C", "#FBBF24",
  "#34D399", "#4ADE80", "#60A5FA", "#818CF8", "#F87171", "#E879F9",
];

function compactUsd(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
function bucketDate(iso: string, bucket: Bucket): string {
  if (!iso) return "";
  if (bucket === "monthly") return iso.slice(0, 7);
  if (bucket === "yearly") return iso.slice(0, 4);
  // quarterly
  const y = iso.slice(0, 4);
  const m = parseInt(iso.slice(5, 7), 10);
  const q = Math.ceil(m / 3);
  return `${y}-Q${q}`;
}

type Bucket = "monthly" | "quarterly" | "yearly";
type ChartType = "bar" | "pie";
type Width = "half" | "full";

type WidgetCfg = {
  width: Width;
  bucket?: Bucket;
  limit?: number;
  chartType?: ChartType;
  categories?: Set<string>; // empty Set = all
};

type Position = {
  company_slug: string;
  company_name: string | null;
  category: string | null;
  round_type: string | null;
  amount_usd: number | null;
  round_date: string | null;
};

const DEFAULTS: Record<string, WidgetCfg> = {
  monthly: { width: "half", bucket: "monthly" },
  cumulative: { width: "half", bucket: "monthly", categories: new Set() },
  bycat: { width: "half", limit: 12, chartType: "bar" },
  rounds: { width: "half", chartType: "pie" },
  auditors: { width: "half", limit: 10 },
  findings: { width: "half", chartType: "pie" },
  "audit-coverage": { width: "half" },
  "bounty-coverage": { width: "half" },
  biggest: { width: "half", limit: 8 },
  hacks: { width: "half", limit: 20 },
};

export default function FundAnalytics() {
  const { user } = useAuth();

  const profileQ = useQuery({
    queryKey: ["analytics-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("user_profiles").select("fund_slug").eq("user_id", user!.id).maybeSingle();
      return data as { fund_slug: string | null } | null;
    },
  });
  const fundSlug = profileQ.data?.fund_slug || null;

  const fundNameQ = useQuery({
    queryKey: ["analytics-fund-name", fundSlug],
    enabled: !!fundSlug,
    queryFn: async () => {
      const { data } = await supabase.from("funds").select("name").eq("slug", fundSlug!).maybeSingle();
      return (data?.name as string | undefined) || null;
    },
  });

  const roundsQ = useQuery({
    queryKey: ["analytics-rounds", fundSlug],
    enabled: !!fundSlug,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("fund_portfolio")
        .select("company_slug,company_name,category,round_type,amount_usd,round_date")
        .eq("fund_slug", fundSlug!);
      return (data ?? []) as Position[];
    },
  });

  const portfolioSlugs = useMemo(() => Array.from(new Set((roundsQ.data ?? []).map(r => r.company_slug).filter(Boolean))), [roundsQ.data]);

  const compsQ = useQuery({
    queryKey: ["analytics-comps", portfolioSlugs.length, portfolioSlugs.slice(0, 5).join(",")],
    enabled: portfolioSlugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("companies")
        .select("slug,name,logo,url,total_raised_usd,has_been_hacked,has_bug_bounty,last_audit_date,category")
        .in("slug", portfolioSlugs);
      const m = new Map<string, any>();
      for (const c of (data ?? []) as any[]) m.set(c.slug, c);
      return m;
    },
  });

  const auditsQ = useQuery({
    queryKey: ["analytics-audits", portfolioSlugs.length, portfolioSlugs.slice(0, 5).join(",")],
    enabled: portfolioSlugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_history")
        .select("company_slug,audit_firm,audit_date,findings_critical,findings_high,findings_medium,findings_low")
        .in("company_slug", portfolioSlugs);
      return (data ?? []) as any[];
    },
  });

  const hacksQ = useQuery({
    queryKey: ["analytics-hacks", portfolioSlugs.length, portfolioSlugs.slice(0, 5).join(",")],
    enabled: portfolioSlugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("hacks")
        .select("company_slug,name,hack_date,amount_usd,technique")
        .in("company_slug", portfolioSlugs);
      return (data ?? []) as any[];
    },
  });

  // Widget config state
  const [cfg, setCfg] = useState<Record<string, WidgetCfg>>(DEFAULTS);
  const updateCfg = (id: string, patch: Partial<WidgetCfg>) => setCfg(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  // Category universe (canonical) for filters
  const categoryUniverse = useMemo(() => {
    const s = new Set<string>();
    for (const slug of portfolioSlugs) {
      const c = compsQ.data?.get(slug);
      const cat = canonicalCategory(c?.category) || canonicalCategory(roundsQ.data?.find(r => r.company_slug === slug)?.category);
      if (cat) s.add(cat);
    }
    return Array.from(s).sort();
  }, [portfolioSlugs, compsQ.data, roundsQ.data]);

  // ---- Datasets ----
  // monthly deployed (respects bucket)
  const timeSeries = (bucket: Bucket = "monthly") => {
    const m = new Map<string, number>();
    for (const r of roundsQ.data ?? []) {
      if (!r.round_date || !r.amount_usd) continue;
      const k = bucketDate(r.round_date, bucket);
      m.set(k, (m.get(k) ?? 0) + Number(r.amount_usd));
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, amount]) => ({ k, amount }));
  };
  const monthlyDeployed = useMemo(() => timeSeries(cfg.monthly?.bucket || "monthly"), [roundsQ.data, cfg.monthly?.bucket]);

  // Cumulative deployed — multi-series. When 0/1 category selected, single line.
  // When 2+ selected, one line per category + a Total overlay.
  const cumulativeDeployed = useMemo(() => {
    const bucket = cfg.cumulative?.bucket || "monthly";
    const cats = cfg.cumulative?.categories;
    const slugCat = new Map<string, string>();
    for (const slug of portfolioSlugs) {
      const c = compsQ.data?.get(slug);
      const cat = canonicalCategory(c?.category) || canonicalCategory(roundsQ.data?.find(r => r.company_slug === slug)?.category) || "Uncategorized";
      slugCat.set(slug, cat);
    }
    // Selected categories the user wants to plot (canonical)
    const selected = cats && cats.size > 0 ? Array.from(cats) : null;
    const seriesNames: string[] = selected ?? ["Total"];
    // bucket → category → amount
    const buckets = new Map<string, Map<string, number>>();
    const allBuckets = new Set<string>();
    for (const r of roundsQ.data ?? []) {
      if (!r.round_date || !r.amount_usd) continue;
      const cat = slugCat.get(r.company_slug) || "Uncategorized";
      if (selected && !selected.includes(cat)) continue;
      const k = bucketDate(r.round_date, bucket);
      allBuckets.add(k);
      if (!buckets.has(k)) buckets.set(k, new Map());
      const m = buckets.get(k)!;
      const seriesKey = selected ? cat : "Total";
      m.set(seriesKey, (m.get(seriesKey) ?? 0) + Number(r.amount_usd));
    }
    const orderedBuckets = Array.from(allBuckets).sort((a, b) => a.localeCompare(b));
    const cum: Record<string, number> = {};
    seriesNames.forEach(s => { cum[s] = 0; });
    const out: any[] = [];
    for (const k of orderedBuckets) {
      const row: any = { k };
      const m = buckets.get(k);
      let total = 0;
      for (const s of seriesNames) {
        const inc = m?.get(s) ?? 0;
        cum[s] += inc;
        row[s] = cum[s];
        total += cum[s];
      }
      if (selected && selected.length >= 2) row["Total"] = total;
      out.push(row);
    }
    return { data: out, seriesNames, includeTotal: !!(selected && selected.length >= 2) };
  }, [roundsQ.data, portfolioSlugs, compsQ.data, cfg.cumulative?.bucket, cfg.cumulative?.categories]);

  const byCategory = useMemo(() => {
    const m = new Map<string, { amount: number; count: number }>();
    for (const slug of portfolioSlugs) {
      const c = compsQ.data?.get(slug);
      const cat = c?.category || roundsQ.data?.find(r => r.company_slug === slug)?.category || "Uncategorized";
      const total = (roundsQ.data ?? []).filter(r => r.company_slug === slug).reduce((s, r) => s + (r.amount_usd || 0), 0);
      const cur = m.get(cat) ?? { amount: 0, count: 0 };
      m.set(cat, { amount: cur.amount + total, count: cur.count + 1 });
    }
    return Array.from(m.entries())
      .map(([category, v]) => ({ category, amount: v.amount, count: v.count }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, cfg.bycat?.limit ?? 12);
  }, [portfolioSlugs, compsQ.data, roundsQ.data, cfg.bycat?.limit]);

  const byRoundType = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of roundsQ.data ?? []) {
      const rt = (r.round_type || "Other").trim();
      m.set(rt, (m.get(rt) ?? 0) + 1);
    }
    return Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [roundsQ.data]);

  const topAuditors = useMemo(() => {
    const m = new Map<string, { audits: number; companies: Set<string> }>();
    for (const a of auditsQ.data ?? []) {
      const f = (a.audit_firm || "").trim();
      if (!f) continue;
      const cur = m.get(f) ?? { audits: 0, companies: new Set<string>() };
      cur.audits++;
      if (a.company_slug) cur.companies.add(a.company_slug);
      m.set(f, cur);
    }
    return Array.from(m.entries())
      .map(([firm, v]) => ({ firm, audits: v.audits, companies: v.companies.size }))
      .sort((a, b) => b.audits - a.audits)
      .slice(0, cfg.auditors?.limit ?? 10);
  }, [auditsQ.data, cfg.auditors?.limit]);

  const findingsBreakdown = useMemo(() => {
    let c = 0, h = 0, mm = 0, l = 0;
    for (const a of auditsQ.data ?? []) {
      c += Number(a.findings_critical ?? 0);
      h += Number(a.findings_high ?? 0);
      mm += Number(a.findings_medium ?? 0);
      l += Number(a.findings_low ?? 0);
    }
    return [
      { name: "Critical", value: c, color: "#F87171" },
      { name: "High", value: h, color: "#FB923C" },
      { name: "Medium", value: mm, color: "#FBBF24" },
      { name: "Low", value: l, color: "#67E8F9" },
    ];
  }, [auditsQ.data]);

  const auditCoverage = useMemo(() => {
    const auditedSlugs = new Set((auditsQ.data ?? []).map((a: any) => a.company_slug));
    const audited = portfolioSlugs.filter(s => auditedSlugs.has(s)).length;
    const unaudited = portfolioSlugs.length - audited;
    return [
      { name: "Audited", value: audited, color: "#22D3EE" },
      { name: "Unaudited", value: unaudited, color: "#FB7185" },
    ];
  }, [auditsQ.data, portfolioSlugs]);

  const bountyCoverage = useMemo(() => {
    let with_bounty = 0;
    for (const slug of portfolioSlugs) {
      const c = compsQ.data?.get(slug);
      if (c?.has_bug_bounty) with_bounty++;
    }
    return [
      { name: "Active bounty", value: with_bounty, color: "#34D399" },
      { name: "No bounty", value: portfolioSlugs.length - with_bounty, color: "#9CA3AF" },
    ];
  }, [portfolioSlugs, compsQ.data]);

  const hackExposure = useMemo(() => {
    return (hacksQ.data ?? []).map((h: any) => ({
      slug: h.company_slug, name: h.name, date: h.hack_date,
      amount: Number(h.amount_usd) || 0, technique: h.technique || "—",
    })).sort((a: any, b: any) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, cfg.hacks?.limit ?? 20);
  }, [hacksQ.data, cfg.hacks?.limit]);

  const biggestRaises = useMemo(() => {
    return (roundsQ.data ?? [])
      .filter(r => r.amount_usd && r.amount_usd > 0)
      .map(r => ({
        slug: r.company_slug, name: r.company_name || r.company_slug,
        amount: Number(r.amount_usd), date: r.round_date, type: r.round_type,
        logo: compsQ.data?.get(r.company_slug)?.logo ?? null,
        url: compsQ.data?.get(r.company_slug)?.url ?? null,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, cfg.biggest?.limit ?? 8);
  }, [roundsQ.data, compsQ.data, cfg.biggest?.limit]);

  const kpis = useMemo(() => {
    const positions = portfolioSlugs.length;
    const totalDeployed = (roundsQ.data ?? []).reduce((s, r) => s + (Number(r.amount_usd) || 0), 0);
    const rounds = (roundsQ.data ?? []).length;
    const audited = (auditsQ.data ?? []).reduce((acc: Set<string>, a: any) => { if (a.company_slug) acc.add(a.company_slug); return acc; }, new Set<string>()).size;
    const hacked = (hacksQ.data ?? []).reduce((acc: Set<string>, a: any) => { if (a.company_slug) acc.add(a.company_slug); return acc; }, new Set<string>()).size;
    return { positions, totalDeployed, rounds, audited, hacked, auditedPct: positions ? Math.round((audited / positions) * 100) : 0 };
  }, [portfolioSlugs.length, roundsQ.data, auditsQ.data, hacksQ.data]);

  const widthCls = (id: string) => cfg[id]?.width === "full" ? "xl:col-span-2" : "";

  if (!fundSlug) {
    return (
      <div className="max-w-[800px] mx-auto py-10 text-center">
        <Sparkles className="w-6 h-6 text-primary mx-auto mb-2" />
        <h1 className="text-lg font-semibold text-white">Analytics</h1>
        <p className="text-[12px] text-muted-foreground mt-2">Set your fund on your <Link to="/profile" className="text-primary hover:underline">profile</Link> to unlock portfolio analytics.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1600px]">
      <header className="space-y-1">
        <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary">Fund analytics</div>
        <h1 className="text-xl font-semibold text-white tracking-tight">{fundNameQ.data || fundSlug}</h1>
        <p className="text-[11px] text-muted-foreground">Portfolio breakdown · funding shape · security posture across your investments</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Kpi label="Positions" value={String(kpis.positions)} />
        <Kpi label="Total deployed" value={compactUsd(kpis.totalDeployed)} accent />
        <Kpi label="Rounds" value={String(kpis.rounds)} />
        <Kpi label="Audited coverage" value={`${kpis.auditedPct}%`} sub={`${kpis.audited} of ${kpis.positions}`} />
        <Kpi label="Hack exposure" value={String(kpis.hacked)} sub={kpis.hacked === 1 ? "company" : "companies"} tone={kpis.hacked > 0 ? "alert" : "neutral"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <Widget id="monthly" title="Funding deployed over time" icon={<BarChart3 className="w-3.5 h-3.5" />} sub="Sum of round amounts per period"
          sizeClass={widthCls("monthly")}
          cfg={cfg.monthly} updateCfg={(p) => updateCfg("monthly", p)}
          configRender={() => <BucketField cfg={cfg.monthly} updateCfg={(p) => updateCfg("monthly", p)} />}>
          {monthlyDeployed.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthlyDeployed} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <defs>
                  <linearGradient id="amt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#67E8F9" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="#22D3EE" stopOpacity={0.7} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="k" stroke="#9CA3AF" fontSize={10} tickMargin={6} />
                <YAxis stroke="#9CA3AF" fontSize={10} tickFormatter={(v: number) => compactUsd(v)} width={50} />
                <Tooltip content={<ChartTooltip valueFormat={(v: any) => compactUsd(Number(v))} />} />
                <Bar dataKey="amount" fill="url(#amt)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Widget>

        <Widget id="cumulative" title="Cumulative deployed" icon={<TrendingUp className="w-3.5 h-3.5" />} sub="Total committed over time"
          sizeClass={widthCls("cumulative")}
          cfg={cfg.cumulative} updateCfg={(p) => updateCfg("cumulative", p)}
          configRender={() => (
            <>
              <BucketField cfg={cfg.cumulative} updateCfg={(p) => updateCfg("cumulative", p)} />
              <CategoryField label="Filter by categories" universe={categoryUniverse} selected={cfg.cumulative?.categories ?? new Set()} onChange={(s) => updateCfg("cumulative", { categories: s })} />
            </>
          )}>
          {cumulativeDeployed.data.length === 0 ? <EmptyChart /> : cumulativeDeployed.seriesNames.length === 1 && cumulativeDeployed.seriesNames[0] === "Total" ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={cumulativeDeployed.data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <defs>
                  <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22D3EE" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#22D3EE" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="k" stroke="#9CA3AF" fontSize={10} />
                <YAxis stroke="#9CA3AF" fontSize={10} tickFormatter={(v: number) => compactUsd(v)} width={50} />
                <Tooltip content={<ChartTooltip valueFormat={(v: any) => compactUsd(Number(v))} />} />
                <Area type="monotone" dataKey="Total" stroke="#22D3EE" strokeWidth={2} fill="url(#area)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={cumulativeDeployed.data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="k" stroke="#9CA3AF" fontSize={10} />
                <YAxis stroke="#9CA3AF" fontSize={10} tickFormatter={(v: number) => compactUsd(v)} width={50} />
                <Tooltip content={<ChartTooltip valueFormat={(v: any) => compactUsd(Number(v))} />} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                {cumulativeDeployed.seriesNames.map((s, i) => (
                  <Line key={s} type="monotone" dataKey={s} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} />
                ))}
                {cumulativeDeployed.includeTotal && (
                  <Line type="monotone" dataKey="Total" stroke="#FFFFFF" strokeWidth={2} strokeDasharray="6 3" dot={false} />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </Widget>

        <Widget id="bycat" title="By category" icon={<PieIcon className="w-3.5 h-3.5" />} sub="Capital + positions per sector"
          sizeClass={widthCls("bycat")}
          cfg={cfg.bycat} updateCfg={(p) => updateCfg("bycat", p)}
          configRender={() => <LimitField label="Show top" cfg={cfg.bycat} updateCfg={(p) => updateCfg("bycat", p)} options={[5, 8, 10, 12, 15, 20]} />}>
          {byCategory.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={byCategory} layout="vertical" margin={{ top: 4, right: 30, left: 80, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" stroke="#9CA3AF" fontSize={10} tickFormatter={(v: number) => compactUsd(v)} />
                <YAxis type="category" dataKey="category" stroke="#9CA3AF" fontSize={10} width={80} />
                <Tooltip content={<ChartTooltip valueFormat={(v: any, p: any) => `${compactUsd(Number(v))} · ${p?.payload?.count} co${p?.payload?.count === 1 ? "" : "s"}`} />} />
                <Bar dataKey="amount" radius={[0, 3, 3, 0]}>
                  {byCategory.map((_d, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Widget>

        <Widget id="rounds" title="Round-type mix" icon={<Activity className="w-3.5 h-3.5" />} sub="Distribution of round stages"
          sizeClass={widthCls("rounds")}
          cfg={cfg.rounds} updateCfg={(p) => updateCfg("rounds", p)}
          configRender={() => <ChartTypeField cfg={cfg.rounds} updateCfg={(p) => updateCfg("rounds", p)} />}>
          {byRoundType.length === 0 ? <EmptyChart /> : cfg.rounds?.chartType === "bar" ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byRoundType} margin={{ top: 4, right: 16, left: 0, bottom: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" stroke="#9CA3AF" fontSize={9} interval={0} angle={-25} textAnchor="end" />
                <YAxis stroke="#9CA3AF" fontSize={10} />
                <Tooltip content={<ChartTooltip valueFormat={(v: any) => `${v} round${v === 1 ? "" : "s"}`} />} />
                <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                  {byRoundType.map((_d, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <PieWithLegend data={byRoundType} valueLabel={(v) => `${v} round${v === 1 ? "" : "s"}`} />
          )}
        </Widget>

        <Widget id="auditors" title="Auditors your portfolio uses" icon={<ShieldCheck className="w-3.5 h-3.5" />} sub="Audit firms by your-portfolio footprint"
          sizeClass={widthCls("auditors")}
          cfg={cfg.auditors} updateCfg={(p) => updateCfg("auditors", p)}
          configRender={() => <LimitField label="Show top" cfg={cfg.auditors} updateCfg={(p) => updateCfg("auditors", p)} options={[5, 8, 10, 15, 20]} />}>
          {topAuditors.length === 0 ? <EmptyChart label="No audits captured for portfolio yet" /> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topAuditors} layout="vertical" margin={{ top: 4, right: 30, left: 110, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" stroke="#9CA3AF" fontSize={10} />
                <YAxis type="category" dataKey="firm" stroke="#9CA3AF" fontSize={10} width={110} />
                <Tooltip content={<ChartTooltip valueFormat={(v: any, p: any) => `${v} audits · ${p?.payload?.companies} cos`} />} />
                <Bar dataKey="audits" fill="#22D3EE" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Widget>

        <Widget id="findings" title="Findings severity mix" icon={<AlertTriangle className="w-3.5 h-3.5" />} sub="Cumulative findings across portfolio audits"
          sizeClass={widthCls("findings")}
          cfg={cfg.findings} updateCfg={(p) => updateCfg("findings", p)}
          configRender={() => <ChartTypeField cfg={cfg.findings} updateCfg={(p) => updateCfg("findings", p)} />}>
          {findingsBreakdown.every(d => d.value === 0) ? <EmptyChart label="No findings extracted yet" /> : cfg.findings?.chartType === "bar" ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={findingsBreakdown} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} />
                <YAxis stroke="#9CA3AF" fontSize={10} />
                <Tooltip content={<ChartTooltip valueFormat={(v: any) => `${v} findings`} />} />
                <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                  {findingsBreakdown.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <PieWithLegend data={findingsBreakdown.map(d => ({ name: d.name, value: d.value, color: d.color }))} valueLabel={(v) => `${v} findings`} />
          )}
        </Widget>

        <Widget id="audit-coverage" title="Audit coverage" icon={<ShieldCheck className="w-3.5 h-3.5" />} sub="Audited vs unaudited share"
          sizeClass={widthCls("audit-coverage")} cfg={cfg["audit-coverage"]} updateCfg={(p) => updateCfg("audit-coverage", p)}>
          <PieWithLegend data={auditCoverage.map(d => ({ name: d.name, value: d.value, color: d.color }))} valueLabel={(v) => `${v} co${v === 1 ? "" : "s"}`} />
        </Widget>

        <Widget id="bounty-coverage" title="Bug-bounty coverage" icon={<Sparkles className="w-3.5 h-3.5" />} sub="Active vs no-bounty share"
          sizeClass={widthCls("bounty-coverage")} cfg={cfg["bounty-coverage"]} updateCfg={(p) => updateCfg("bounty-coverage", p)}>
          <PieWithLegend data={bountyCoverage.map(d => ({ name: d.name, value: d.value, color: d.color }))} valueLabel={(v) => `${v} co${v === 1 ? "" : "s"}`} />
        </Widget>

        <Widget id="biggest" title="Biggest raises (your tickets)" icon={<Banknote className="w-3.5 h-3.5" />} sub="Largest amounts the fund participated in"
          sizeClass={widthCls("biggest")} cfg={cfg.biggest} updateCfg={(p) => updateCfg("biggest", p)}
          configRender={() => <LimitField label="Show" cfg={cfg.biggest} updateCfg={(p) => updateCfg("biggest", p)} options={[5, 8, 10, 15, 25]} />}>
          {biggestRaises.length === 0 ? <EmptyChart /> : (
            <div className="divide-y divide-white/[0.04] max-h-[300px] overflow-y-auto">
              {biggestRaises.map((r) => (
                <Link key={`${r.slug}-${r.date}-${r.amount}`} to={`/protocol/${r.slug}`} className="flex items-center gap-3 px-1 py-2 hover:bg-white/[0.02]">
                  <BrandLogo name={r.name} url={r.url} logo={r.logo} className="w-7 h-7 rounded-md shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] text-white truncate hover:text-primary">{r.name}</div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">{r.type || "round"} · {r.date || "—"}</div>
                  </div>
                  <span className="text-[13px] font-bold text-emerald-300 tabular-nums">{compactUsd(r.amount)}</span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground" />
                </Link>
              ))}
            </div>
          )}
        </Widget>

        <Widget id="hacks" title="Hack exposure" icon={<Skull className="w-3.5 h-3.5" />} sub="Portfolio companies that experienced incidents"
          sizeClass={widthCls("hacks")} cfg={cfg.hacks} updateCfg={(p) => updateCfg("hacks", p)}
          configRender={() => <LimitField label="Show" cfg={cfg.hacks} updateCfg={(p) => updateCfg("hacks", p)} options={[10, 20, 50, 100]} />}>
          {hackExposure.length === 0 ? <EmptyChart label="No hacks recorded in portfolio" /> : (
            <div className="divide-y divide-white/[0.04] max-h-[300px] overflow-y-auto">
              {hackExposure.map((h, i) => (
                <Link key={i} to={h.slug ? `/protocol/${h.slug}` : "#"} className="flex items-center gap-3 px-1 py-2 hover:bg-white/[0.02]">
                  <Skull className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] text-white truncate hover:text-primary">{h.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{h.technique} · {h.date}</div>
                  </div>
                  <span className="text-[12px] text-rose-300 tabular-nums">{compactUsd(h.amount)}</span>
                </Link>
              ))}
            </div>
          )}
        </Widget>
      </div>
    </div>
  );
}

// ============== Widget shell + config popover ==============
function Widget({ id, title, icon, sub, children, sizeClass, cfg, updateCfg, configRender }: {
  id: string; title: string; icon: React.ReactNode; sub?: string; children: React.ReactNode;
  sizeClass?: string;
  cfg: WidgetCfg | undefined;
  updateCfg: (p: Partial<WidgetCfg>) => void;
  configRender?: () => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div className={`as-card p-0 overflow-hidden flex flex-col ${sizeClass || ""}`} data-widget={id}>
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2 relative">
        <div className="text-primary">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-white tracking-tight truncate">{title}</div>
          {sub && <div className="text-[10px] text-muted-foreground truncate">{sub}</div>}
        </div>
        <button type="button" onClick={() => setOpen(v => !v)} title="Configure" className="text-muted-foreground hover:text-primary p-1 rounded hover:bg-white/[0.04]">
          <Settings className="w-3.5 h-3.5" />
        </button>
        {open && (
          <div ref={popRef} className="absolute top-full right-3 mt-1.5 z-30 w-72 rounded-md border border-white/[0.1] bg-[#0e1116] shadow-xl">
            <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between">
              <div className="text-[10.5px] uppercase tracking-wider font-semibold text-white">Configure</div>
              <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-white"><X className="w-3 h-3" /></button>
            </div>
            <div className="p-3 space-y-3">
              <WidthField cfg={cfg} updateCfg={updateCfg} />
              {configRender && configRender()}
            </div>
          </div>
        )}
      </div>
      <div className="p-4 flex-1">{children}</div>
    </div>
  );
}

function WidthField({ cfg, updateCfg }: { cfg: WidgetCfg | undefined; updateCfg: (p: Partial<WidgetCfg>) => void }) {
  return (
    <Field label="Width">
      <Pills value={cfg?.width || "half"} onChange={(v) => updateCfg({ width: v as Width })} options={[{ v: "half", label: "Half" }, { v: "full", label: "Full" }]} />
    </Field>
  );
}
function BucketField({ cfg, updateCfg }: { cfg: WidgetCfg | undefined; updateCfg: (p: Partial<WidgetCfg>) => void }) {
  return (
    <Field label="Time bucket">
      <Pills value={cfg?.bucket || "monthly"} onChange={(v) => updateCfg({ bucket: v as Bucket })} options={[{ v: "monthly", label: "Monthly" }, { v: "quarterly", label: "Quarterly" }, { v: "yearly", label: "Yearly" }]} />
    </Field>
  );
}
function ChartTypeField({ cfg, updateCfg }: { cfg: WidgetCfg | undefined; updateCfg: (p: Partial<WidgetCfg>) => void }) {
  return (
    <Field label="Chart type">
      <Pills value={cfg?.chartType || "pie"} onChange={(v) => updateCfg({ chartType: v as ChartType })} options={[{ v: "pie", label: "Pie" }, { v: "bar", label: "Bar" }]} />
    </Field>
  );
}
function LimitField({ label, cfg, updateCfg, options }: { label: string; cfg: WidgetCfg | undefined; updateCfg: (p: Partial<WidgetCfg>) => void; options: number[] }) {
  return (
    <Field label={label}>
      <Pills value={String(cfg?.limit ?? options[Math.floor(options.length / 2)])} onChange={(v) => updateCfg({ limit: Number(v) })} options={options.map(o => ({ v: String(o), label: String(o) }))} />
    </Field>
  );
}
function CategoryField({ label, universe, selected, onChange }: { label: string; universe: string[]; selected: Set<string>; onChange: (s: Set<string>) => void }) {
  const toggle = (c: string) => {
    const next = new Set(selected);
    if (next.has(c)) next.delete(c); else next.add(c);
    onChange(next);
  };
  return (
    <Field label={`${label} ${selected.size > 0 ? `(${selected.size})` : "(all)"}`}>
      <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
        {universe.length === 0 && <span className="text-[10px] text-muted-foreground italic">No categories yet</span>}
        {universe.map((c) => {
          const on = selected.has(c);
          return (
            <button key={c} type="button" onClick={() => toggle(c)} className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${on ? "bg-primary/15 text-primary border-primary/40" : "bg-white/[0.03] text-white/75 border-white/[0.08] hover:border-white/20"}`}>
              {c}
            </button>
          );
        })}
        {selected.size > 0 && (
          <button type="button" onClick={() => onChange(new Set())} className="text-[10px] text-muted-foreground hover:text-white underline ml-1">Clear</button>
        )}
      </div>
    </Field>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{label}</div>
      {children}
    </div>
  );
}
function Pills({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { v: string; label: string }[] }) {
  return (
    <div className="inline-flex rounded-md bg-white/[0.03] border border-white/[0.08] p-0.5 text-[11px] flex-wrap gap-0.5">
      {options.map((o) => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)} className={`px-2 py-1 rounded transition-colors ${value === o.v ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-white"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PieWithLegend({ data, valueLabel }: { data: { name: string; value: number; color?: string }[]; valueLabel: (v: number) => string }) {
  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width="55%" height={240}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" outerRadius={90} innerRadius={50} stroke="rgba(0,0,0,0.4)" strokeWidth={2}>
            {data.map((d, i) => <Cell key={i} fill={d.color || PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip content={<ChartTooltip valueFormat={(v: any) => valueLabel(Number(v))} />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex-1 space-y-1.5">
        {data.map((d, i) => (
          <div key={d.name} className="flex items-center gap-2 text-[11px]">
            <span className="w-2 h-2 rounded-sm" style={{ background: d.color || PALETTE[i % PALETTE.length] }} />
            <span className="text-white/80 flex-1 truncate">{d.name}</span>
            <span className="text-muted-foreground tabular-nums">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, accent, tone }: { label: string; value: string; sub?: string; accent?: boolean; tone?: "alert" | "neutral" }) {
  const valueCls = tone === "alert" && value !== "0" ? "text-rose-300" : accent ? "text-emerald-300" : "text-white";
  return (
    <div className="as-card p-3">
      <div className="text-[9.5px] uppercase tracking-[0.1em] font-semibold text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-0.5 ${valueCls}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function EmptyChart({ label = "No data yet" }: { label?: string }) {
  return <div className="h-[200px] flex items-center justify-center text-[11px] text-muted-foreground italic">{label}</div>;
}

function ChartTooltip({ active, payload, label, valueFormat }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="as-card p-2 text-[11px] border border-white/[0.1] bg-[#0e1116]/95">
      {label && <div className="text-muted-foreground text-[10px] mb-0.5">{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-sm" style={{ background: p.color || p.fill || "#22D3EE" }} />
          <span className="text-white/85">{p.name}:</span>
          <span className="text-white font-medium tabular-nums">{valueFormat ? valueFormat(p.value, p) : p.value}</span>
        </div>
      ))}
    </div>
  );
}
