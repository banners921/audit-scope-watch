import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search, Building2, ExternalLink, ArrowUpRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { EntityCard, type CardFact } from "@/components/EntityCard";
import { ViewToggle, type ViewMode, loadViewMode, saveViewMode } from "@/components/ViewToggle";

const PAGE_SIZE = 30;
const STORAGE_KEY = "companies";

export default function CompaniesBrowse() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<ViewMode>(() => loadViewMode(STORAGE_KEY, "grid"));

  const setViewPersist = (v: ViewMode) => { setView(v); saveViewMode(STORAGE_KEY, v); };

  const catsQ = useQuery({
    queryKey: ["companies-cats"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("category").not("category", "is", null).limit(5000);
      const set = new Map<string, number>();
      for (const r of (data ?? []) as any[]) {
        if (!r.category) continue;
        set.set(r.category, (set.get(r.category) ?? 0) + 1);
      }
      return Array.from(set.entries()).sort((a, b) => b[1] - a[1]).slice(0, 16);
    },
  });

  const rowsQ = useQuery({
    queryKey: ["companies-browse", q, category, page],
    keepPreviousData: true,
    queryFn: async () => {
      let query = supabase
        .from("companies")
        .select(
          "slug,name,logo,category,subcategory,description,url,founded_year,total_raised_usd,audit_count,unique_auditor_count,last_audit_date,last_audit_firm",
          { count: "exact" }
        )
        .not("name", "is", null);
      if (q.trim().length >= 2) query = query.ilike("name", `%${q.trim()}%`);
      if (category) query = query.eq("category", category);
      query = query
        .order("audit_count", { ascending: false, nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as any[], count: count ?? 0 };
    },
  });

  return (
    <div className="max-w-[1280px] mx-auto space-y-4">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary">Companies</div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight mt-0.5">
            {rowsQ.data?.count?.toLocaleString() ?? "—"} tracked
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setViewPersist} />
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              className="as-input pl-7 py-1.5 text-[12.5px]"
              placeholder="Search by name…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0); }}
            />
          </div>
        </div>
      </header>

      {catsQ.data && catsQ.data.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => { setCategory(null); setPage(0); }}
            className={`text-[11px] px-2 py-1 rounded-md border ${!category ? "border-primary/40 bg-primary/[0.08] text-primary" : "border-white/[0.06] text-muted-foreground hover:text-foreground"}`}
          >
            All
          </button>
          {catsQ.data.map(([cat, count]) => (
            <button
              key={cat}
              onClick={() => { setCategory(cat); setPage(0); }}
              className={`text-[11px] px-2 py-1 rounded-md border ${category === cat ? "border-primary/40 bg-primary/[0.08] text-primary" : "border-white/[0.06] text-muted-foreground hover:text-foreground"}`}
            >
              {cat} <span className="opacity-50 tabular-nums">{count}</span>
            </button>
          ))}
        </div>
      )}

      {rowsQ.isLoading && <div className="as-card p-6 text-center text-sm text-muted-foreground">Loading…</div>}

      {view === "grid" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(rowsQ.data?.rows ?? []).map((c) => {
            const facts: CardFact[] = [];
            if (c.last_audit_firm) facts.push({ label: "Last firm", value: c.last_audit_firm });
            if (c.last_audit_date) facts.push({ label: "Last audit", value: c.last_audit_date });
            if (c.audit_count) facts.push({ label: "Audits", value: c.audit_count, tone: "good" });
            if (c.unique_auditor_count) facts.push({ label: "Firms used", value: c.unique_auditor_count });
            if (c.total_raised_usd) facts.push({ label: "Raised", value: formatMoney(Number(c.total_raised_usd)), tone: "primary" });
            if (c.founded_year) facts.push({ label: "Founded", value: c.founded_year });
            return (
              <EntityCard
                key={c.slug}
                size="md"
                href={`/protocol/${c.slug}`}
                logoUrl={c.logo}
                icon={<Building2 className="w-5 h-5" />}
                title={c.name}
                subtitle={c.description?.slice(0, 140)}
                badges={c.category ? [{ label: c.category, tone: "primary" }] : []}
                facts={facts}
                rightMeta={c.url ? (
                  <a href={safeUrl(c.url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary text-[10.5px]">
                    {c.url.replace(/^https?:\/\//, "").replace(/\/$/, "").slice(0, 28)}<ExternalLink className="w-2.5 h-2.5" />
                  </a>
                ) : null}
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
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Sector</th>
                <th className="px-3 py-2 font-medium text-right">Audits</th>
                <th className="px-3 py-2 font-medium">Last audit</th>
                <th className="px-3 py-2 font-medium">Last firm</th>
                <th className="px-3 py-2 font-medium text-right">Raised</th>
                <th className="px-3 py-2 font-medium w-7"></th>
              </tr>
            </thead>
            <tbody>
              {(rowsQ.data?.rows ?? []).map((c) => (
                <tr key={c.slug} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                  <td className="px-3 py-2">
                    <Link to={`/protocol/${c.slug}`} className="flex items-center gap-2 group/cell">
                      <div className="w-6 h-6 shrink-0 rounded overflow-hidden bg-white/[0.04] flex items-center justify-center">
                        {c.logo ? (
                          <img src={c.logo} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        ) : (
                          <span className="text-[9px] font-bold opacity-60">{(c.name ?? "?")[0]?.toUpperCase()}</span>
                        )}
                      </div>
                      <span className="text-foreground group-hover/cell:text-primary truncate font-medium">{c.name}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{c.category ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-300">{c.audit_count ?? 0}</td>
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">{c.last_audit_date ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground truncate max-w-[180px]">{c.last_audit_firm ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-primary">{c.total_raised_usd ? formatMoney(Number(c.total_raised_usd)) : "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground/60"><ArrowUpRight className="w-3 h-3" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rowsQ.data && rowsQ.data.count > PAGE_SIZE && (
        <Pager page={page} count={rowsQ.data.count} onChange={setPage} />
      )}
    </div>
  );
}

function Pager({ page, count, onChange }: { page: number; count: number; onChange: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2">
      <button type="button" disabled={page === 0} onClick={() => onChange(Math.max(0, page - 1))} className="px-3 py-1.5 rounded-md border border-white/[0.06] disabled:opacity-40 hover:bg-white/[0.03]">← Prev</button>
      <span className="font-mono tabular-nums">Page {page + 1} of {Math.ceil(count / PAGE_SIZE).toLocaleString()}</span>
      <button type="button" disabled={(page + 1) * PAGE_SIZE >= count} onClick={() => onChange(page + 1)} className="px-3 py-1.5 rounded-md border border-white/[0.06] disabled:opacity-40 hover:bg-white/[0.03]">Next →</button>
    </div>
  );
}

function formatMoney(n: number): string {
  if (!n) return "$0";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function safeUrl(u: string) { return u.startsWith("http") ? u : `https://${u}`; }
