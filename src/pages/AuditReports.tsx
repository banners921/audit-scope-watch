import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search, ShieldCheck, FileText, ExternalLink, Building2, Award } from "lucide-react";
import { supabase } from "@/lib/supabase";

const PAGE_SIZE = 24;

type Row = {
  id: string; audit_firm: string | null; audit_date: string | null; audit_type: string | null;
  protocol_name: string | null; company_slug: string | null; report_url: string | null;
  findings_critical: number | null; findings_high: number | null; findings_medium: number | null; findings_low: number | null;
  company_name?: string; company_logo?: string | null;
};

const SEV = [
  { key: "findings_critical", label: "C", cls: "text-rose-300 bg-rose-500/10 border-rose-500/25" },
  { key: "findings_high", label: "H", cls: "text-orange-300 bg-orange-500/10 border-orange-500/25" },
  { key: "findings_medium", label: "M", cls: "text-amber-300 bg-amber-500/10 border-amber-500/25" },
  { key: "findings_low", label: "L", cls: "text-sky-300 bg-sky-500/10 border-sky-500/25" },
] as const;

export default function AuditReports() {
  const [q, setQ] = useState("");
  const [firm, setFirm] = useState<string>("all");
  const [page, setPage] = useState(0);

  // firm logos (once)
  const firmsQ = useQuery({
    queryKey: ["audit-firm-logos"],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("audit_firm_meta").select("firm_name,logo_url");
      const m = new Map<string, string>();
      for (const r of (data ?? []) as any[]) if (r.logo_url) m.set(r.firm_name, r.logo_url);
      return m;
    },
  });

  // firm dropdown list (top firms by audit count)
  const firmListQ = useQuery({
    queryKey: ["audit-firm-list"],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.rpc("trend_firm_totals", { p_firm: null });
      return ((data ?? []) as any[]).map((r) => r.audit_firm).filter(Boolean).slice(0, 60);
    },
  });

  const rowsQ = useQuery({
    queryKey: ["audits-cards", q, firm, page],
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
      // company logos for this page
      const slugs = Array.from(new Set(rows.map((r) => r.company_slug).filter(Boolean))) as string[];
      const cmap = new Map<string, any>();
      if (slugs.length) {
        const { data: comps } = await supabase.from("companies").select("slug,name,logo").in("slug", slugs);
        for (const c of (comps ?? []) as any[]) cmap.set(c.slug, c);
      }
      return {
        rows: rows.map((r) => ({ ...r, company_name: cmap.get(r.company_slug!)?.name || r.protocol_name || r.company_slug, company_logo: cmap.get(r.company_slug!)?.logo || null })),
        count: count ?? 0,
      };
    },
  });

  const firmLogos = firmsQ.data;
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
          <select value={firm} onChange={(e) => { setFirm(e.target.value); setPage(0); }}
            className="text-[12.5px] bg-white/[0.03] border border-white/[0.08] rounded-md px-2.5 py-2 text-muted-foreground hover:text-foreground max-w-[180px]">
            <option value="all">All auditors</option>
            {(firmListQ.data ?? []).map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <div className="relative w-60">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input className="as-input pl-7 py-2 text-[12.5px]" placeholder="Search protocol or auditor…"
              value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          </div>
        </div>
      </header>

      {rowsQ.isLoading && <div className="as-card p-6 text-center text-sm text-muted-foreground">Loading…</div>}
      {!rowsQ.isLoading && rows.length === 0 && <div className="as-card p-8 text-center text-sm text-muted-foreground">No audits match.</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {rows.map((r) => {
          const findings = SEV.map((s) => ({ ...s, n: (r[s.key as keyof Row] as number) || 0 })).filter((s) => s.n > 0);
          return (
            <div key={r.id} className="as-card p-4 flex flex-col gap-3 hover:border-primary/40 transition-colors">
              {/* protocol */}
              <Link to={`/protocol/${r.company_slug}`} className="flex items-center gap-3 group">
                <Logo src={r.company_logo} name={r.company_name} kind="company" />
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-foreground group-hover:text-primary truncate">{r.company_name}</div>
                  <div className="text-[11px] text-muted-foreground">{r.audit_date || "date unknown"}</div>
                </div>
              </Link>

              {/* auditor */}
              <Link to={`/auditors/${encodeURIComponent(r.audit_firm || "")}`} className="flex items-center gap-2 group/firm">
                <Logo src={firmLogos?.get(r.audit_firm || "")} name={r.audit_firm} kind="firm" sm />
                <span className="text-[12px] text-muted-foreground group-hover/firm:text-primary truncate">
                  audited by <span className="text-foreground/90 font-medium">{r.audit_firm || "Unknown"}</span>
                </span>
              </Link>

              {/* footer: findings + report */}
              <div className="flex items-center justify-between pt-1 mt-auto border-t border-white/[0.05]">
                <div className="flex items-center gap-1">
                  {findings.length > 0 ? findings.map((s) => (
                    <span key={s.key} className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${s.cls}`}>{s.n}{s.label}</span>
                  )) : <span className="text-[10.5px] text-muted-foreground/50">findings not parsed</span>}
                </div>
                {r.report_url ? (
                  <a href={r.report_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-medium">
                    <FileText className="w-3 h-3" /> Report <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                ) : <span className="text-[10.5px] text-muted-foreground/40">no report</span>}
              </div>
            </div>
          );
        })}
      </div>

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

function Logo({ src, name, kind, sm }: { src?: string | null; name?: string | null; kind: "company" | "firm"; sm?: boolean }) {
  const size = sm ? "w-6 h-6" : "w-10 h-10";
  const Icon = kind === "firm" ? Award : Building2;
  return (
    <div className={`${size} shrink-0 rounded-lg bg-white/[0.05] flex items-center justify-center overflow-hidden`}>
      {src ? (
        <img src={src} alt="" className="w-full h-full object-cover"
          onError={(e) => { const t = e.target as HTMLImageElement; t.style.display = "none"; (t.nextElementSibling as HTMLElement)?.style.removeProperty("display"); }} />
      ) : null}
      <span style={src ? { display: "none" } : {}} className="text-[11px] font-bold text-muted-foreground">
        {name ? name[0].toUpperCase() : <Icon className="w-4 h-4" />}
      </span>
    </div>
  );
}
