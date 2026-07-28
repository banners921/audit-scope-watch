import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Wallet, Plus, ExternalLink, TrendingUp, Users, ArrowRight, Layers, Banknote,
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
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d < 1) return "today";
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

export default function WatchedFunds() {
  const { user } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);

  const profileQ = useQuery({
    queryKey: ["watched-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("fund_slug,watched_fund_slugs")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data as { fund_slug: string | null; watched_fund_slugs: string[] } | null;
    },
  });

  const watchedSlugs = profileQ.data?.watched_fund_slugs ?? [];
  const myFundSlug = profileQ.data?.fund_slug;

  // Resolve fund metadata for both my fund and watched funds (for overlap analysis)
  const allFundSlugs = useMemo(() => Array.from(new Set([...(myFundSlug ? [myFundSlug] : []), ...watchedSlugs])), [myFundSlug, watchedSlugs]);

  const fundsQ = useQuery({
    queryKey: ["watched-funds-meta", allFundSlugs.length],
    enabled: allFundSlugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("funds")
        .select("slug,name,website,investment_count,rounds_led")
        .in("slug", allFundSlugs);
      return (data ?? []) as Array<{ slug: string; name: string; website: string | null; investment_count: number | null; rounds_led: number | null }>;
    },
  });

  // Portfolio rows for each watched fund (+ my fund for overlap)
  const portfolioQ = useQuery({
    queryKey: ["watched-portfolio", allFundSlugs.length],
    enabled: allFundSlugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("fund_portfolio")
        .select("fund_slug,company_slug,company_name,category,round_type,amount_usd,round_date,fund_name")
        .in("fund_slug", allFundSlugs)
        .order("round_date", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  // Group portfolio by fund_slug
  const byFund = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const r of portfolioQ.data ?? []) {
      const arr = m.get(r.fund_slug) ?? [];
      arr.push(r);
      m.set(r.fund_slug, arr);
    }
    return m;
  }, [portfolioQ.data]);

  // Compute overlap with my fund (which portfolio companies do I share?)
  const myCompanies = useMemo(() => new Set((byFund.get(myFundSlug ?? "") ?? []).map((r) => r.company_slug)), [byFund, myFundSlug]);

  // Per-watched-fund analytics
  const perFund = useMemo(() => {
    const out: Array<{
      slug: string; name: string; website: string | null;
      portfolio_count: number; investment_count: number | null;
      overlap_count: number; overlap_pct: number;
      recent_deals: any[];
      sectors: Record<string, number>;
      median_check?: number;
      pace_30d: number; pace_90d: number;
      most_recent_date: string | null;
    }> = [];
    const fundsMeta = new Map((fundsQ.data ?? []).map((f) => [f.slug, f]));
    for (const slug of watchedSlugs) {
      const meta = fundsMeta.get(slug);
      const rows = byFund.get(slug) ?? [];
      const deduped = new Map<string, any>();
      for (const r of rows) if (!deduped.has(r.company_slug)) deduped.set(r.company_slug, r);
      const companies = Array.from(deduped.values());
      const overlap = companies.filter((c) => myCompanies.has(c.company_slug)).length;
      const sectors: Record<string, number> = {};
      for (const c of companies) { if (c.category) sectors[c.category] = (sectors[c.category] ?? 0) + 1; }
      const sortedRowsByDate = rows.filter((r) => r.round_date).sort((a, b) => (b.round_date > a.round_date ? 1 : -1));
      const since30 = Date.now() - 30 * 86400000;
      const since90 = Date.now() - 90 * 86400000;
      const pace_30d = sortedRowsByDate.filter((r) => new Date(r.round_date).getTime() > since30).length;
      const pace_90d = sortedRowsByDate.filter((r) => new Date(r.round_date).getTime() > since90).length;
      const amounts = rows.map((r) => Number(r.amount_usd)).filter((n) => n > 0).sort((a, b) => a - b);
      const median_check = amounts.length > 0 ? amounts[Math.floor(amounts.length / 2)] : undefined;
      out.push({
        slug, name: meta?.name ?? slug, website: meta?.website ?? null,
        portfolio_count: companies.length,
        investment_count: meta?.investment_count ?? null,
        overlap_count: overlap,
        overlap_pct: companies.length > 0 ? Math.round((overlap / companies.length) * 100) : 0,
        recent_deals: sortedRowsByDate.slice(0, 8),
        sectors, median_check,
        pace_30d, pace_90d,
        most_recent_date: sortedRowsByDate[0]?.round_date ?? null,
      });
    }
    return out.sort((a, b) => b.pace_30d - a.pace_30d);
  }, [byFund, fundsQ.data, watchedSlugs, myCompanies]);

  const detail = selected ? perFund.find((p) => p.slug === selected) : null;
  const detailDeals = detail ? (byFund.get(detail.slug) ?? []) : [];

  if (profileQ.isLoading) return <div className="py-12 text-center text-muted-foreground text-sm">Loading…</div>;

  if (watchedSlugs.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-16">
        <div className="as-card p-8 text-center space-y-4">
          <div className="inline-flex w-12 h-12 rounded-full bg-primary/10 items-center justify-center"><Users className="w-6 h-6 text-primary" /></div>
          <div>
            <h2 className="text-lg font-semibold text-white">No watched funds yet</h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
              Watch competitor funds in your Profile. See their deal flow, sector tilt, co-investor patterns, and overlap with your portfolio.
            </p>
          </div>
          <Link to="/profile" className="as-btn as-btn-primary inline-flex"><Plus className="w-4 h-4" /> Add watched funds</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-[1600px]">
      <div className="as-card p-5 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold text-white">Watched Funds</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Competitive intel — who's investing where, deal velocity, sector tilt, overlap with your portfolio.</p>
          </div>
        </div>
        <Link to="/profile" className="text-xs text-muted-foreground hover:text-white inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Add more</Link>
      </div>

      {/* Sortable fund table */}
      <div className="as-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Funds you're watching</h3>
          <span className="text-xs text-muted-foreground">{perFund.length} funds · sorted by 30d pace</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-white/[0.02] border-b border-white/[0.04]">
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2">Fund</th>
                <th className="px-2 py-2 text-right">Portfolio</th>
                <th className="px-2 py-2 text-right">30d</th>
                <th className="px-2 py-2 text-right">90d</th>
                <th className="px-2 py-2 text-right">Overlap w/ you</th>
                <th className="px-2 py-2 text-right">Median check</th>
                <th className="px-2 py-2">Top sectors</th>
                <th className="px-2 py-2">Last deal</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {perFund.map((p) => {
                const topSectors = Object.entries(p.sectors).sort((a, b) => b[1] - a[1]).slice(0, 3);
                return (
                  <tr key={p.slug} className={`hover:bg-white/[0.02] cursor-pointer ${selected === p.slug ? "bg-primary/[0.04]" : ""}`} onClick={() => setSelected(p.slug)}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <BrandLogo name={p.name} url={p.website} className="w-6 h-6 rounded shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm text-white truncate">{p.name}</div>
                          {p.website && <div className="text-[10px] text-muted-foreground">{(() => { try { return new URL(p.website).hostname.replace("www.", ""); } catch { return ""; } })()}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-white/85">{p.portfolio_count}{p.investment_count != null && p.investment_count > p.portfolio_count && <span className="text-muted-foreground"> / {p.investment_count}</span>}</td>
                    <td className={`px-2 py-2.5 text-right tabular-nums font-semibold ${p.pace_30d > 0 ? "text-emerald-300" : "text-muted-foreground"}`}>{p.pace_30d}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-white/85">{p.pace_90d}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      <span className={p.overlap_count > 0 ? "text-primary" : "text-muted-foreground"}>
                        {p.overlap_count}{p.overlap_pct > 0 && <span className="text-[10px] opacity-70"> ({p.overlap_pct}%)</span>}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-white/85">{p.median_check ? compactUsd(p.median_check) : "—"}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-1 flex-wrap">
                        {topSectors.map(([s, n]) => (
                          <span key={s} className="text-[10px] bg-white/[0.04] px-1.5 py-0.5 rounded text-muted-foreground">{s} {n}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-muted-foreground">{daysAgo(p.most_recent_date)}</td>
                    <td className="px-2 py-2.5"><ArrowRight className="w-3 h-3 text-muted-foreground/40" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected fund drill-down */}
      {detail && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 as-card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
              <BrandLogo name={detail.name} url={detail.website} className="w-7 h-7 rounded" />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-white">{detail.name} · recent deals</h3>
                <div className="text-[11px] text-muted-foreground">{detail.portfolio_count} companies tracked · {detail.pace_30d} in 30d · {detail.pace_90d} in 90d</div>
              </div>
              {detail.website && <a href={detail.website} target="_blank" rel="noreferrer" className="text-primary hover:underline"><ExternalLink className="w-3 h-3" /></a>}
            </div>
            <div className="divide-y divide-white/[0.04] max-h-[600px] overflow-y-auto">
              {detailDeals.slice(0, 80).map((d, i) => {
                const isShared = myCompanies.has(d.company_slug);
                return (
                  <Link key={i} to={`/protocol/${d.company_slug}`} className="px-4 py-2.5 flex items-center gap-3 hover:bg-white/[0.02]">
                    <BrandLogo name={d.company_name} className="w-6 h-6 rounded" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-white truncate">{d.company_name}</span>
                        {d.category && <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-white/[0.04] px-1.5 py-0.5 rounded">{d.category}</span>}
                        {isShared && <span className="text-[10px] uppercase tracking-wider text-primary bg-primary/15 px-1.5 py-0.5 rounded border border-primary/30">shared</span>}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {d.round_type || "Round"} · {compactUsd(d.amount_usd)} · {d.round_date}
                      </div>
                    </div>
                    <ArrowRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Right: sector + overlap analytics */}
          <div className="space-y-5">
            <div className="as-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Layers className="w-4 h-4 text-primary" />
                <h3 className="text-xs font-semibold text-white uppercase tracking-wider">Sector tilt</h3>
              </div>
              <div className="space-y-1.5 text-xs">
                {Object.entries(detail.sectors).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([s, n]) => {
                  const max = Math.max(...Object.values(detail.sectors));
                  return (
                    <div key={s} className="flex items-center gap-2">
                      <span className="text-white/80 truncate w-28">{s}</span>
                      <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                        <div className="h-full bg-primary/60" style={{ width: `${(n / max) * 100}%` }} />
                      </div>
                      <span className="tabular-nums text-muted-foreground w-6 text-right">{n}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="as-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-primary" />
                <h3 className="text-xs font-semibold text-white uppercase tracking-wider">Overlap with your fund</h3>
              </div>
              <div className="text-2xl font-bold text-white tabular-nums">{detail.overlap_count}<span className="text-muted-foreground text-base ml-2">/ {detail.portfolio_count}</span></div>
              <div className="text-xs text-muted-foreground mt-1">{detail.overlap_pct}% of {detail.name}'s portfolio is also yours</div>
              {detail.overlap_count === 0 && <div className="text-[11px] text-muted-foreground/80 mt-2 italic">No shared companies — they're sourcing from a different lane.</div>}
              {detail.overlap_count > 0 && detail.overlap_count < 5 && <div className="text-[11px] text-emerald-300/80 mt-2">Modest overlap — they might be early or late in deals you've seen.</div>}
              {detail.overlap_pct >= 30 && <div className="text-[11px] text-amber-300/80 mt-2">Heavy overlap — same thesis, watch their next moves closely.</div>}
            </div>

            <div className="as-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Banknote className="w-4 h-4 text-sky-300" />
                <h3 className="text-xs font-semibold text-white uppercase tracking-wider">Check size</h3>
              </div>
              <div className="text-2xl font-bold text-white tabular-nums">{detail.median_check ? compactUsd(detail.median_check) : "—"}</div>
              <div className="text-xs text-muted-foreground mt-1">median round amount they participated in</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
