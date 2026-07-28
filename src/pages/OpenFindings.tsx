import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, Download, ArrowRight, Filter, Calendar, ShieldCheck } from "lucide-react";
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

function daysSince(d: string | null | undefined): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

type FindingRow = {
  id: string;
  audit_id: string | null;
  company_slug: string;
  severity: string | null;
  title: string;
  summary: string | null;
  status: string | null;
  audit_firm: string | null;
  audit_date: string | null;
  report_url: string | null;
  company_name: string;
  company_url: string | null;
  company_logo: string | null;
  category: string | null;
  tvl: number | null;
  days_old: number | null;
  exposure_score: number; // severity_weight × TVL log
};

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 100,
  high: 40,
  medium: 10,
  low: 3,
  informational: 1,
};

export default function OpenFindings() {
  const { user } = useAuth();
  const [scope, setScope] = useState<"portfolio" | "all">("portfolio");
  const [severityFilter, setSeverityFilter] = useState<"all" | "critical" | "high" | "medium" | "low">("all");
  const [sortKey, setSortKey] = useState<"exposure" | "severity" | "age" | "tvl">("exposure");
  const [searchQ, setSearchQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "unresolved">("unresolved");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  // Profile -> fund slug
  const profileQ = useQuery({
    queryKey: ["of-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("user_profiles").select("fund_slug").eq("user_id", user!.id).maybeSingle();
      return data as { fund_slug: string | null } | null;
    },
  });
  const fundSlug = profileQ.data?.fund_slug ?? null;

  // Slugs in scope
  const slugsQ = useQuery({
    queryKey: ["of-slugs", scope, fundSlug],
    queryFn: async (): Promise<string[] | null> => {
      if (scope === "all") return null;
      if (!fundSlug) return null;
      const { data } = await supabase.from("fund_portfolio").select("company_slug").eq("fund_slug", fundSlug);
      return Array.from(new Set((data ?? []).map((r: any) => r.company_slug as string).filter(Boolean)));
    },
  });

  const slugs = slugsQ.data;

  // Fetch findings detail in batches
  const findingsQ = useQuery({
    queryKey: ["of-findings", scope, slugs?.length],
    queryFn: async (): Promise<any[]> => {
      const all: any[] = [];
      // If portfolio scope and we have slugs, filter by them. Otherwise fetch all.
      let from = 0;
      const PAGE = 1000;
      while (true) {
        let q = supabase
          .from("audit_findings_detail")
          .select("id,audit_id,company_slug,severity,title,summary,status,created_at")
          .in("severity", ["critical", "high", "medium"])
          .order("created_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (slugs && slugs.length > 0) q = q.in("company_slug", slugs);
        if (slugs && slugs.length === 0) return [];
        const { data, error } = await q;
        if (error || !data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
        from += PAGE;
        if (all.length > 5000) break; // safety
      }
      return all;
    },
  });

  const distinctSlugs = useMemo(() => Array.from(new Set((findingsQ.data ?? []).map((f: any) => f.company_slug))), [findingsQ.data]);

  // Companies meta + audit context
  const enrichQ = useQuery({
    queryKey: ["of-enrich", distinctSlugs.length],
    enabled: distinctSlugs.length > 0,
    queryFn: async () => {
      const [comp, audits, tvl] = await Promise.all([
        supabase.from("companies").select("slug,name,url,logo,category").in("slug", distinctSlugs),
        supabase.from("audit_history").select("id,company_slug,audit_firm,audit_date,report_url").in("company_slug", distinctSlugs),
        supabase.from("protocol_metrics").select("company_slug,tvl,date").in("company_slug", distinctSlugs).not("tvl", "is", null).order("date", { ascending: false }).limit(2000),
      ]);
      const compMap = new Map<string, any>();
      for (const c of (comp.data ?? []) as any[]) compMap.set(c.slug, c);
      const auditMap = new Map<string, any>();
      for (const a of (audits.data ?? []) as any[]) auditMap.set(a.id, a);
      const tvlMap = new Map<string, number>();
      for (const r of (tvl.data ?? []) as any[]) {
        if (!tvlMap.has(r.company_slug)) tvlMap.set(r.company_slug, Number(r.tvl));
      }
      return { compMap, auditMap, tvlMap };
    },
  });

  const rows: FindingRow[] = useMemo(() => {
    if (!findingsQ.data || !enrichQ.data) return [];
    const { compMap, auditMap, tvlMap } = enrichQ.data;
    return findingsQ.data.map((f: any) => {
      const co = compMap.get(f.company_slug);
      const a = f.audit_id ? auditMap.get(f.audit_id) : null;
      const tvl = tvlMap.get(f.company_slug) ?? null;
      const days = daysSince(a?.audit_date || f.created_at);
      const sevW = SEVERITY_WEIGHT[(f.severity || "").toLowerCase()] || 0;
      const tvlLog = tvl ? Math.log10(Math.max(tvl, 1) + 1) : 1;
      return {
        id: f.id,
        audit_id: f.audit_id,
        company_slug: f.company_slug,
        severity: f.severity,
        title: f.title || "Untitled finding",
        summary: f.summary,
        status: f.status,
        audit_firm: a?.audit_firm ?? null,
        audit_date: a?.audit_date ?? null,
        report_url: a?.report_url ?? null,
        company_name: co?.name || f.company_slug,
        company_url: co?.url || null,
        company_logo: co?.logo || null,
        category: co?.category || null,
        tvl,
        days_old: days,
        exposure_score: sevW * tvlLog,
      };
    });
  }, [findingsQ.data, enrichQ.data]);

  const categories = useMemo(() => Array.from(new Set(rows.map((r) => r.category).filter(Boolean) as string[])).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (q && !(r.title.toLowerCase().includes(q) || r.company_name.toLowerCase().includes(q))) return false;
      if (severityFilter !== "all" && (r.severity || "").toLowerCase() !== severityFilter) return false;
      if (categoryFilter && r.category !== categoryFilter) return false;
      if (statusFilter === "unresolved") {
        const s = (r.status || "").toLowerCase();
        if (s === "fixed" || s === "resolved" || s === "acknowledged" || s === "remediated") return false;
      }
      if (statusFilter === "open") {
        const s = (r.status || "").toLowerCase();
        if (s !== "open" && s !== "" && s !== "pending") return false;
      }
      return true;
    });
    list.sort((a, b) => {
      switch (sortKey) {
        case "exposure": return b.exposure_score - a.exposure_score;
        case "severity": return (SEVERITY_WEIGHT[(b.severity || "").toLowerCase()] || 0) - (SEVERITY_WEIGHT[(a.severity || "").toLowerCase()] || 0);
        case "age": return (b.days_old ?? 0) - (a.days_old ?? 0);
        case "tvl": return (b.tvl ?? -1) - (a.tvl ?? -1);
      }
    });
    return list;
  }, [rows, searchQ, severityFilter, categoryFilter, statusFilter, sortKey]);

  // Group by company for the "by-protocol" view
  const byCompany = useMemo(() => {
    const m = new Map<string, { row: FindingRow; total: number; critical: number; high: number; medium: number; items: FindingRow[] }>();
    for (const r of filtered) {
      const k = r.company_slug;
      const e = m.get(k) ?? { row: r, total: 0, critical: 0, high: 0, medium: 0, items: [] };
      e.total++;
      const s = (r.severity || "").toLowerCase();
      if (s === "critical") e.critical++;
      else if (s === "high") e.high++;
      else if (s === "medium") e.medium++;
      e.items.push(r);
      m.set(k, e);
    }
    return Array.from(m.values()).sort((a, b) => (b.critical * 100 + b.high * 40 + b.medium * 10) - (a.critical * 100 + a.high * 40 + a.medium * 10));
  }, [filtered]);

  const totals = useMemo(() => {
    const t = { total: filtered.length, critical: 0, high: 0, medium: 0, protocols: byCompany.length };
    for (const r of filtered) {
      const s = (r.severity || "").toLowerCase();
      if (s === "critical") t.critical++;
      else if (s === "high") t.high++;
      else if (s === "medium") t.medium++;
    }
    return t;
  }, [filtered, byCompany.length]);

  const exportCsv = () => {
    const header = ["company_slug", "company_name", "severity", "title", "status", "audit_firm", "audit_date", "tvl", "days_old", "exposure_score", "report_url"];
    const csvRows = filtered.map((r) => [
      r.company_slug, r.company_name, r.severity || "", r.title.replace(/[\r\n]+/g, " "),
      r.status || "", r.audit_firm || "", r.audit_date || "",
      r.tvl ?? "", r.days_old ?? "", r.exposure_score.toFixed(0), r.report_url || "",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csv = [header.join(","), ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `open-findings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const [viewMode, setViewMode] = useState<"flat" | "by_company">("flat");

  return (
    <div className="space-y-5 max-w-[1700px]">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-rose-300" />
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight">Open findings</h1>
            <p className="text-[11px] text-muted-foreground mt-1">
              {fundSlug ? "Portfolio" : "Watchlist"} findings ranked by severity × TVL. Click any row to verify fix status with the protocol.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[11px] text-muted-foreground rounded border border-white/[0.08] px-2 py-1 inline-flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${scope === "portfolio" ? "bg-primary" : "bg-muted-foreground/40"}`} />
            scope:
            <button onClick={() => setScope("portfolio")} className={scope === "portfolio" ? "text-white" : "hover:text-white"}>portfolio</button>
            <span className="text-muted-foreground/40">·</span>
            <button onClick={() => setScope("all")} className={scope === "all" ? "text-white" : "hover:text-white"}>all-companies</button>
          </div>
          <button onClick={exportCsv} type="button" className="text-xs text-muted-foreground hover:text-white inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-white/[0.08] hover:bg-white/[0.03]">
            <Download className="w-3 h-3" /> CSV
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile label="Total open" value={totals.total.toString()} hint={`${totals.protocols} protocols`} tone="neutral" />
        <Tile label="Critical" value={totals.critical.toString()} tone="alert" hint="severity 1" />
        <Tile label="High" value={totals.high.toString()} tone="warn" hint="severity 2" />
        <Tile label="Medium" value={totals.medium.toString()} tone="neutral" hint="severity 3" />
        <Tile label="Coverage" value={`${totals.protocols}`} hint="protocols with findings" tone="neutral" />
      </div>

      {/* Filter bar */}
      <div className="as-card p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search findings or protocols…"
            className="as-input text-xs w-56"
          />
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as any)} className="as-input text-xs">
            <option value="exposure">Exposure (severity × TVL)</option>
            <option value="severity">Severity</option>
            <option value="age">Age (oldest first)</option>
            <option value="tvl">TVL exposure</option>
          </select>
          <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as any)} className="as-input text-xs">
            <option value="all">All severities</option>
            <option value="critical">Critical only</option>
            <option value="high">High only</option>
            <option value="medium">Medium only</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="as-input text-xs">
            <option value="unresolved">Unresolved (default)</option>
            <option value="open">Open / pending</option>
            <option value="all">All statuses</option>
          </select>
          <select value={categoryFilter ?? ""} onChange={(e) => setCategoryFilter(e.target.value || null)} className="as-input text-xs">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="flex-1" />
          <div className="inline-flex rounded border border-white/[0.08] text-[11px] overflow-hidden">
            <button onClick={() => setViewMode("flat")} className={`px-2 py-1 ${viewMode === "flat" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-white"}`}>flat</button>
            <button onClick={() => setViewMode("by_company")} className={`px-2 py-1 border-l border-white/[0.08] ${viewMode === "by_company" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-white"}`}>by protocol</button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="as-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{viewMode === "flat" ? "All findings" : "Findings by protocol"}</h3>
          <span className="text-xs text-muted-foreground">{filtered.length} of {rows.length}</span>
        </div>
        {findingsQ.isLoading || enrichQ.isLoading ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">Loading findings…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            No findings ingested yet for this scope. {scope === "portfolio" && !fundSlug && <>Set a fund in Profile to scope to your portfolio.</>}
          </div>
        ) : viewMode === "flat" ? (
          <FlatTable rows={filtered} />
        ) : (
          <ByCompanyView groups={byCompany} />
        )}
      </div>
    </div>
  );
}

