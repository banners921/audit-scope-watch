import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { TrendingUp, TrendingDown, Banknote, Users, ArrowRight } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, Tooltip as ReTooltip, XAxis, YAxis, BarChart, Bar, Cell } from "recharts";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";
import { BookTabs } from "@/components/BookTabs";
import { useFundSlug, usePortfolioSlugs, usePortfolioCompanies } from "@/lib/usePortfolioSlugs";

function compactUsd(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n === 0) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export default function BookGrowth() {
  const fundSlug = useFundSlug();
  const slugsQ = usePortfolioSlugs(fundSlug);
  const slugs = slugsQ.data ?? [];
  const companiesQ = usePortfolioCompanies(slugs);
  const companiesMap = companiesQ.data ?? new Map();

  // 90d TVL by position
  const tvlSeriesQ = useQuery({
    queryKey: ["bgrowth-tvl-series", slugs.length],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("protocol_metrics").select("company_slug,tvl,date")
        .in("company_slug", slugs).not("tvl", "is", null)
        .gte("date", cutoff).order("date", { ascending: true });
      const bySlug = new Map<string, Array<{ date: string; tvl: number }>>();
      for (const r of (data ?? []) as any[]) {
        const arr = bySlug.get(r.company_slug) ?? [];
        arr.push({ date: r.date, tvl: Number(r.tvl) });
        bySlug.set(r.company_slug, arr);
      }
      // Aggregate book TVL
      const byDate = new Map<string, number>();
      for (const r of (data ?? []) as any[]) byDate.set(r.date, (byDate.get(r.date) ?? 0) + Number(r.tvl || 0));
      const aggregate = Array.from(byDate.entries()).map(([date, tvl]) => ({ date, tvl })).sort((a, b) => a.date.localeCompare(b.date));
      return { bySlug, aggregate };
    },
  });

  const economicsQ = useQuery({
    queryKey: ["bgrowth-economics", slugs.length],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("protocol_economics").select("company_slug,revenue_30d,revenue_1y,fees_30d,treasury_usd,mcap,fdv")
        .in("company_slug", slugs);
      return (data ?? []) as any[];
    },
  });

  const fundingQ = useQuery({
    queryKey: ["bgrowth-funding", slugs.length],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("funding_rounds").select("company_slug,amount_usd,round_type,date,lead_investor,investors")
        .in("company_slug", slugs).gte("date", cutoff).order("date", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  const hiringQ = useQuery({
    queryKey: ["bgrowth-hiring", slugs.length],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("hiring_aggregates").select("company_slug,role_count,smart_contract_count")
        .in("company_slug", slugs).order("role_count", { ascending: false, nullsFirst: false });
      return (data ?? []) as any[];
    },
  });

  // Top TVL movers (30d)
  const movers = useMemo(() => {
    if (!tvlSeriesQ.data) return { up: [], down: [] };
    const rows: Array<{ slug: string; name: string; pct: number; latest: number; logo: string | null; url: string | null }> = [];
    for (const [slug, arr] of tvlSeriesQ.data.bySlug) {
      if (arr.length < 2) continue;
      const latest = arr.at(-1)!.tvl;
      if (latest < 1_000_000) continue;
      const targetTime = new Date(arr.at(-1)!.date).getTime() - 30 * 86400000;
      const prev = arr.find(r => Math.abs(new Date(r.date).getTime() - targetTime) < 7 * 86400000);
      if (!prev || prev.tvl <= 0) continue;
      const pct = ((latest - prev.tvl) / prev.tvl) * 100;
      const co = companiesMap.get(slug);
      rows.push({ slug, name: co?.name || slug, pct, latest, logo: co?.logo || null, url: co?.url || null });
    }
    const up = rows.filter(r => r.pct >= 10).sort((a, b) => b.pct - a.pct).slice(0, 10);
    const down = rows.filter(r => r.pct <= -10).sort((a, b) => a.pct - b.pct).slice(0, 10);
    return { up, down };
  }, [tvlSeriesQ.data, companiesMap]);

  const topRevenue = useMemo(() => {
    return (economicsQ.data ?? [])
      .filter((e: any) => (e.revenue_30d ?? 0) > 0)
      .sort((a: any, b: any) => (b.revenue_30d ?? 0) - (a.revenue_30d ?? 0))
      .slice(0, 10)
      .map((e: any) => ({ ...e, name: companiesMap.get(e.company_slug)?.name || e.company_slug, logo: companiesMap.get(e.company_slug)?.logo, url: companiesMap.get(e.company_slug)?.url }));
  }, [economicsQ.data, companiesMap]);

  const aggTvl = tvlSeriesQ.data?.aggregate ?? [];
  const latestTvl = aggTvl.at(-1)?.tvl ?? null;
  const firstTvl = aggTvl.at(0)?.tvl ?? null;
  const tvlPct = latestTvl && firstTvl && firstTvl > 0 ? ((latestTvl - firstTvl) / firstTvl) * 100 : null;

  const totalRaised = useMemo(() => (fundingQ.data ?? []).reduce((s: number, r: any) => s + (Number(r.amount_usd) || 0), 0), [fundingQ.data]);
  const totalRevenue30d = useMemo(() => (economicsQ.data ?? []).reduce((s: number, e: any) => s + (Number(e.revenue_30d) || 0), 0), [economicsQ.data]);

  if (!fundSlug) {
    return (
      <div className="space-y-4 max-w-4xl">
        <BookTabs />
        <div className="as-card p-8 text-center text-sm text-muted-foreground">Set your fund on <Link to="/profile" className="text-primary hover:underline">your profile</Link> to see your portfolio growth view.</div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-[1600px]">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <BookTabs />
        <span className="text-[11px] text-muted-foreground">{slugs.length} positions</span>
      </div>

      <div>
        <h1 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" /> Growth signals
        </h1>
        <p className="text-xs text-muted-foreground mt-1">TVL trajectory, revenue, raises, and hiring momentum across your book.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile label="Book TVL" value={compactUsd(latestTvl)} hint={tvlPct != null ? `${tvlPct > 0 ? "+" : ""}${tvlPct.toFixed(1)}% in 90d` : "—"} tone={(tvlPct ?? 0) >= 0 ? "good" : "alert"} />
        <KpiTile label="Revenue 30d" value={compactUsd(totalRevenue30d)} hint={`${topRevenue.length} earning positions`} tone="neutral" />
        <KpiTile label="Raised 12mo" value={compactUsd(totalRaised)} hint={`${(fundingQ.data ?? []).length} rounds`} tone="neutral" />
        <KpiTile label="TVL up 10%+" value={String(movers.up.length)} hint={`${movers.down.length} down 10%+`} tone={movers.up.length >= movers.down.length ? "good" : "warn"} />
      </div>

      {/* Aggregate book TVL chart */}
      <div className="as-card p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Book TVL — 90 days</h3>
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={aggTvl} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="booktvlfull" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" stroke="#888" fontSize={10} tickFormatter={(d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" })} />
              <YAxis stroke="#888" fontSize={10} tickFormatter={(v) => compactUsd(Number(v))} width={60} />
              <ReTooltip contentStyle={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)", fontSize: 11 }} formatter={(v: any) => [compactUsd(Number(v)), "TVL"]} labelFormatter={(l) => new Date(l).toLocaleDateString()} />
              <Area type="monotone" dataKey="tvl" stroke="#10b981" strokeWidth={1.5} fill="url(#booktvlfull)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Movers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <MoverList title="Top TVL gainers (30d)" icon={<TrendingUp className="w-4 h-4 text-emerald-300" />} rows={movers.up} positive />
        <MoverList title="Top TVL decliners (30d)" icon={<TrendingDown className="w-4 h-4 text-rose-300" />} rows={movers.down} positive={false} />
      </div>

      {/* Revenue leaders chart */}
      {topRevenue.length > 0 && (
        <div className="as-card p-4">
          <h3 className="text-sm font-semibold text-white mb-3">Revenue leaders · 30d</h3>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topRevenue} margin={{ top: 8, right: 16, left: 0, bottom: 40 }}>
                <XAxis dataKey="name" stroke="#888" fontSize={10} angle={-25} textAnchor="end" interval={0} height={50} />
                <YAxis stroke="#888" fontSize={10} tickFormatter={(v) => compactUsd(Number(v))} width={60} />
                <ReTooltip contentStyle={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)", fontSize: 11 }} formatter={(v: any) => [compactUsd(Number(v)), "Rev 30d"]} />
                <Bar dataKey="revenue_30d" radius={[4, 4, 0, 0]}>
                  {topRevenue.map((_, i) => <Cell key={i} fill="#06b6d4" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Recent raises + hiring */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="as-card p-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
            <Banknote className="w-4 h-4 text-sky-300" />
            <h3 className="text-sm font-semibold text-white">Recent raises · 12mo</h3>
            <span className="text-[11px] text-muted-foreground ml-1">{(fundingQ.data ?? []).length} rounds</span>
          </div>
          {(fundingQ.data ?? []).length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">No raises tracked in the last 12 months.</div>
          ) : (
            <div className="divide-y divide-white/[0.04] max-h-[400px] overflow-y-auto">
              {(fundingQ.data ?? []).slice(0, 20).map((r: any, i: number) => {
                const co = companiesMap.get(r.company_slug);
                return (
                  <Link key={i} to={`/protocol/${r.company_slug}`} className="px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02]">
                    <BrandLogo name={co?.name || r.company_slug} url={co?.url} logo={co?.logo} className="w-8 h-8 rounded-md shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{co?.name || r.company_slug}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{r.round_type || "round"} · {new Date(r.date).toLocaleDateString()}{r.lead_investor ? ` · lead ${r.lead_investor}` : ""}</div>
                    </div>
                    <div className="text-sm font-bold tabular-nums text-sky-200 shrink-0">{compactUsd(Number(r.amount_usd))}</div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="as-card p-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
            <Users className="w-4 h-4 text-violet-300" />
            <h3 className="text-sm font-semibold text-white">Hiring momentum</h3>
            <span className="text-[11px] text-muted-foreground ml-1">open roles · SC engineers</span>
          </div>
          {(hiringQ.data ?? []).length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">No hiring signal tracked.</div>
          ) : (
            <div className="divide-y divide-white/[0.04] max-h-[400px] overflow-y-auto">
              {(hiringQ.data ?? []).slice(0, 15).map((h: any) => {
                const co = companiesMap.get(h.company_slug);
                return (
                  <Link key={h.company_slug} to={`/protocol/${h.company_slug}`} className="px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02]">
                    <BrandLogo name={co?.name || h.company_slug} url={co?.url} logo={co?.logo} className="w-8 h-8 rounded-md shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{co?.name || h.company_slug}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{h.role_count ?? 0} roles · {h.smart_contract_count ?? 0} SC eng</div>
                    </div>
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MoverList({ title, icon, rows, positive }: { title: string; icon: React.ReactNode; rows: Array<{ slug: string; name: string; pct: number; latest: number; logo: string | null; url: string | null }>; positive: boolean }) {
  return (
    <div className="as-card p-0 overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-xs text-muted-foreground">No material moves.</div>
      ) : (
        <div className="divide-y divide-white/[0.04]">
          {rows.map((r) => (
            <Link key={r.slug} to={`/protocol/${r.slug}`} className="px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02]">
              <BrandLogo name={r.name} url={r.url} logo={r.logo} className="w-8 h-8 rounded-md shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{r.name}</div>
                <div className="text-[11px] text-muted-foreground tabular-nums">TVL {compactUsd(r.latest)}</div>
              </div>
              <span className={`text-sm font-bold tabular-nums ${positive ? "text-emerald-300" : "text-rose-300"}`}>
                {r.pct > 0 ? "+" : ""}{r.pct.toFixed(0)}%
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function KpiTile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone: "good" | "warn" | "alert" | "neutral" }) {
  const cls = ({ neutral: "border-white/[0.06] bg-white/[0.02]", good: "border-emerald-500/25 bg-emerald-500/[0.04]", warn: "border-amber-500/30 bg-amber-500/[0.04]", alert: "border-rose-500/30 bg-rose-500/[0.06]" } as Record<string, string>)[tone];
  const valCls = ({ neutral: "text-white", good: "text-emerald-300", warn: "text-amber-200", alert: "text-rose-300" } as Record<string, string>)[tone];
  return (
    <div className={`rounded-lg border px-4 py-4 ${cls}`}>
      <div className="text-[10px] uppercase tracking-[0.08em] font-medium text-muted-foreground/90">{label}</div>
      <div className={`text-[22px] leading-none font-bold tabular-nums mt-2 ${valCls}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground/80 mt-2">{hint}</div>}
    </div>
  );
}
