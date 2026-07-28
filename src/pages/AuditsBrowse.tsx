import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search, ShieldCheck, ExternalLink, FileText, Code2, Calendar, X, Github, BadgeCheck, Crosshair } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { SearchableSelect, type Option } from "@/components/SearchableSelect";
import { ViewToggle, type ViewMode, loadViewMode, saveViewMode } from "@/components/ViewToggle";

const PAGE_SIZE = 36;
const FIRMS_PAGE_SIZE = 30;
type SortMode = "recent" | "most-critical" | "most-findings" | "alpha";
type TabMode = "reports" | "firms";

const TIME_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "365d", label: "Last year" },
];

const SEVERITY_OPTIONS: Option[] = [
  { value: "any", label: "Any severity" },
  { value: "high", label: "High or critical" },
  { value: "critical", label: "Critical only" },
];

const SORT_OPTIONS: Option[] = [
  { value: "recent", label: "Most recent" },
  { value: "most-critical", label: "Most critical findings" },
  { value: "most-findings", label: "Most high findings" },
  { value: "alpha", label: "Name (A–Z)" },
];

const FIRM_SORT_OPTIONS: Option[] = [
  { value: "reports", label: "Most reports" },
  { value: "clients", label: "Most clients" },
  { value: "recent", label: "Most recent activity" },
  { value: "critical", label: "Most critical findings" },
];