function FlatTable({ rows }: { rows: FindingRow[] }) {
  return (
    <div className="overflow-x-auto max-h-[700px]">
      <table className="w-full text-xs">
        <thead className="bg-white/[0.02] border-b border-white/[0.04] sticky top-0 z-10">
          <tr className="text-left text-[10px] uppercase tracking-[0.08em] font-medium text-muted-foreground">
            <th className="px-3 py-2.5">Sev</th>
            <th className="px-3 py-2.5">Protocol</th>
            <th className="px-3 py-2.5">Finding</th>
            <th className="px-2 py-2.5">Auditor</th>
            <th className="px-2 py-2.5 text-right">Age</th>
            <th className="px-2 py-2.5 text-right">TVL</th>
            <th className="px-2 py-2.5 text-right">Exposure</th>
            <th className="px-2 py-2.5"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {rows.slice(0, 400).map((r) => (
            <tr key={r.id} className="hover:bg-white/[0.02] align-top">
              <td className="px-3 py-2.5">
                <SeverityChip s={r.severity} />
              </td>
              <td className="px-3 py-2.5">
                <Link to={`/protocol/${r.company_slug}`} className="flex items-center gap-2">
                  <BrandLogo name={r.company_name} url={r.company_url} logo={r.company_logo} className="w-6 h-6 rounded shrink-0" />
                  <div>
                    <div className="text-sm text-white hover:text-primary truncate max-w-[140px]">{r.company_name}</div>
                    {r.category && <div className="text-[10px] text-muted-foreground">{r.category}</div>}
                  </div>
                </Link>
              </td>
              <td className="px-3 py-2.5 max-w-[480px]">
                <div className="text-[13px] text-white/90 line-clamp-2">{r.title}</div>
                {r.summary && <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{r.summary}</div>}
              </td>
              <td className="px-2 py-2.5 text-[11px]">
                <div className="text-white/85 truncate max-w-[110px]">{r.audit_firm || "—"}</div>
                <div className="text-muted-foreground">{r.audit_date || ""}</div>
              </td>
              <td className="px-2 py-2.5 text-right text-[11px] tabular-nums text-muted-foreground">
                {r.days_old != null ? (
                  <span className={r.days_old > 365 ? "text-amber-300" : r.days_old > 180 ? "text-amber-200/80" : ""}>
                    {r.days_old}d
                  </span>
                ) : "—"}
              </td>
              <td className="px-2 py-2.5 text-right tabular-nums">{compactUsd(r.tvl)}</td>
              <td className="px-2 py-2.5 text-right tabular-nums text-[11px] text-rose-200">
                {Math.round(r.exposure_score)}
              </td>
              <td className="px-2 py-2.5">
                {r.report_url ? (
                  <a href={r.report_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary inline-flex items-center"><ArrowRight className="w-3 h-3" /></a>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 400 && (
        <div className="px-4 py-3 text-xs text-muted-foreground text-center">Showing 400 of {rows.length}. Refine filters to see more.</div>
      )}
    </div>
  );
}

function ByCompanyView({ groups }: { groups: Array<{ row: FindingRow; total: number; critical: number; high: number; medium: number; items: FindingRow[] }> }) {
  return (
    <div className="divide-y divide-white/[0.04] max-h-[700px] overflow-y-auto">
      {groups.map((g) => {
        const r = g.row;
        return (
          <details key={r.company_slug} className="group">
            <summary className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-white/[0.02] list-none">
              <BrandLogo name={r.company_name} url={r.company_url} logo={r.company_logo} className="w-8 h-8 rounded-md shrink-0" />
              <div className="flex-1 min-w-0">
                <Link to={`/protocol/${r.company_slug}`} className="text-sm font-medium text-white hover:text-primary truncate inline-block">{r.company_name}</Link>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {r.category || ""} · last audit {r.audit_firm || "—"} {r.audit_date ? `· ${r.audit_date}` : ""} · TVL {compactUsd(r.tvl)}
                </div>
              </div>
              <div className="inline-flex items-center gap-1 shrink-0">
                {g.critical > 0 && <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-200 border border-rose-500/40 tabular-nums text-[10px] font-bold">{g.critical}C</span>}
                {g.high > 0 && <span className="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-200 border border-orange-500/30 tabular-nums text-[10px] font-bold">{g.high}H</span>}
                {g.medium > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-200/80 border border-amber-500/20 tabular-nums text-[10px] font-bold">{g.medium}M</span>}
              </div>
            </summary>
            <div className="px-12 pb-3 pt-1 divide-y divide-white/[0.03]">
              {g.items.slice(0, 25).map((f) => (
                <div key={f.id} className="py-2 flex items-start gap-2">
                  <SeverityChip s={f.severity} small />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-white/90 line-clamp-2">{f.title}</div>
                    {f.summary && <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{f.summary}</div>}
                  </div>
                  {f.report_url && <a href={f.report_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary shrink-0"><ArrowRight className="w-3 h-3" /></a>}
                </div>
              ))}
              {g.items.length > 25 && <div className="py-2 text-[11px] text-muted-foreground">+{g.items.length - 25} more findings</div>}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function SeverityChip({ s, small }: { s: string | null; small?: boolean }) {
  const k = (s || "").toLowerCase();
  const cls: Record<string, string> = {
    critical: "bg-rose-500/25 text-rose-100 border-rose-500/50",
    high: "bg-orange-500/20 text-orange-100 border-orange-500/40",
    medium: "bg-amber-500/15 text-amber-100 border-amber-500/30",
    low: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
    informational: "bg-white/[0.05] text-muted-foreground border-white/[0.08]",
  };
  const label = k || "unknown";
  const sz = small ? "text-[9px] px-1 py-0" : "text-[10px] px-1.5 py-0.5";
  return (
    <span className={`inline-flex items-center font-bold uppercase tracking-wider rounded border ${cls[k] || cls.informational} ${sz}`}>
      {label}
    </span>
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
