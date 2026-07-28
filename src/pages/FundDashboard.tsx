import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Search, Filter, LayoutGrid, List, ArrowRight, Activity, Newspaper, Skull, ShieldCheck,
  Briefcase, Banknote, Globe, Twitter, Github, TrendingUp, Bug, AlertTriangle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";
import { canonicalCategory } from "@/lib/categories";
import { CategoryChip, CategoryMultiSelect, CategoryFilterStrip } from "@/components/CategoryChip";

type Position = {
  company_slug: string;
  company_name: string | null;
  category: string | null;
  round_type: string | null;
  amount_usd: number | null;
  round_date: string | null;
  fund_name: string | null;
  // enriched
  logo: string | null;
  url: string | null;
  twitter: string | null;
  github: string | null;
  has_been_hacked: boolean | null;
  has_bug_bounty: boolean | null;
  total_raised_usd: number | null;
  last_audit_date: string | null;
};

type ActivityItem = {
  kind: "news" | "hack" | "audit" | "hiring" | "raise" | "signal";
  ts: string;
  slug: string;
  name: string;
  title: string;
  sub: string;
  url?: string | null;
  sev: "alert" | "warn" | "info";
};

type Props = { fundSlug: string; fundName?: string | null };

function compactUsd(n: number | null | undefined): string {
  if (n == null || n <= 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}
function tightAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400000);
  if (d < 1) {
    const h = Math.floor(ms / 3600000);
    return h <= 0 ? "now" : `${h}h`;
  }
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}