export default function AuditsBrowse() {
  const [tab, setTab] = useState<TabMode>(() => {
    if (typeof window === "undefined") return "reports";
    const params = new URLSearchParams(window.location.search);
    const v = params.get("view");
    return v === "firms" ? "firms" : "reports";
  });

  const switchTab = (next: TabMode) => {
    setTab(next);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (next === "firms") params.set("view", "firms"); else params.delete("view");
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    }
  };

  return (
    <div className="max-w-[1380px] mx-auto space-y-5">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary">Audits</div>
          <h1 className="text-3xl font-semibold text-foreground tracking-tight mt-0.5">
            {tab === "reports" ? "Audit reports" : "Audit firms"}
          </h1>
        </div>

        {/* Tab flip */}
        <div className="inline-flex rounded-md border border-white/[0.08] overflow-hidden">
          <button
            onClick={() => switchTab("reports")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              tab === "reports" ? "bg-primary/[0.10] text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText className="w-3.5 h-3.5" /> Reports
          </button>
          <span className="w-px bg-white/[0.06]" />
          <button
            onClick={() => switchTab("firms")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              tab === "firms" ? "bg-primary/[0.10] text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" /> Firms
          </button>
        </div>
      </header>

      {tab === "reports" ? <ReportsView /> : <FirmsView />}
    </div>
  );
}

/* =================== REPORTS VIEW =================== */

function ReportsView() {
  const [q, setQ] = useState("");
  const [firms, setFirms] = useState<string[]>([]);
  const [chains, setChains] = useState<string[]>([]);
  const [time, setTime] = useState<string>("all");
  const [sort, setSort] = useState<SortMode>("recent");
  const [severityMin, setSeverityMin] = useState<string>("any");
  const [page, setPage] = useState(0);

  // Stats
  const statsQ = useQuery({
    queryKey: ["audits-hero-stats"],
    staleTime: 60_000,
    queryFn: async () => {
      const [tot, last7, last24, distinctFirms] = await Promise.all([
        supabase.from("audit_history").select("id", { count: "exact", head: true }),
        supabase.from("audit_history").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
        supabase.from("audit_history").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 24 * 3600000).toISOString()),
        supabase.from("audit_history").select("audit_firm").not("audit_firm", "is", null).limit(50000),
      ]);
      const uniq = new Set<string>();
      for (const r of (distinctFirms.data ?? []) as any[]) if (r.audit_firm) uniq.add(r.audit_firm);
      return { total: tot.count ?? 0, last7d: last7.count ?? 0, last24h: last24.count ?? 0, unique_firms: uniq.size };
    },
  });

  // ALL firms (for dropdown)
  const allFirmsQ = useQuery({
    queryKey: ["audits-all-firms"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Option[]> => {
      const { data } = await supabase.from("audit_history").select("audit_firm").not("audit_firm", "is", null).limit(50000);
      const tally = new Map<string, number>();
      for (const r of (data ?? []) as any[]) if (r.audit_firm) tally.set(r.audit_firm, (tally.get(r.audit_firm) ?? 0) + 1);
      return Array.from(tally.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([v, c]) => ({ value: v, label: v, count: c }));
    },
  });

  // ALL chains (for dropdown)
  const allChainsQ = useQuery({
    queryKey: ["audits-all-chains"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Option[]> => {
      const { data } = await supabase.from("audit_history").select("audited_chains").not("audited_chains", "is", null).limit(50000);
      const tally = new Map<string, number>();
      for (const r of (data ?? []) as any[]) {
        if (Array.isArray(r.audited_chains)) for (const c of r.audited_chains) if (c) tally.set(c, (tally.get(c) ?? 0) + 1);
      }
      return Array.from(tally.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([v, c]) => ({ value: v, label: v, count: c }));
    },
  });

  // Firm metadata for logo on each card
  const firmMetaQ = useQuery({
    queryKey: ["audits-firm-meta-map"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("audit_firm_meta").select("firm_name,logo_url");
      const map: Record<string, { logo_url: string | null }> = {};
      for (const r of (data ?? []) as any[]) map[r.firm_name] = { logo_url: r.logo_url };
      return map;
    },
  });

  const sinceISO = useMemo(() => {
    if (time === "all") return null;
    const days = time === "7d" ? 7 : time === "30d" ? 30 : 365;
    return new Date(Date.now() - days * 86400000).toISOString();
  }, [time]);

  const rowsQ = useQuery({
    queryKey: ["audits-browse-v3", q, firms, chains, time, sort, severityMin, page],
    keepPreviousData: true,
    queryFn: async () => {
      let query = supabase
        .from("audit_history")
        .select(
          "id,company_slug,protocol_name,audit_firm,audit_date,findings_critical,findings_high,findings_medium,findings_low,findings_informational,findings_gas,report_url,audit_type,audited_chains,audit_loc,files_audited_count,audited_repo_url",
          { count: "exact" }
        );
      if (q.trim().length >= 2) {
        query = query.or(`protocol_name.ilike.%${q.trim()}%,audit_firm.ilike.%${q.trim()}%,company_slug.ilike.%${q.trim()}%`);
      }
      if (firms.length > 0) query = query.in("audit_firm", firms);
      if (chains.length === 1) query = query.contains("audited_chains", [chains[0]]);
      else if (chains.length > 1) query = query.overlaps("audited_chains", chains);
      if (sinceISO) query = query.gte("created_at", sinceISO);
      if (severityMin === "critical") query = query.gte("findings_critical", 1);
      else if (severityMin === "high") query = query.or("findings_critical.gte.1,findings_high.gte.1");

      if (sort === "recent") query = query.order("audit_date", { ascending: false, nullsFirst: false });
      else if (sort === "most-critical") query = query.order("findings_critical", { ascending: false, nullsFirst: false });
      else if (sort === "most-findings") query = query.order("findings_high", { ascending: false, nullsFirst: false });
      else if (sort === "alpha") query = query.order("protocol_name", { ascending: true, nullsFirst: false });

      query = query.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as any[], count: count ?? 0 };
    },
  });

  const clearFilters = () => {
    setFirms([]); setChains([]); setQ(""); setSeverityMin("any"); setTime("all"); setPage(0);
  };

  const hasFilters = firms.length > 0 || chains.length > 0 || q.trim().length > 0 || severityMin !== "any" || time !== "all";

  return (
    <div className="space-y-5">
      {/* Hero stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatTile label="Reports indexed" value={statsQ.data?.total?.toLocaleString() ?? "—"} tone="primary" />
        <StatTile label="Last 7 days" value={statsQ.data?.last7d?.toLocaleString() ?? "—"} tone="good" hint={statsQ.data ? `${statsQ.data.last24h} in last 24h` : undefined} />
        <StatTile label="Audit firms" value={statsQ.data?.unique_firms?.toLocaleString() ?? "—"} tone="muted" />
        <StatTile label="Showing" value={rowsQ.data?.count?.toLocaleString() ?? "—"} tone="muted" hint={hasFilters ? "filtered" : "all"} />
      </div>

      {/* Filters */}
      <div className="as-card p-3.5 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative w-60">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              className="as-input pl-7 py-1.5 text-[12px] w-full"
              placeholder="Search protocols, firms…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0); }}
            />
          </div>

          <SearchableSelect
            multi
            values={firms}
            onMultiChange={(vs) => { setFirms(vs); setPage(0); }}
            options={allFirmsQ.data ?? []}
            loading={allFirmsQ.isLoading}
            placeholder="All firms"
          />

          <SearchableSelect
            multi
            values={chains}
            onMultiChange={(vs) => { setChains(vs); setPage(0); }}
            options={allChainsQ.data ?? []}
            loading={allChainsQ.isLoading}
            placeholder="All chains"
          />

          <SearchableSelect
            value={time}
            onChange={(v) => { setTime(v ?? "all"); setPage(0); }}
            options={TIME_OPTIONS}
            placeholder="Time"
          />

          <SearchableSelect
            value={severityMin}
            onChange={(v) => { setSeverityMin(v ?? "any"); setPage(0); }}
            options={SEVERITY_OPTIONS}
            placeholder="Severity"
          />

          <SearchableSelect
            value={sort}
            onChange={(v) => { setSort((v ?? "recent") as SortMode); setPage(0); }}
            options={SORT_OPTIONS}
            placeholder="Sort"
          />

          {hasFilters && (
            <button onClick={clearFilters} className="text-[11px] px-2 py-1.5 rounded-md border border-white/[0.08] hover:bg-white/[0.04] inline-flex items-center gap-1 ml-auto">
              <X className="w-3 h-3" /> Clear filters
            </button>
          )}
        </div>
      </div>

      {rowsQ.isLoading && <div className="as-card p-6 text-center text-sm text-muted-foreground">Loading…</div>}

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {(rowsQ.data?.rows ?? []).map((a) => {
          const meta = firmMetaQ.data?.[a.audit_firm];
          const findings = {
            c: a.findings_critical ?? 0, h: a.findings_high ?? 0, m: a.findings_medium ?? 0,
            l: a.findings_low ?? 0, i: a.findings_informational ?? 0, g: a.findings_gas ?? 0,
          };
          const totalFindings = findings.c + findings.h + findings.m + findings.l + findings.i + findings.g;
          return (
            <Link
              key={a.id}
              to={`/protocol/${a.company_slug}`}
              className="as-card p-4 hover:border-primary/30 transition-colors flex flex-col gap-3 group"
            >
              <SeverityStripe findings={findings} />
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0 overflow-hidden">
                  <ShieldCheck className="w-5 h-5 text-primary/60" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                    {a.protocol_name || a.company_slug}
                  </div>
                  <div className="text-[10.5px] text-muted-foreground mt-0.5 flex items-center gap-1.5 truncate">
                    {meta?.logo_url ? (
                      <img src={meta.logo_url} alt="" className="w-3 h-3 rounded-sm shrink-0" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : null}
                    <span className="truncate">{a.audit_firm || "Unknown firm"}</span>
                    {a.audit_date && (
                      <>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="inline-flex items-center gap-0.5 tabular-nums shrink-0">
                          <Calendar className="w-2.5 h-2.5" />
                          {a.audit_date}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {a.audit_type && (
                  <span className="text-[9.5px] uppercase tracking-wider text-primary/80 bg-primary/[0.08] border border-primary/20 rounded-md px-1.5 py-0.5 font-semibold shrink-0">
                    {a.audit_type}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-4 gap-1">
                <FindingTile label="Crit" n={findings.c} tone="rose" />
                <FindingTile label="High" n={findings.h} tone="amber" />
                <FindingTile label="Med" n={findings.m} tone="yellow" />
                <FindingTile label="Low" n={findings.l} tone="muted" />
              </div>

              <div className="flex items-center justify-between text-[10.5px] text-muted-foreground border-t border-white/[0.04] pt-2 mt-auto">
                <div className="flex items-center gap-2.5 truncate">
                  {a.audit_loc && (
                    <span className="inline-flex items-center gap-1 tabular-nums shrink-0">
                      <Code2 className="w-2.5 h-2.5" /> {a.audit_loc.toLocaleString()} LOC
                    </span>
                  )}
                  {a.files_audited_count && (
                    <span className="inline-flex items-center gap-1 tabular-nums shrink-0">
                      <FileText className="w-2.5 h-2.5" /> {a.files_audited_count}
                    </span>
                  )}
                  {Array.isArray(a.audited_chains) && a.audited_chains.length > 0 && (
                    <span className="inline-flex items-center gap-1 truncate">
                      <span className="opacity-70">on</span> {a.audited_chains.slice(0, 2).join(", ")}{a.audited_chains.length > 2 ? ` +${a.audited_chains.length - 2}` : ""}
                    </span>
                  )}
                  {totalFindings === 0 && !a.audit_loc && !a.files_audited_count && (
                    <span className="text-muted-foreground/60 text-[10px]">No findings extracted</span>
                  )}
                </div>
                {a.report_url && (
                  <a href={a.report_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-primary hover:bg-primary/10 shrink-0 font-medium">
                    PDF <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      {rowsQ.data && rowsQ.data.count > PAGE_SIZE && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="px-3 py-1.5 rounded-md border border-white/[0.06] disabled:opacity-40 hover:bg-white/[0.03]">← Prev</button>
          <span className="font-mono tabular-nums">Page {page + 1} of {Math.ceil(rowsQ.data.count / PAGE_SIZE).toLocaleString()}</span>
          <button type="button" disabled={(page + 1) * PAGE_SIZE >= rowsQ.data.count} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-md border border-white/[0.06] disabled:opacity-40 hover:bg-white/[0.03]">Next →</button>
        </div>
      )}
    </div>
  );
}

/* =================== FIRMS VIEW (formerly Auditors) =================== */

type FirmRow = {
  firm_name: string;
  description: string | null;
  homepage_url: string | null;
  logo_url: string | null;
  verified: boolean | null;
  social_x: string | null;
  social_github: string | null;
  report_count: number;
  client_count: number;
  critical_total: number;
  high_total: number;
  medium_total: number;
  last_audit_date: string | null;
};

function FirmsView() {
  const STORAGE_KEY = "auditors";
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<string>("reports");
  const [page, setPage] = useState(0);
  const [view, setView] = useState<ViewMode>(() => loadViewMode(STORAGE_KEY, "grid"));
  const setViewPersist = (v: ViewMode) => { setView(v); saveViewMode(STORAGE_KEY, v); };

  const rowsQ = useQuery({
    queryKey: ["firms-browse", q, sort, page],
    keepPreviousData: true,
    queryFn: async () => {
      let query = supabase.from("audit_firm_cards").select("*", { count: "exact" });
      if (q.trim().length >= 2) query = query.ilike("firm_name", `%${q.trim()}%`);
      const order =
        sort === "clients" ? "client_count" :
        sort === "recent" ? "last_audit_date" :
        sort === "critical" ? "critical_total" :
        "report_count";
      query = query.order(order, { ascending: false, nullsFirst: false }).range(page * FIRMS_PAGE_SIZE, page * FIRMS_PAGE_SIZE + FIRMS_PAGE_SIZE - 1);
      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as FirmRow[], count: count ?? 0 };
    },
  });

  return (
    <div className="space-y-4">
      <div className="as-card p-3.5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-60">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              className="as-input pl-7 py-1.5 text-[12px] w-full"
              placeholder="Search firms…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0); }}
            />
          </div>
          <SearchableSelect
            value={sort}
            onChange={(v) => { setSort(v ?? "reports"); setPage(0); }}
            options={FIRM_SORT_OPTIONS}
            placeholder="Sort"
          />
          <span className="text-[11px] text-muted-foreground ml-auto">
            {rowsQ.data?.count?.toLocaleString() ?? "—"} firms
          </span>
          <ViewToggle value={view} onChange={setViewPersist} />
        </div>
      </div>

      {rowsQ.isLoading && <div className="as-card p-6 text-center text-sm text-muted-foreground">Loading…</div>}

      {view === "grid" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(rowsQ.data?.rows ?? []).map((f) => {
            const firmSlug = encodeURIComponent(f.firm_name);
            return (
              <Link
                key={f.firm_name}
                to={`/auditors/${firmSlug}`}
                className="as-card p-4 hover:border-primary/30 transition-colors flex flex-col gap-3 group"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0 overflow-hidden">
                    {f.logo_url ? (
                      <img src={f.logo_url} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <ShieldCheck className="w-5 h-5 text-primary/60" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-foreground truncate group-hover:text-primary inline-flex items-center gap-1.5">
                      {f.firm_name}
                      {f.verified && <BadgeCheck className="w-3 h-3 text-emerald-400 shrink-0" />}
                    </div>
                    {f.description && (
                      <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{f.description}</div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-1">
                  <FindingTile label="Reports" n={f.report_count} tone="primary" />
                  <FindingTile label="Clients" n={f.client_count} tone="muted" />
                  <FindingTile label="Crit" n={f.critical_total} tone="rose" />
                  <FindingTile label="High" n={f.high_total} tone="amber" />
                </div>

                <div className="flex items-center justify-between text-[10.5px] text-muted-foreground border-t border-white/[0.04] pt-2 mt-auto">
                  <div className="flex items-center gap-2 truncate">
                    {f.last_audit_date && (
                      <span className="inline-flex items-center gap-1 tabular-nums shrink-0">
                        <Calendar className="w-2.5 h-2.5" /> {f.last_audit_date}
                      </span>
                    )}
                    {f.social_github && (
                      <a href={f.social_github.startsWith("http") ? f.social_github : `https://github.com/${f.social_github}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="hover:text-foreground inline-flex items-center gap-1">
                        <Github className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  {f.homepage_url && (
                    <a href={f.homepage_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 hover:text-primary">
                      {f.homepage_url.replace(/^https?:\/\//, "").replace(/\/$/, "").slice(0, 22)}
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {view === "list" && (
        <div className="as-card overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-medium">Firm</th>
                <th className="px-3 py-2 font-medium text-right">Reports</th>
                <th className="px-3 py-2 font-medium text-right">Clients</th>
                <th className="px-3 py-2 font-medium text-right">Critical</th>
                <th className="px-3 py-2 font-medium text-right">High</th>
                <th className="px-3 py-2 font-medium">Last audit</th>
              </tr>
            </thead>
            <tbody>
              {(rowsQ.data?.rows ?? []).map((f) => (
                <tr key={f.firm_name} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                  <td className="px-3 py-2">
                    <Link to={`/auditors/${encodeURIComponent(f.firm_name)}`} className="flex items-center gap-2 group/cell">
                      <div className="w-6 h-6 shrink-0 rounded overflow-hidden bg-white/[0.04] flex items-center justify-center">
                        {f.logo_url ? <img src={f.logo_url} alt="" className="w-full h-full object-cover" /> : <ShieldCheck className="w-3 h-3 opacity-60" />}
                      </div>
                      <span className="text-foreground group-hover/cell:text-primary truncate font-medium">{f.firm_name}</span>
                      {f.verified && <BadgeCheck className="w-3 h-3 text-emerald-400 shrink-0" />}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-300">{f.report_count.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-primary">{f.client_count.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-rose-300">{f.critical_total.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-300">{f.high_total.toLocaleString()}</td>
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">{f.last_audit_date ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rowsQ.data && rowsQ.data.count > FIRMS_PAGE_SIZE && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="px-3 py-1.5 rounded-md border border-white/[0.06] disabled:opacity-40 hover:bg-white/[0.03]">← Prev</button>
          <span className="font-mono tabular-nums">Page {page + 1} of {Math.ceil(rowsQ.data.count / FIRMS_PAGE_SIZE).toLocaleString()}</span>
          <button type="button" disabled={(page + 1) * FIRMS_PAGE_SIZE >= rowsQ.data.count} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-md border border-white/[0.06] disabled:opacity-40 hover:bg-white/[0.03]">Next →</button>
        </div>
      )}
    </div>
  );
}

/* =================== Shared bits =================== */

function StatTile({ label, value, tone, hint }: { label: string; value: string; tone: "primary" | "good" | "muted"; hint?: string }) {
  const toneCls =
    tone === "primary" ? "text-primary" :
    tone === "good" ? "text-emerald-300" :
    "text-foreground";
  return (
    <div className="as-card p-3">
      <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold tabular-nums mt-0.5 ${toneCls}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function FindingTile({ label, n, tone }: { label: string; n: number; tone: "rose" | "amber" | "yellow" | "muted" | "primary" }) {
  const toneCls =
    tone === "rose" ? "text-rose-300 bg-rose-500/[0.08] border-rose-500/15" :
    tone === "amber" ? "text-amber-300 bg-amber-500/[0.08] border-amber-500/15" :
    tone === "yellow" ? "text-yellow-300 bg-yellow-500/[0.06] border-yellow-500/15" :
    tone === "primary" ? "text-primary bg-primary/[0.08] border-primary/15" :
    "text-muted-foreground bg-white/[0.03] border-white/[0.04]";
  const dim = n === 0 ? "opacity-40" : "";
  return (
    <div className={`rounded-md border ${toneCls} ${dim} px-1.5 py-1 text-center`}>
      <div className="text-[9.5px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-[13px] font-semibold tabular-nums">{n.toLocaleString()}</div>
    </div>
  );
}

function SeverityStripe({ findings }: { findings: { c: number; h: number; m: number; l: number; i: number; g: number } }) {
  const total = findings.c + findings.h + findings.m + findings.l + findings.i + findings.g;
  if (total === 0) return <div className="h-1 rounded-full bg-white/[0.04]" />;
  const seg = (n: number, color: string) => n > 0 ? (
    <div className={color} style={{ flexGrow: n, flexBasis: 0, minWidth: 4 }} title={`${n}`} />
  ) : null;
  return (
    <div className="h-1 rounded-full overflow-hidden flex bg-white/[0.04]">
      {seg(findings.c, "bg-rose-400")}
      {seg(findings.h, "bg-amber-400")}
      {seg(findings.m, "bg-yellow-400")}
      {seg(findings.l, "bg-sky-400/60")}
      {seg(findings.i, "bg-slate-400/40")}
      {seg(findings.g, "bg-emerald-400/40")}
    </div>
  );
}
