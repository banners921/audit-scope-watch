import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ShieldCheck, ExternalLink, BadgeCheck, Github, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { EntityCard, type CardFact } from "@/components/EntityCard";
import { ViewToggle, type ViewMode, loadViewMode, saveViewMode } from "@/components/ViewToggle";

const PAGE_SIZE = 30;
const STORAGE_KEY = "auditors";

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

type SortMode = "reports" | "clients" | "recent";

export default function AuditorsBrowse() {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortMode>("reports");
  const [page, setPage] = useState(0);
  const [view, setView] = useState<ViewMode>(() => loadViewMode(STORAGE_KEY, "grid"));
  const setViewPersist = (v: ViewMode) => { setView(v); saveViewMode(STORAGE_KEY, v); };

  const rowsQ = useQuery({
    queryKey: ["auditors-browse", q, sort, page],
    keepPreviousData: true,
    queryFn: async () => {
      let query = supabase.from("audit_firm_cards").select("*", { count: "exact" });
      if (q.trim().length >= 2) query = query.ilike("firm_name", `%${q.trim()}%`);
      const order = sort === "clients" ? "client_count" : sort === "recent" ? "last_audit_date" : "report_count";
      query = query.order(order, { ascending: false, nullsFirst: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as FirmRow[], count: count ?? 0 };
    },
  });

  return (
    <div className="max-w-[1280px] mx-auto space-y-4">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary">Auditors</div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight mt-0.5">
            {rowsQ.data?.count?.toLocaleString() ?? "—"} audit firms
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setViewPersist} />
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              className="as-input pl-7 py-1.5 text-[12.5px]"
              placeholder="Search firms…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0); }}
            />
          </div>
        </div>
      </header>

      {/* Sort */}
      <div className="flex flex-wrap gap-1.5">
        {([
          { k: "reports", l: "Most reports" },
          { k: "clients", l: "Most clients" },
          { k: "recent", l: "Most recent" },
        ] as { k: SortMode; l: string }[]).map((opt) => (
          <button
            key={opt.k}
            onClick={() => { setSort(opt.k); setPage(0); }}
            className={`text-[11px] px-2 py-1 rounded-md border ${sort === opt.k ? "border-primary/40 bg-primary/[0.08] text-primary" : "border-white/[0.06] text-muted-foreground hover:text-foreground"}`}
          >
            {opt.l}
          </button>
        ))}
      </div>

      {rowsQ.isLoading && <div className="as-card p-6 text-center text-sm text-muted-foreground">Loading…</div>}

      {view === "grid" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(rowsQ.data?.rows ?? []).map((f) => {
            const facts: CardFact[] = [];
            facts.push({ label: "Reports", value: f.report_count.toLocaleString(), tone: "good" });
            facts.push({ label: "Clients", value: f.client_count.toLocaleString(), tone: "primary" });
            if (f.critical_total) facts.push({ label: "Critical found", value: f.critical_total.toLocaleString(), tone: "bad" });
            if (f.high_total) facts.push({ label: "High", value: f.high_total.toLocaleString(), tone: "warn" });
            if (f.last_audit_date) facts.push({ label: "Last audit", value: f.last_audit_date });

            const firmSlug = encodeURIComponent(f.firm_name);
            return (
              <EntityCard
                key={f.firm_name}
                size="md"
                href={`/auditors/${firmSlug}`}
                logoUrl={f.logo_url}
                icon={<ShieldCheck className="w-5 h-5" />}
                title={f.firm_name}
                subtitle={f.description?.slice(0, 140)}
                badges={f.verified ? [{ label: "Verified", tone: "success" }] : []}
                facts={facts}
                rightMeta={
                  <span className="inline-flex items-center gap-1.5">
                    {f.social_github && (
                      <a href={f.social_github.startsWith("http") ? f.social_github : `https://github.com/${f.social_github}`} target="_blank" rel="noreferrer" className="hover:text-foreground" title="GitHub">
                        <Github className="w-3 h-3" />
                      </a>
                    )}
                    {f.homepage_url && (
                      <a href={f.homepage_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary text-[10.5px]">
                        {f.homepage_url.replace(/^https?:\/\//, "").replace(/\/$/, "").slice(0, 22)}
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </span>
                }
              />
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
                <th className="px-3 py-2 font-medium w-7"></th>
              </tr>
            </thead>
            <tbody>
              {(rowsQ.data?.rows ?? []).map((f) => (
                <tr key={f.firm_name} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                  <td className="px-3 py-2">
                    <Link to={`/auditors/${encodeURIComponent(f.firm_name)}`} className="flex items-center gap-2 group/cell">
                      <div className="w-6 h-6 shrink-0 rounded overflow-hidden bg-white/[0.04] flex items-center justify-center">
                        {f.logo_url ? (
                          <img src={f.logo_url} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        ) : (
                          <span className="text-[9px] font-bold opacity-60">{f.firm_name[0]?.toUpperCase()}</span>
                        )}
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
                  <td className="px-3 py-2 text-muted-foreground/60"><ArrowUpRight className="w-3 h-3" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
