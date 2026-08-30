import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search, FileText, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";
import { ViewToggle, type ViewMode, loadViewMode, saveViewMode } from "@/components/ViewToggle";

const PAGE_SIZE = 24;
const STORAGE_KEY = "audits";

type Row = {
  id: string; audit_firm: string | null; audit_date: string | null; audit_type: string | null;
  protocol_name: string | null; company_slug: string | null; report_url: string | null;
  findings_critical: number | null; findings_high: number | null; findings_medium: number | null; findings_low: number | null;
  company_name?: string; company_logo?: string | null; company_url?: string | null;
};

const SEV = [
  { key: "findings_critical", label: "C", cls: "text-rose-300 bg-rose-500/10 border-rose-500/25" },
  { key: "findings_high", label: "H", cls: "text-orange-300 bg-orange-500/10 border-orange-500/25" },
  { key: "findings_medium", label: "M", cls: "text-amber-300 bg-amber-500/10 border-amber-500/25" },
  { key: "findings_low", label: "L", cls: "text-sky-300 bg-sky-500/10 border-sky-500/25" },
] as const;

function findingsOf(r: Row) {
  return SEV.map((s) => ({ ...s, n: (r[s.key as keyof Row] as number) || 0 })).filter((s) => s.n > 0);
}

export default function AuditReports() {
  const [q, setQ] = useState("");
  const [firm, setFirm] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [view, setView] = useState<ViewMode>(() => loadViewMode(STORAGE_KEY, "grid"));
  const setViewPersist = (v: ViewMode) => { setView(v); saveViewMode(STORAGE_KEY, v); };

  const firmListQ = useQuery({
    queryKey: ["audit-firm-list"],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.rpc("trend_firm_totals", { p_firm: null });
      return ((data ?? []) as any[]).map((r) => r.audit_firm).filter(Boolean).slice(0, 60);
    },
  });

  const rowsQ = useQuery({
    queryKey: ["audits-view", q, firm, page],
    keepPreviousData: true,
    queryFn: async () => {
      let query = supabase
        .from("audit_history")
        .select("id,audit_firm,audit_date,audit_type,protocol_name,company_slug,report_url,findings_critical,findings_high,findings_medium,findings_low", { count: "exact" })
        .order("audit_date", { ascending: false, nullsFirst: false });
      if (q.trim().length >= 2) query = query.or(`protocol_name.ilike.%${q.trim()}%,audit_firm.ilike.%${q.trim()}%`);
      if (firm !== "all") query = query.eq("audit_firm", firm);
      query = query.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, count, error } = await query;
      if (error) throw error;
      const rows = (data ?? []) as Row[];
      const slugs = Array.from(new Set(rows.map((r) => r.company_slug).filter(Boolean))) as string[];
      const cmap = new Map<string, any>();
      if (slugs.length) {
        const { data: comps } = await supabase.from("companies").select("slug,name,logo,url").in("slug", slugs);
        for (const c of (comps ?? []) as any[]) cmap.set(c.slug, c);
      }
      return {
        rows: rows.map((r) => {
          const c = cmap.get(r.company_slug!);
          return { ...r, company_name: c?.name || r.protocol_name || r.company_slug, company_logo: c?.logo || null, company_url: c?.url || null };
        }),
        count: count ?? 0,
      };
    },
  });

  const rows = rowsQ.data?.rows ?? [];
  const total = rowsQ.data?.count ?? 0;

  return (
    <div className="max-w-[1200px] mx-auto space-y-4">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary">Audits</div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight mt-0.5">
            {total.toLocaleString()}<span className="text-muted-foreground text-[15px] font-normal ml-2">reports</span>
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ViewToggle value={view} onChange={setViewPersist} />
          <select value={firm} onChange={(e) => { setFirm(e.target.value); setPage(0); }}
            className="text-[12.5px] bg-white/[0.03] border border-white/[0.08] rounded-md px-2.5 py-2 text-muted-foreground hover:text-foreground max-w-[170px]">
            <option value="all">All auditors</option>
            {(firmListQ.data ?? []).map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input className="as-input pl-7 py-2 text-[12.5px]" placeholder="Search protocol or auditor…"
              value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          </div>
        </div>
      </header>

      {rowsQ.isLoading && <div className="as-card p-6 text-center text-sm text-muted-foreground">Loading…</div>}
      {!rowsQ.isLoading && rows.length === 0 && <div className="as-card p-8 text-center text-sm text-muted-foreground">No audits match.</div>}

      {/* GRID */}
      {view === "grid" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map((r) => {
            const findings = findingsOf(r);
            return (
              <div key={r.id} className="as-card p-4 flex flex-col gap-3 hover:border-primary/40 transition-colors">
                <Link to={`/protocol/${r.company_slug}`} className="flex items-center gap-3 group">
                  <BrandLogo name={r.company_name || "?"} url={r.company_url} logo={r.company_logo} className="w-10 h-10 rounded-lg" />
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-foreground group-hover:text-primary truncate">{r.company_name}</div>
                    <div className="text-[11px] text-muted-foreground">{r.audit_date || "date unknown"}</div>
                  </div>
                </Link>
                <Link to={`/auditors/${encodeURIComponent(r.audit_firm || "")}`} className="flex items-center gap-2 group/firm">
                  <BrandLogo name={r.audit_firm || "Unknown"} className="w-6 h-6 rounded-md" />
                  <span className="text-[12px] text-muted-foreground group-hover/firm:text-primary truncate">
                    audited by <span className="text-foreground/90 font-medium">{r.audit_firm || "Unknown"}</span>
                  </span>
                </Link>
                <div className="flex items-center justify-between pt-1 mt-auto border-t border-white/[0.05]">
                  <div className="flex items-center gap-1">
                    {findings.length > 0 ? findings.map((s) => (
                      <span key={s.key} className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${s.cls}`}>{s.n}{s.label}</span>
                    )) : <span className="text-[10.5px] text-muted-foreground/50">findings not parsed</span>}
                  </div>
                  {r.report_url ? (
                    <a href={r.report_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-medium">
                      <FileText className="w-3 h-3" /> Report <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  ) : <span className="text-[10.5px] text-muted-foreground/40">no report</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* LIST */}
      {view === "list" && (
        <div className="as-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2.5">Protocol</th>
                  <th className="px-3 py-2.5">Auditor</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Findings</th>
                  <th className="px-3 py-2.5 text-right">Report</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const findings = findingsOf(r);
                  return (
                    <tr key={r.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                      <td className="px-3 py-2">
                        <Link to={`/protocol/${r.company_slug}`} className="flex items-center gap-2 group">
                          <BrandLogo name={r.company_name || "?"} url={r.company_url} logo={r.company_logo} className="w-6 h-6 rounded" />
                          <span className="text-foreground group-hover:text-primary truncate max-w-[200px] font-medium">{r.company_name}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <Link to={`/auditors/${encodeURIComponent(r.audit_firm || "")}`} className="flex items-center gap-2 group">
                          <BrandLogo name={r.audit_firm || "Unknown"} className="w-5 h-5 rounded" />
                          <span className="text-muted-foreground group-hover:text-primary truncate max-w-[150px]">{r.audit_firm || "Unknown"}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap">{r.audit_date || "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          {findings.length > 0 ? findings.map((s) => (
                            <span key={s.key} className={`text-[9.5px] px-1 py-0.5 rounded border font-mono ${s.cls}`}>{s.n}{s.label}</span>
                          )) : <span className="text-muted-foreground/40">—</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.report_url ? (
                          <a href={r.report_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            <FileText className="w-3 h-3" /> <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        ) : <span className="text-muted-foreground/40 text-[10.5px]">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2">
          <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="px-3 py-1.5 rounded-md border border-white/[0.06] disabled:opacity-40 hover:bg-white/[0.03]">← Prev</button>
          <span className="font-mono tabular-nums">Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE)).toLocaleString()}</span>
          <button disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 rounded-md border border-white/[0.06] disabled:opacity-40 hover:bg-white/[0.03]">Next →</button>
        </div>
      )}
    </div>
  );
}
