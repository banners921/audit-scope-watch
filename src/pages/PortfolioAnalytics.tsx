import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PieChart, BarChart3, Users, Layers, Network, Calendar, ArrowRight, Download, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";
import { useAuth } from "@/hooks/useAuth";

function compactUsd(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n === 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export default function PortfolioAnalytics() {
  const { user } = useAuth();

  const profileQ = useQuery({
    queryKey: ["pa-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("user_profiles").select("fund_slug").eq("user_id", user!.id).maybeSingle();
      return data as { fund_slug: string | null } | null;
    },
  });
  const fundSlug = profileQ.data?.fund_slug ?? null;

  // Portfolio companies for this fund
  const portfolioQ = useQuery({
    queryKey: ["pa-portfolio", fundSlug],
    enabled: !!fundSlug,
    queryFn: async () => {
      const { data } = await supabase
        .from("fund_portfolio")
        .select("company_slug,company_name,category,round_type,amount_usd,round_date")
        .eq("fund_slug", fundSlug!);
      return (data ?? []) as any[];
    },
  });

  const positions = portfolioQ.data ?? [];
  const positionSlugs = useMemo(() => Array.from(new Set(positions.map(p => p.company_slug))), [positions]);

  // Auditor concentration: aggregate audit_history for our portfolio
  const portfolioAuditsQ = useQuery({
    queryKey: ["pa-audits", positionSlugs.length],
    enabled: positionSlugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_history")
        .select("company_slug,audit_firm,audit_date")
        .in("company_slug", positionSlugs)
        .not("audit_firm", "is", null);
      return (data ?? []) as Array<{ company_slug: string; audit_firm: string; audit_date: string | null }>;
    },
  });

  // Enrich with TVL, risk score, chain footprint, latest round, investors
  const enrichQ = useQuery({
    queryKey: ["pa-enrich", positionSlugs.length],
    enabled: positionSlugs.length > 0,
    queryFn: async () => {
      const [tvl, risk, comp, chains, rounds] = await Promise.all([
        supabase.from("protocol_metrics").select("company_slug,tvl,date").in("company_slug", positionSlugs).not("tvl", "is", null).order("date", { ascending: false }).limit(2000),
        supabase.from("protocol_risk_scores").select("company_slug,composite_score,band").in("company_slug", positionSlugs),
        supabase.from("companies").select("slug,name,category,url,logo,total_raised_usd").in("slug", positionSlugs),
        supabase.from("chain_addresses").select("company_slug,chain").in("company_slug", positionSlugs),
        supabase.from("funding_rounds").select("company_slug,amount_usd,round_type,date,all_investors").in("company_slug", positionSlugs),
      ]);
      const tvlMap = new Map<string, number>();
      for (const r of (tvl.data ?? []) as any[]) if (!tvlMap.has(r.company_slug)) tvlMap.set(r.company_slug, Number(r.tvl));
      const riskMap = new Map<string, any>();
      for (const r of (risk.data ?? []) as any[]) riskMap.set(r.company_slug, r);
      const compMap = new Map<string, any>();
      for (const c of (comp.data ?? []) as any[]) compMap.set(c.slug, c);
      const chainMap = new Map<string, Set<string>>();
      for (const c of (chains.data ?? []) as any[]) {
        if (!c.chain) continue;
        const s = chainMap.get(c.company_slug) ?? new Set<string>();
        s.add(c.chain);
        chainMap.set(c.company_slug, s);
      }
      return { tvlMap, riskMap, compMap, chainMap, rounds: (rounds.data ?? []) as any[] };
    },
  });

  // Watched funds: peer overlap signal source
  const peerFundsQ = useQuery({
    queryKey: ["pa-peer-funds", positionSlugs.length],
    enabled: positionSlugs.length > 0,
    queryFn: async () => {
      // Get the funds that invested alongside us (other funds that hold our slugs)
      const { data } = await supabase
        .from("fund_portfolio")
        .select("fund_slug,fund_name,company_slug")
        .in("company_slug", positionSlugs)
        .neq("fund_slug", fundSlug!);
      const overlap = new Map<string, { fund_slug: string; fund_name: string; count: number; slugs: Set<string> }>();
      for (const r of (data ?? []) as any[]) {
        const e = overlap.get(r.fund_slug) ?? { fund_slug: r.fund_slug, fund_name: r.fund_name, count: 0, slugs: new Set<string>() };
        e.count++;
        e.slugs.add(r.company_slug);
        overlap.set(r.fund_slug, e);
      }
      return Array.from(overlap.values()).sort((a, b) => b.count - a.count).slice(0, 12);
    },
  });

  // Auditor concentration analytics
  const auditorConcentration = useMemo(() => {
    if (!portfolioAuditsQ.data) return null;
    const byFirm = new Map<string, { firm: string; audit_count: number; client_slugs: Set<string>; latest: string | null }>();
    for (const a of portfolioAuditsQ.data) {
      const firm = (a.audit_firm || "").trim();
      if (!firm) continue;
      const e = byFirm.get(firm) ?? { firm, audit_count: 0, client_slugs: new Set<string>(), latest: null };
      e.audit_count++;
      e.client_slugs.add(a.company_slug);
      if (a.audit_date && (!e.latest || a.audit_date > e.latest)) e.latest = a.audit_date;
      byFirm.set(firm, e);
    }
    const rows = Array.from(byFirm.values()).map((r) => ({
      ...r,
      client_count: r.client_slugs.size,
      portfolio_coverage_pct: (r.client_slugs.size / Math.max(positionSlugs.length, 1)) * 100,
    })).sort((a, b) => b.client_count - a.client_count);
    const portfolioAudited = new Set<string>();
    for (const r of rows) for (const s of r.client_slugs) portfolioAudited.add(s);
    return {
      rows,
      portfolioAuditedCount: portfolioAudited.size,
      portfolioCoveragePct: (portfolioAudited.size / Math.max(positionSlugs.length, 1)) * 100,
      topFirmCoveragePct: rows[0]?.portfolio_coverage_pct ?? 0,
      uniqueFirms: rows.length,
    };
  }, [portfolioAuditsQ.data, positionSlugs.length]);

  // Aggregate analytics
  const analytics = useMemo(() => {
    if (!enrichQ.data || positions.length === 0) return null;
    const { tvlMap, chainMap } = enrichQ.data;

    // Position-by-position TVL exposure (use TVL as proxy weight; fall back to raise amount)
    const items = positions.map((p) => {
      const tvl = tvlMap.get(p.company_slug) ?? null;
      const chains = chainMap.get(p.company_slug) ? Array.from(chainMap.get(p.company_slug)!) : [];
      return {
        slug: p.company_slug,
        name: p.company_name,
        category: p.category,
        tvl,
        chains,
        amount_usd: Number(p.amount_usd) || 0,
      };
    });

    const totalTvl = items.reduce((s, i) => s + (i.tvl ?? 0), 0);
    const totalRaised = items.reduce((s, i) => s + i.amount_usd, 0);

    // Top concentration
    const sortedByTvl = items.slice().filter(i => i.tvl).sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0));
    const top10TvlShare = totalTvl > 0 ? sortedByTvl.slice(0, 10).reduce((s, i) => s + (i.tvl ?? 0), 0) / totalTvl * 100 : 0;
    const top3TvlShare = totalTvl > 0 ? sortedByTvl.slice(0, 3).reduce((s, i) => s + (i.tvl ?? 0), 0) / totalTvl * 100 : 0;

    // Sector concentration
    const bySector = new Map<string, { count: number; tvl: number }>();
    for (const i of items) {
      const k = i.category || "Uncategorized";
      const e = bySector.get(k) ?? { count: 0, tvl: 0 };
      e.count++;
      e.tvl += i.tvl ?? 0;
      bySector.set(k, e);
    }
    const sectorRows = Array.from(bySector.entries())
      .map(([cat, e]) => ({ category: cat, count: e.count, tvl: e.tvl, share_pct: (e.count / items.length) * 100, tvl_share_pct: totalTvl > 0 ? (e.tvl / totalTvl) * 100 : 0 }))
      .sort((a, b) => b.count - a.count);

    // Chain concentration
    const byChain = new Map<string, number>();
    for (const i of items) {
      for (const c of i.chains) byChain.set(c, (byChain.get(c) ?? 0) + 1);
    }
    const chainRows = Array.from(byChain.entries())
      .map(([chain, count]) => ({ chain, count, share_pct: (count / items.length) * 100 }))
      .sort((a, b) => b.count - a.count);

    // Vintage
    const byYear = new Map<string, { count: number; amount: number }>();
    for (const p of positions) {
      if (!p.round_date) continue;
      const y = String(new Date(p.round_date).getFullYear());
      const e = byYear.get(y) ?? { count: 0, amount: 0 };
      e.count++;
      e.amount += Number(p.amount_usd) || 0;
      byYear.set(y, e);
    }
    const yearRows = Array.from(byYear.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    // Round type
    const byRound = new Map<string, number>();
    for (const p of positions) {
      const k = (p.round_type || "Unknown").trim();
      byRound.set(k, (byRound.get(k) ?? 0) + 1);
    }
    const roundRows = Array.from(byRound.entries()).map(([r, c]) => ({ round: r, count: c, share_pct: (c / positions.length) * 100 })).sort((a, b) => b.count - a.count);

    return {
      itemCount: items.length, totalTvl, totalRaised, top10TvlShare, top3TvlShare,
      sortedByTvl, sectorRows, chainRows, yearRows, roundRows,
    };
  }, [enrichQ.data, positions]);

  const exportCsv = () => {
    if (!analytics) return;
    const header = ["slug", "name", "category", "tvl", "share_pct"];
    const rows = analytics.sortedByTvl.map((i) => [
      i.slug, i.name, i.category || "", i.tvl ?? "", analytics.totalTvl > 0 ? ((i.tvl ?? 0) / analytics.totalTvl * 100).toFixed(2) : "0",
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portfolio-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!fundSlug) {
    return (
      <div className="as-card p-12 text-center max-w-2xl">
        <Layers className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
        <h3 className="text-base font-semibold text-white">No fund selected</h3>
        <p className="text-sm text-muted-foreground mt-1">Set your fund in <Link to="/profile" className="text-primary hover:underline">Profile</Link> to see portfolio analytics.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-[1700px]">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <PieChart className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight">Portfolio analytics</h1>
            <p className="text-[11px] text-muted-foreground mt-1">
              Where your exposure concentrates. Surface concentration risk before LPs ask.
            </p>
          </div>
        </div>
        <button onClick={exportCsv} className="text-xs text-muted-foreground hover:text-white inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-white/[0.08] hover:bg-white/[0.03]">
          <Download className="w-3 h-3" /> CSV
        </button>
      </div>

      {!analytics ? (
        <div className="as-card p-8 text-center text-xs text-muted-foreground">Loading portfolio analytics…</div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Tile label="Positions" value={analytics.itemCount.toString()} tone="neutral" />
            <Tile label="Portfolio TVL" value={compactUsd(analytics.totalTvl)} hint="sum of positions" tone="neutral" />
            <Tile label="Top 3 share" value={`${analytics.top3TvlShare.toFixed(0)}%`} hint="concentration risk" tone={analytics.top3TvlShare > 50 ? "alert" : analytics.top3TvlShare > 30 ? "warn" : "good"} />
            <Tile label="Top 10 share" value={`${analytics.top10TvlShare.toFixed(0)}%`} hint="of TVL" tone={analytics.top10TvlShare > 80 ? "alert" : analytics.top10TvlShare > 60 ? "warn" : "good"} />
            <Tile label="Sectors" value={analytics.sectorRows.length.toString()} hint="diversification" tone="neutral" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Position concentration */}
            <div className="as-card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-white">Position concentration (by TVL)</h3>
              </div>
              <div className="divide-y divide-white/[0.04] max-h-[420px] overflow-y-auto">
                {analytics.sortedByTvl.slice(0, 20).map((i, idx) => {
                  const share = analytics.totalTvl > 0 ? ((i.tvl ?? 0) / analytics.totalTvl) * 100 : 0;
                  const co = enrichQ.data?.compMap.get(i.slug);
                  return (
                    <Link key={i.slug} to={`/protocol/${i.slug}`} className="px-4 py-2.5 flex items-center gap-3 hover:bg-white/[0.02]">
                      <div className="text-[10px] text-muted-foreground tabular-nums w-6 shrink-0">{idx + 1}</div>
                      <BrandLogo name={i.name} url={co?.url} logo={co?.logo} className="w-7 h-7 rounded shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm text-white truncate">{i.name}</span>
                          {i.category && <span className="text-[10px] text-muted-foreground">{i.category}</span>}
                        </div>
                        <div className="h-1 bg-white/[0.05] rounded overflow-hidden">
                          <div className="h-full bg-primary/60" style={{ width: `${Math.min(100, share)}%` }} />
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold tabular-nums">{compactUsd(i.tvl)}</div>
                        <div className="text-[10px] tabular-nums text-muted-foreground">{share.toFixed(1)}%</div>
                      </div>
                    </Link>
                  );
                })}
                {analytics.sortedByTvl.length === 0 && <div className="px-4 py-6 text-center text-xs text-muted-foreground">No TVL data for portfolio.</div>}
              </div>
            </div>

            {/* Sector tilt */}
            <div className="as-card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-white">Sector tilt</h3>
                <span className="text-[10px] text-muted-foreground ml-1">by position count</span>
              </div>
              <div className="divide-y divide-white/[0.04] max-h-[420px] overflow-y-auto">
                {analytics.sectorRows.map((s) => (
                  <div key={s.category} className="px-4 py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[12.5px] text-white truncate">{s.category}</span>
                        <span className="text-[11px] tabular-nums text-muted-foreground">{s.count} · {s.share_pct.toFixed(0)}%</span>
                      </div>
                      <div className="h-1.5 bg-white/[0.05] rounded overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-primary/60 to-secondary/40" style={{ width: `${Math.min(100, s.share_pct)}%` }} />
                      </div>
                    </div>
                    <div className="text-right shrink-0 text-[10px] text-muted-foreground tabular-nums w-16">
                      {compactUsd(s.tvl)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Chain concentration */}
            <div className="as-card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
                <Network className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-white">Chain footprint</h3>
              </div>
              <div className="divide-y divide-white/[0.04] max-h-[320px] overflow-y-auto">
                {analytics.chainRows.length === 0 ? (
                  <div className="px-4 py-6 text-xs text-muted-foreground text-center">No chain data yet.</div>
                ) : analytics.chainRows.map((c) => (
                  <div key={c.chain} className="px-4 py-2 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[12.5px] text-white">{c.chain}</span>
                        <span className="text-[10px] tabular-nums text-muted-foreground">{c.count}</span>
                      </div>
                      <div className="h-1 bg-white/[0.05] rounded overflow-hidden">
                        <div className="h-full bg-amber-400/60" style={{ width: `${Math.min(100, c.share_pct)}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Vintage / round type */}
            <div className="as-card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-white">Vintage</h3>
                <span className="text-[10px] text-muted-foreground ml-1">deals per year</span>
              </div>
              <div className="px-4 py-3 h-[290px]">
                {analytics.yearRows.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center">No vintage data.</div>
                ) : (
                  <div className="flex items-end gap-2 h-full">
                    {analytics.yearRows.map(([y, e]) => {
                      const max = Math.max(...analytics.yearRows.map(([, v]) => v.count));
                      const h = (e.count / max) * 100;
                      return (
                        <div key={y} className="flex-1 flex flex-col items-center gap-1.5">
                          <span className="text-[10px] tabular-nums text-white/85">{e.count}</span>
                          <div className="w-full bg-gradient-to-t from-primary/40 to-primary/15 rounded-t" style={{ height: `${h}%`, minHeight: 4 }} />
                          <span className="text-[9px] text-muted-foreground">{y}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Round mix */}
            <div className="as-card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
                <PieChart className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-white">Round-type mix</h3>
              </div>
              <div className="divide-y divide-white/[0.04] max-h-[320px] overflow-y-auto">
                {analytics.roundRows.map((r) => (
                  <div key={r.round} className="px-4 py-2 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[12.5px] text-white truncate">{r.round}</span>
                        <span className="text-[10px] tabular-nums text-muted-foreground">{r.count} · {r.share_pct.toFixed(0)}%</span>
                      </div>
                      <div className="h-1 bg-white/[0.05] rounded overflow-hidden">
                        <div className="h-full bg-emerald-400/60" style={{ width: `${Math.min(100, r.share_pct)}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Auditor concentration in your book */}
          {auditorConcentration && auditorConcentration.rows.length > 0 && (
            <div className="as-card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2 flex-wrap">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-white">Auditor concentration in your book</h3>
                <span className="text-[10px] text-muted-foreground ml-1">
                  {auditorConcentration.portfolioAuditedCount}/{positionSlugs.length} positions audited · {auditorConcentration.uniqueFirms} firms total
                </span>
              </div>
              {/* Verdict line */}
              <div className="px-4 py-3 border-b border-white/[0.04] bg-white/[0.015] text-[12.5px] text-white/85 leading-relaxed">
                {auditorConcentration.portfolioCoveragePct < 50 ? (
                  <><span className="text-amber-300 font-medium">{auditorConcentration.portfolioCoveragePct.toFixed(0)}% of your book is audited.</span> {positionSlugs.length - auditorConcentration.portfolioAuditedCount} position{positionSlugs.length - auditorConcentration.portfolioAuditedCount === 1 ? "" : "s"} have no audit on file — significant gap to LPs.</>
                ) : auditorConcentration.topFirmCoveragePct >= 40 ? (
                  <><span className="text-amber-300 font-medium">{auditorConcentration.rows[0].firm} audits {auditorConcentration.topFirmCoveragePct.toFixed(0)}% of your positions</span> — heavy single-firm exposure. If this firm misses a class of bug, multiple positions are affected.</>
                ) : (
                  <><span className="text-emerald-300 font-medium">Healthy diversification</span> — top firm covers {auditorConcentration.topFirmCoveragePct.toFixed(0)}% of positions across {auditorConcentration.uniqueFirms} firms used.</>
                )}
              </div>
              <div className="divide-y divide-white/[0.04] max-h-[440px] overflow-y-auto">
                {auditorConcentration.rows.slice(0, 15).map((r) => (
                  <Link key={r.firm} to={`/auditors/${encodeURIComponent(r.firm.toLowerCase())}`} className="px-4 py-2.5 flex items-center gap-3 hover:bg-white/[0.02]">
                    <BrandLogo name={r.firm} className="w-7 h-7 rounded shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[13px] text-white truncate">{r.firm}</span>
                        <span className="text-[10px] tabular-nums text-muted-foreground">{r.client_count} portfolio cos · {r.audit_count} audits · {r.portfolio_coverage_pct.toFixed(0)}%</span>
                      </div>
                      <div className="h-1.5 bg-white/[0.05] rounded overflow-hidden">
                        <div className={`h-full ${r.portfolio_coverage_pct >= 40 ? "bg-amber-400/70" : "bg-primary/60"}`} style={{ width: `${Math.min(100, r.portfolio_coverage_pct)}%` }} />
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground shrink-0">last {r.latest || "—"}</div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Co-investor overlap */}
          <div className="as-card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-white">Co-investor overlap</h3>
              <span className="text-[10px] text-muted-foreground ml-1">funds that also hold your positions</span>
            </div>
            {(peerFundsQ.data ?? []).length === 0 ? (
              <div className="px-4 py-6 text-xs text-muted-foreground text-center">No co-investor data yet.</div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {(peerFundsQ.data ?? []).map((p) => {
                  const overlapPct = (p.count / Math.max(positionSlugs.length, 1)) * 100;
                  return (
                    <Link key={p.fund_slug} to={`/funds/${p.fund_slug}`} className="px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02]">
                      <BrandLogo name={p.fund_name} className="w-7 h-7 rounded shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white truncate">{p.fund_name}</div>
                        <div className="h-1 bg-white/[0.05] rounded overflow-hidden mt-1.5">
                          <div className="h-full bg-secondary/60" style={{ width: `${Math.min(100, overlapPct)}%` }} />
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold tabular-nums text-white">{p.count}</div>
                        <div className="text-[10px] text-muted-foreground">shared · {overlapPct.toFixed(0)}%</div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40" />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </>
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