export default function FundDashboard({ fundSlug, fundName }: Props) {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const toggleCategory = (c: string) => {
    setCategoryFilter(prev => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  };
  const [minAmt, setMinAmt] = useState(0);
  const [sinceDays, setSinceDays] = useState(0); // 0 = any
  const [activityScope, setActivityScope] = useState<"portfolio" | "all">("portfolio");

  // 1) Portfolio rows
  const positionsQ = useQuery({
    queryKey: ["fund-portfolio", fundSlug],
    enabled: !!fundSlug,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: portfolio } = await supabase
        .from("fund_portfolio")
        .select("company_slug,company_name,category,round_type,amount_usd,round_date,fund_name")
        .eq("fund_slug", fundSlug);
      const rows = (portfolio ?? []) as any[];
      // Dedupe: keep the LATEST round per company_slug
      const latest = new Map<string, any>();
      for (const r of rows) {
        const cur = latest.get(r.company_slug);
        if (!cur || (r.round_date || "") > (cur.round_date || "")) latest.set(r.company_slug, r);
      }
      const positions = Array.from(latest.values());
      const slugs = positions.map((p) => p.company_slug).filter(Boolean);
      if (slugs.length === 0) return [] as Position[];

      const { data: comps } = await supabase
        .from("companies")
        .select("slug,name,logo,url,twitter,github,has_been_hacked,has_bug_bounty,total_raised_usd,last_audit_date,category")
        .in("slug", slugs);
      const cMap = new Map<string, any>();
      for (const c of (comps ?? []) as any[]) cMap.set(c.slug, c);

      return positions.map((p) => {
        const c = cMap.get(p.company_slug) || {};
        return {
          company_slug: p.company_slug,
          company_name: p.company_name || c.name || p.company_slug,
          category: p.category || c.category || null,
          round_type: p.round_type,
          amount_usd: p.amount_usd,
          round_date: p.round_date,
          fund_name: p.fund_name,
          logo: c.logo ?? null,
          url: c.url ?? null,
          twitter: c.twitter ?? null,
          github: c.github ?? null,
          has_been_hacked: c.has_been_hacked ?? null,
          has_bug_bounty: c.has_bug_bounty ?? null,
          total_raised_usd: c.total_raised_usd ?? null,
          last_audit_date: c.last_audit_date ?? null,
        } as Position;
      }).sort((a, b) => (b.round_date || "").localeCompare(a.round_date || ""));
    },
  });

  const portfolioSlugs = useMemo(() => (positionsQ.data ?? []).map((p) => p.company_slug), [positionsQ.data]);

  // 2) Activity feed
  const activityQ = useQuery({
    queryKey: ["fund-activity", fundSlug, activityScope, portfolioSlugs.length],
    enabled: activityScope === "all" || portfolioSlugs.length > 0,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const sinceDate = since.slice(0, 10);
      const filterToPortfolio = activityScope === "portfolio";

      const newsBuilder = supabase.from("news_items").select("company_slug,title,url,source,sentiment,published_at").gte("published_at", since).order("published_at", { ascending: false }).limit(60);
      const news = filterToPortfolio ? newsBuilder.in("company_slug", portfolioSlugs) : newsBuilder;

      const hacksBuilder = supabase.from("hacks").select("company_slug,name,hack_date,amount_usd,technique,source_url,summary").gte("hack_date", sinceDate).order("hack_date", { ascending: false }).limit(40);
      const hacks = filterToPortfolio ? hacksBuilder.in("company_slug", portfolioSlugs) : hacksBuilder;

      const auditsBuilder = supabase.from("audit_history").select("company_slug,audit_firm,audit_date,report_url").gte("audit_date", sinceDate).order("audit_date", { ascending: false }).limit(40);
      const audits = filterToPortfolio ? auditsBuilder.in("company_slug", portfolioSlugs) : auditsBuilder;

      const signalsBuilder = supabase.from("account_signals").select("company_slug,signal_type,signal_subtype,title,detail,evidence_url,fired_at").gte("fired_at", since).order("fired_at", { ascending: false }).limit(40);
      const signals = filterToPortfolio ? signalsBuilder.in("company_slug", portfolioSlugs) : signalsBuilder;

      const fundingBuilder = supabase.from("funding_rounds").select("company_slug,company_name,amount_usd,round_type,date").gte("date", sinceDate).order("date", { ascending: false }).limit(40);
      const funding = filterToPortfolio ? fundingBuilder.in("company_slug", portfolioSlugs) : fundingBuilder;

      const [n, h, a, s, f] = await Promise.all([news, hacks, audits, signals, funding]);

      const items: ActivityItem[] = [];
      for (const x of (n.data ?? []) as any[]) items.push({
        kind: "news", ts: x.published_at, slug: x.company_slug, name: x.company_slug,
        title: x.title || "news", sub: x.source || "news", url: x.url,
        sev: x.sentiment === "negative" ? "warn" : "info",
      });
      for (const x of (h.data ?? []) as any[]) items.push({
        kind: "hack", ts: x.hack_date, slug: x.company_slug || "", name: x.name || x.company_slug,
        title: `Hack · ${compactUsd(Number(x.amount_usd))}`, sub: x.technique || x.summary?.slice(0, 100) || "incident",
        url: x.source_url, sev: "alert",
      });
      for (const x of (a.data ?? []) as any[]) items.push({
        kind: "audit", ts: x.audit_date, slug: x.company_slug, name: x.company_slug,
        title: `New audit · ${x.audit_firm || "—"}`, sub: x.report_url ? "report published" : "completed",
        url: x.report_url, sev: "info",
      });
      for (const x of (s.data ?? []) as any[]) items.push({
        kind: "hiring", ts: x.fired_at, slug: x.company_slug, name: x.company_slug,
        title: x.title || x.signal_subtype || x.signal_type, sub: x.detail?.slice(0, 100) || x.signal_type,
        url: x.evidence_url, sev: "info",
      });
      for (const x of (f.data ?? []) as any[]) items.push({
        kind: "raise", ts: x.date, slug: x.company_slug, name: x.company_name || x.company_slug,
        title: `Raised ${compactUsd(Number(x.amount_usd))} · ${x.round_type || "round"}`, sub: "fresh capital",
        sev: "warn",
      });

      items.sort((p, q) => (q.ts > p.ts ? 1 : -1));
      return items.slice(0, 80);
    },
  });

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const p of positionsQ.data ?? []) { const cc = canonicalCategory(p.category); if (cc) s.add(cc); }
    return Array.from(s).sort();
  }, [positionsQ.data]);

  const filteredPositions = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const cutoff = sinceDays > 0 ? Date.now() - sinceDays * 86400000 : 0;
    return (positionsQ.data ?? []).filter((p) => {
      if (ql && !(p.company_name || p.company_slug).toLowerCase().includes(ql)) return false;
      const cc = canonicalCategory(p.category) || "";
      if (categoryFilter.size > 0 && !categoryFilter.has(cc)) return false;
      if (minAmt > 0 && (!p.amount_usd || p.amount_usd < minAmt)) return false;
      if (cutoff > 0 && (!p.round_date || new Date(p.round_date).getTime() < cutoff)) return false;
      return true;
    });
  }, [positionsQ.data, q, categoryFilter, minAmt, sinceDays]);

  const headerSubtitle = fundName ? `${(positionsQ.data ?? []).length} positions` : `${(positionsQ.data ?? []).length} positions`;

  return (
    <div className="space-y-4 max-w-[1600px]">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary">Fund workspace</div>
          <h1 className="text-xl font-semibold text-white tracking-tight mt-1">{fundName || "Portfolio"}</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">{headerSubtitle} · ordered by round date</p>
        </div>
        <div className="inline-flex rounded-md bg-white/[0.03] border border-white/[0.06] p-0.5 text-[11px]">
          <button type="button" onClick={() => setView("list")} className={`px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 transition-colors ${view === "list" ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-white"}`}>
            <List className="w-3 h-3" /> List
          </button>
          <button type="button" onClick={() => setView("grid")} className={`px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 transition-colors ${view === "grid" ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-white"}`}>
            <LayoutGrid className="w-3 h-3" /> Grid
          </button>
        </div>
      </header>

      {/* Filter bar */}
      <div className="as-card p-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-[320px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search portfolio…" className="w-full pl-8 pr-3 py-1.5 text-[12px] bg-white/[0.03] border border-white/[0.08] rounded text-white placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40" />
        </div>
        <Filter className="w-3 h-3 text-muted-foreground" />
        <CategoryMultiSelect universe={categories} selected={categoryFilter} onToggle={toggleCategory} onClear={() => setCategoryFilter(new Set())} />
        <select value={minAmt} onChange={(e) => setMinAmt(Number(e.target.value))} className="bg-white/[0.03] border border-white/[0.08] rounded px-2 py-1.5 text-[12px] text-white">
          <option value="0">Any amount</option>
          <option value="1000000">$1M+</option>
          <option value="5000000">$5M+</option>
          <option value="10000000">$10M+</option>
          <option value="50000000">$50M+</option>
          <option value="100000000">$100M+</option>
        </select>
        <select value={sinceDays} onChange={(e) => setSinceDays(Number(e.target.value))} className="bg-white/[0.03] border border-white/[0.08] rounded px-2 py-1.5 text-[12px] text-white">
          <option value="0">Any date</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="180">Last 6 months</option>
          <option value="365">Last 12 months</option>
          <option value="730">Last 2 years</option>
        </select>
        <span className="text-[10.5px] text-muted-foreground ml-auto">{filteredPositions.length} of {(positionsQ.data ?? []).length}</span>
      </div>

      <CategoryFilterStrip selected={categoryFilter} onToggle={toggleCategory} onClear={() => setCategoryFilter(new Set())} />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        {/* MAIN — positions */}
        <div>
          {positionsQ.isLoading ? (
            <div className="as-card p-8 text-center text-xs text-muted-foreground">Loading portfolio…</div>
          ) : filteredPositions.length === 0 ? (
            <div className="as-card p-8 text-center text-xs text-muted-foreground">
              {(positionsQ.data ?? []).length === 0 ? "No portfolio companies on file for this fund." : "No positions match the current filters."}
            </div>
          ) : view === "grid" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredPositions.map((p) => (
                <Link key={p.company_slug} to={`/protocol/${p.company_slug}`} className="as-card p-3.5 hover:border-primary/40 hover:bg-white/[0.025] transition-colors flex flex-col gap-2.5 group">
                  <div className="flex items-start gap-2.5">
                    <BrandLogo name={p.company_name || p.company_slug} url={p.url} logo={p.logo} className="w-10 h-10 rounded-md shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-white truncate group-hover:text-primary">{p.company_name || p.company_slug}</div>
                      <div className="text-[10px] truncate"><CategoryChip cat={p.category} selected={categoryFilter} onToggle={toggleCategory} stopProp /></div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {p.has_been_hacked && <Skull className="w-3 h-3 text-rose-400" aria-label="Past hack" />}
                      {p.has_bug_bounty && <Bug className="w-3 h-3 text-emerald-300" aria-label="Active bug bounty" />}
                    </div>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 pt-1 border-t border-white/[0.04]">
                    <div>
                      <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">Their round</div>
                      <div className="text-base font-bold text-emerald-300 tabular-nums">{compactUsd(p.amount_usd)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80">{p.round_type || "round"}</div>
                      <div className="text-[11px] text-white/85 tabular-nums">{p.round_date || "—"}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground border-t border-white/[0.04] pt-2 mt-auto">
                    {p.url && <a href={p.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="hover:text-primary inline-flex items-center gap-1"><Globe className="w-2.5 h-2.5" /></a>}
                    {p.twitter && <a href={`https://x.com/${p.twitter}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="hover:text-primary inline-flex items-center gap-1"><Twitter className="w-2.5 h-2.5" /></a>}
                    {p.github && <a href={`https://github.com/${p.github}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="hover:text-primary inline-flex items-center gap-1"><Github className="w-2.5 h-2.5" /></a>}
                    <span className="ml-auto">{p.last_audit_date ? `audited ${p.last_audit_date}` : "no audit"}</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="as-card p-0 overflow-hidden">
              <div className="overflow-x-auto max-h-[760px]">
                <table className="w-full text-xs">
                  <thead className="bg-white/[0.02] border-b border-white/[0.04] sticky top-0 z-10">
                    <tr className="text-left text-[10px] uppercase tracking-[0.08em] font-medium text-muted-foreground">
                      <th className="px-3 py-2.5">Company</th>
                      <th className="px-3 py-2.5">Category</th>
                      <th className="px-3 py-2.5">Round</th>
                      <th className="px-2 py-2.5 text-right">Our raise</th>
                      <th className="px-2 py-2.5 text-right">Total raised</th>
                      <th className="px-3 py-2.5">Date</th>
                      <th className="px-2 py-2.5 text-center">Flags</th>
                      <th className="px-2 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {filteredPositions.map((p) => (
                      <tr key={p.company_slug} className="hover:bg-white/[0.02]">
                        <td className="px-3 py-2.5">
                          <Link to={`/protocol/${p.company_slug}`} className="flex items-center gap-2 hover:text-primary">
                            <BrandLogo name={p.company_name || p.company_slug} url={p.url} logo={p.logo} className="w-7 h-7 rounded shrink-0" />
                            <span className="text-sm text-white truncate max-w-[200px]">{p.company_name || p.company_slug}</span>
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-[11px]"><CategoryChip cat={p.category} selected={categoryFilter} onToggle={toggleCategory} /></td>
                        <td className="px-3 py-2.5 text-[11px] text-white/80">{p.round_type || "—"}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums text-emerald-300 font-medium">{compactUsd(p.amount_usd)}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{compactUsd(p.total_raised_usd)}</td>
                        <td className="px-3 py-2.5 text-[11px] text-muted-foreground tabular-nums">{p.round_date || "—"}</td>
                        <td className="px-2 py-2.5 text-center">
                          <div className="inline-flex items-center gap-1">
                            {p.has_been_hacked && <Skull className="w-3 h-3 text-rose-400" />}
                            {p.has_bug_bounty && <Bug className="w-3 h-3 text-emerald-300" />}
                            {!p.has_been_hacked && !p.has_bug_bounty && <span className="text-muted-foreground/40">—</span>}
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <Link to={`/protocol/${p.company_slug}`} className="text-muted-foreground hover:text-primary inline-flex items-center"><ArrowRight className="w-3 h-3" /></Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT RAIL — activity */}
        <div className="space-y-3">
          <div className="as-card p-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-white/[0.06] bg-white/[0.02] flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-primary" />
              <h3 className="text-[11px] font-semibold text-white uppercase tracking-wider">Live activity</h3>
              <span className="text-[10px] text-muted-foreground ml-auto">{(activityQ.data ?? []).length} · 30d</span>
            </div>
            <div className="px-3 py-2 border-b border-white/[0.06] flex items-center">
              <div className="inline-flex rounded-md bg-white/[0.03] border border-white/[0.06] p-0.5 text-[10px]">
                <button type="button" onClick={() => setActivityScope("portfolio")} className={`px-2 py-1 rounded transition-colors ${activityScope === "portfolio" ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-white"}`}>My portfolio</button>
                <button type="button" onClick={() => setActivityScope("all")} className={`px-2 py-1 rounded transition-colors ${activityScope === "all" ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-white"}`}>All</button>
              </div>
            </div>
            {activityQ.isLoading ? (
              <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">Loading activity…</div>
            ) : (activityQ.data ?? []).length === 0 ? (
              <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">No activity in the last 30 days.</div>
            ) : (
              <div className="divide-y divide-white/[0.04] max-h-[680px] overflow-y-auto">
                {(activityQ.data ?? []).map((e, i) => {
                  const dotCls = e.sev === "alert" ? "bg-rose-400" : e.sev === "warn" ? "bg-amber-400" : "bg-sky-400";
                  const kindIcon = e.kind === "hack" ? <Skull className="w-2.5 h-2.5" />
                    : e.kind === "audit" ? <ShieldCheck className="w-2.5 h-2.5" />
                    : e.kind === "raise" ? <Banknote className="w-2.5 h-2.5" />
                    : e.kind === "hiring" ? <Briefcase className="w-2.5 h-2.5" />
                    : e.kind === "signal" ? <AlertTriangle className="w-2.5 h-2.5" />
                    : <Newspaper className="w-2.5 h-2.5" />;
                  return (
                    <div key={i} className="px-3 py-2 hover:bg-white/[0.02]">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${dotCls} shrink-0`} />
                        {e.slug ? (
                          <Link to={`/protocol/${e.slug}`} className="text-[11px] font-medium text-white truncate flex-1 hover:text-primary">{e.name || e.slug}</Link>
                        ) : (
                          <span className="text-[11px] font-medium text-white truncate flex-1">{e.name}</span>
                        )}
                        <span className="text-[9px] uppercase font-bold text-muted-foreground inline-flex items-center gap-1 shrink-0">{kindIcon}{e.kind}</span>
                        <span className="text-[9px] text-muted-foreground tabular-nums shrink-0">{tightAgo(e.ts)}</span>
                      </div>
                      <div className="text-[11px] text-white/85 line-clamp-2 mt-0.5">{e.title}</div>
                      <div className="text-[10px] text-muted-foreground/80 line-clamp-1 flex items-center gap-1.5">
                        <span className="truncate">{e.sub}</span>
                        {e.url && (
                          <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline shrink-0 ml-auto">open ↗</a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
