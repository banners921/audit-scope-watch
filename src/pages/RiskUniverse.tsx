import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ShieldCheck, AlertTriangle, ArrowRight, Skull, Bug, TrendingUp, Filter, Download,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";

function compactUsd(n: number | null | undefined): string {
  if (!n) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

type ScoredRow = {
  slug: string; name: string; category: string | null;
  url: string | null; logo: string | null;
  composite_score: number; band: string; coverage_pct: number;
  sub_audit: number; sub_onchain: number; sub_activity: number; sub_team: number; sub_funding: number;
  has_been_hacked: boolean; has_bug_bounty: boolean;
  last_audit_firm: string | null; last_audit_date: string | null;
  tvl: number | null;
  total_critical: number; total_high: number;
};

export default function RiskUniverse() {
  const [bandFilter, setBandFilter] = useState<"all" | "critical" | "high" | "medium" | "low">("all");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [auditFilter, setAuditFilter] = useState<"all" | "audited" | "no_audit">("all");
  const [hackedOnly, setHackedOnly] = useState(false);
  const [findingsOnly, setFindingsOnly] = useState(false);
  const [minTvl, setMinTvl] = useState(0);
  const [searchQ, setSearchQ] = useState("");
  const [sortKey, setSortKey] = useState<"score_desc" | "score_asc" | "tvl_desc" | "criticals_desc">("score_desc");

  // Pull all risk-scored protocols + minimal company context
  const universeQ = useQuery({
    queryKey: ["risk-universe"],
    queryFn: async (): Promise<ScoredRow[]> => {
      // Fetch in batches because supabase caps at 1000
      const rows: ScoredRow[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabase
          .from("protocol_risk_scores")
          .select("company_slug,composite_score,band,coverage_pct,sub_audit,sub_onchain,sub_activity,sub_team,sub_funding,data_points,drivers")
          .order("composite_score", { ascending: false })
          .range(from, from + 999);
        if (!data || data.length === 0) break;
        for (const r of data as any[]) {
          rows.push({
            slug: r.company_slug,
            name: r.company_slug,
            category: null,
            url: null, logo: null,
            composite_score: r.composite_score,
            band: r.band,
            coverage_pct: r.coverage_pct,
            sub_audit: r.sub_audit,
            sub_onchain: r.sub_onchain,
            sub_activity: r.sub_activity,
            sub_team: r.sub_team,
            sub_funding: r.sub_funding,
            has_been_hacked: false, has_bug_bounty: false,
            last_audit_firm: null, last_audit_date: null,
            tvl: r.data_points?.latest_tvl ?? null,
            total_critical: r.data_points?.total_critical_findings ?? 0,
            total_high: r.data_points?.total_high_findings ?? 0,
          });
        }
        if (data.length < 1000) break;
        from += 1000;
      }
      // Now batch-enrich with company name/category and hack/bounty flags
      const slugs = rows.map((r) => r.slug);
      const slugMap = new Map<string, ScoredRow>(rows.map((r) => [r.slug, r]));
      for (let i = 0; i < slugs.length; i += 1000) {
        const chunk = slugs.slice(i, i + 1000);
        const [comp, last] = await Promise.all([
          supabase.from("companies").select("slug,name,category,url,logo,has_been_hacked,has_bug_bounty").in("slug", chunk),
          supabase.from("audit_history").select("company_slug,audit_firm,audit_date").in("company_slug", chunk).order("audit_date", { ascending: false, nullsFirst: false }),
        ]);
        for (const c of (comp.data ?? []) as any[]) {
          const r = slugMap.get(c.slug);
          if (r) { r.name = c.name; r.category = c.category; r.url = c.url ?? null; r.logo = c.logo ?? null; r.has_been_hacked = !!c.has_been_hacked; r.has_bug_bounty = !!c.has_bug_bounty; }
        }
        const seen = new Set<string>();
        for (const a of (last.data ?? []) as any[]) {
          if (seen.has(a.company_slug)) continue;
          seen.add(a.company_slug);
          const r = slugMap.get(a.company_slug);
          if (r) { r.last_audit_firm = a.audit_firm; r.last_audit_date = a.audit_date; }
        }
      }
      return rows;
    },
  });

  const universe = universeQ.data ?? [];

  const categories = useMemo(() => Array.from(new Set(universe.map((r) => r.category).filter(Boolean) as string[])).sort(), [universe]);

  const filtered = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    let list = universe.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (bandFilter !== "all" && r.band !== bandFilter) return false;
      if (categoryFilter && r.category !== categoryFilter) return false;
      if (auditFilter === "audited" && !r.last_audit_firm) return false;
      if (auditFilter === "no_audit" && r.last_audit_firm) return false;
      if (hackedOnly && !r.has_been_hacked) return false;
      if (findingsOnly && r.total_critical + r.total_high === 0) return false;
      if (minTvl > 0 && (!r.tvl || r.tvl < minTvl)) return false;
      return true;
    });
    list.sort((a, b) => {
      switch (sortKey) {
        case "score_desc": return b.composite_score - a.composite_score;
        case "score_asc": return a.composite_score - b.composite_score;
        case "tvl_desc": return (b.tvl ?? -1) - (a.tvl ?? -1);
        case "criticals_desc": return (b.total_critical * 5 + b.total_high) - (a.total_critical * 5 + a.total_high);
      }
    });
    return list;
  }, [universe, searchQ, bandFilter, categoryFilter, auditFilter, hackedOnly, findingsOnly, minTvl, sortKey]);

  const stats = useMemo(() => {
    const c: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    let totalCrit = 0;
    for (const r of universe) { c[r.band] = (c[r.band] ?? 0) + 1; totalCrit += r.total_critical; }
    return { c, totalCrit, avgScore: universe.length > 0 ? Math.round(universe.reduce((s, r) => s + r.composite_score, 0) / universe.length) : 0 };
  }, [universe]);

  const exportCsv = () => {
    const header = ["slug", "name", "category", "risk_score", "band", "tvl", "last_audit_firm", "last_audit_date", "criticals", "highs", "hacked", "bounty"];
    const rows = filtered.map((r) => [
      r.slug, r.name, r.category ?? "", r.composite_score, r.band, r.tvl ?? "",
      r.last_audit_firm ?? "", r.last_audit_date ?? "",
      r.total_critical, r.total_high, r.has_been_hacked ? "yes" : "", r.has_bug_bounty ? "yes" : "",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `risk-universe-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5 max-w-[1600px]">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight">Risk Universe</h1>
            <p className="text-[11px] text-muted-foreground mt-1">
              Filter to find what's broken. Sort by risk to triage. Click any row for the dossier.
            </p>
          </div>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile label="Scored protocols" value={universe.length.toString()} hint={`avg ${stats.avgScore}`} tone="neutral" />
        <Tile label="Low risk" value={stats.c.low.toString()} tone="good" />
        <Tile label="Medium" value={stats.c.medium.toString()} tone="warn" />
        <Tile label="High" value={stats.c.high.toString()} tone="alert" />
        <Tile label="Critical" value={stats.c.critical.toString()} tone="alert" />
      </div>

      {/* Filter bar */}
      <div className="as-card p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Search protocols…" className="as-input text-xs w-48" />
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as any)} className="as-input text-xs">
            <option value="score_desc">Risk: high → low</option>
            <option value="score_asc">Risk: low → high</option>
            <option value="criticals_desc">Critical findings</option>
            <option value="tvl_desc">TVL high → low</option>
          </select>
          <select value={bandFilter} onChange={(e) => setBandFilter(e.target.value as any)} className="as-input text-xs">
            <option value="all">All bands</option>
            <option value="critical">Critical only</option>
            <option value="high">High only</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select value={categoryFilter ?? ""} onChange={(e) => setCategoryFilter(e.target.value || null)} className="as-input text-xs">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={auditFilter} onChange={(e) => setAuditFilter(e.target.value as any)} className="as-input text-xs">
            <option value="all">Any audit status</option>
            <option value="audited">Audited only</option>
            <option value="no_audit">No audit on file</option>
          </select>
          <select value={minTvl} onChange={(e) => setMinTvl(Number(e.target.value))} className="as-input text-xs">
            <option value="0">Any TVL</option>
            <option value="1000000">$1M+</option>
            <option value="10000000">$10M+</option>
            <option value="100000000">$100M+</option>
          </select>
          <label className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <input type="checkbox" checked={hackedOnly} onChange={(e) => setHackedOnly(e.target.checked)} className="accent-primary" /> Hacked only
          </label>
          <label className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <input type="checkbox" checked={findingsOnly} onChange={(e) => setFindingsOnly(e.target.checked)} className="accent-primary" /> Findings only
          </label>
          <div className="flex-1" />
          <button onClick={exportCsv} type="button" className="text-xs text-muted-foreground hover:text-white inline-flex items-center gap-1 px-2 py-1 rounded border border-white/[0.06] hover:bg-white/[0.03]">
            <Download className="w-3 h-3" /> CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="as-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">All scored protocols</h3>
          <span className="text-xs text-muted-foreground">{filtered.length} of {universe.length}</span>
        </div>
        {universeQ.isLoading ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">Loading risk universe…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-white/[0.02] border-b border-white/[0.04] sticky top-0">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Protocol</th>
                  <th className="px-2 py-2">Sub-scores (A · O · V · T · F)</th>
                  <th className="px-2 py-2 text-right">TVL</th>
                  <th className="px-2 py-2">Last audit</th>
                  <th className="px-2 py-2 text-center">Findings</th>
                  <th className="px-2 py-2 text-center">Flags</th>
                  <th className="px-2 py-2 text-right">Coverage</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filtered.slice(0, 200).map((r) => (
                  <tr key={r.slug} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-2">
                      <RiskBadge score={r.composite_score} band={r.band} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <BrandLogo name={r.name} url={r.url} logo={r.logo} className="w-6 h-6 rounded shrink-0" />
                        <div>
                          <div className="text-sm text-white truncate max-w-[180px]">{r.name}</div>
                          {r.category && <div className="text-[10px] text-muted-foreground">{r.category}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-[10px] text-muted-foreground tabular-nums">
                      <span className="text-white/85">{r.sub_audit}</span> · {r.sub_onchain} · {r.sub_activity} · {r.sub_team} · {r.sub_funding}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{compactUsd(r.tvl)}</td>
                    <td className="px-2 py-2 text-[11px]">
                      {r.last_audit_firm ? (
                        <>
                          <div className="text-white/85 truncate max-w-[120px]">{r.last_audit_firm}</div>
                          <div className="text-muted-foreground">{r.last_audit_date}</div>
                        </>
                      ) : <span className="text-amber-400/80">no audit</span>}
                    </td>
                    <td className="px-2 py-2 text-center text-[11px]">
                      {r.total_critical + r.total_high > 0 ? (
                        <span className="font-bold text-rose-300">{r.total_critical}C/{r.total_high}H</span>
                      ) : <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {r.has_been_hacked && <Skull className="w-3.5 h-3.5 text-rose-400 inline mx-0.5" />}
                      {r.has_bug_bounty && <Bug className="w-3.5 h-3.5 text-emerald-400 inline mx-0.5" />}
                    </td>
                    <td className="px-2 py-2 text-right text-[10px] text-muted-foreground tabular-nums">{r.coverage_pct}%</td>
                    <td className="px-2 py-2">
                      <Link to={`/protocol/${r.slug}`} className="text-muted-foreground hover:text-primary inline-flex items-center"><ArrowRight className="w-3 h-3" /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 200 && (
              <div className="px-4 py-3 text-xs text-muted-foreground text-center">
                Showing 200 of {filtered.length}. Refine filters to see more.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RiskBadge({ score, band }: { score: number; band: string }) {
  const colors: Record<string, string> = {
    low: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    high: "bg-orange-500/15 text-orange-300 border-orange-500/40",
    critical: "bg-rose-500/20 text-rose-200 border-rose-500/50",
  };
  const cls = colors[band] || colors.medium;
  return (
    <div className={`w-10 h-10 rounded border ${cls} flex flex-col items-center justify-center shrink-0`}>
      <span className="text-sm font-bold tabular-nums leading-none">{score}</span>
      <span className="text-[7px] uppercase tracking-wider opacity-70 mt-0.5">{band}</span>
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
