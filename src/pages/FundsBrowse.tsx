import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Search, Wallet, ArrowUpDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { EntityCard } from "@/components/EntityCard";
import { ViewToggle, loadViewMode, saveViewMode, type ViewMode } from "@/components/ViewToggle";

const PAGE_SIZE = 30;

export default function FundsBrowse() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [view, setView] = useState<ViewMode>(() => loadViewMode("funds", "grid"));
  // List view is sortable; grid stays ordered by investment count.
  const [sort, setSort] = useState<{ col: "name" | "investment_count"; asc: boolean }>(
    { col: "investment_count", asc: false },
  );
  useEffect(() => { saveViewMode("funds", view); }, [view]);

  const rowsQ = useQuery({
    queryKey: ["funds-browse", q, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = supabase
        .from("funds")
        .select("slug,name,website,logo,investment_count", { count: "exact" })
        .not("name", "is", null);
      if (q.trim().length >= 2) query = query.ilike("name", `%${q.trim()}%`);
      query = query
        .order(view === "list" ? sort.col : "investment_count",
               { ascending: view === "list" ? sort.asc : false, nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as any[], count: count ?? 0 };
    },
  });

  return (
    <div className="max-w-[1280px] mx-auto space-y-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary">Funds</div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight mt-0.5">
            {rowsQ.data?.count?.toLocaleString() ?? "—"} crypto funds tracked
          </h1>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            className="as-input pl-7 py-1.5 text-[12.5px]"
            placeholder="Search funds…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
          />
        </div>
        <ViewToggle value={view} onChange={setView} />
      </header>

      {rowsQ.isLoading && <div className="as-card p-6 text-center text-sm text-muted-foreground">Loading…</div>}

      {view === "list" ? (
        <div className="as-card overflow-hidden">
          <div className="grid grid-cols-[1fr_140px] gap-3 px-4 py-2 border-b border-white/[0.06] text-[11px] uppercase tracking-wide text-muted-foreground">
            <button
              type="button"
              onClick={() => setSort((s0) => ({ col: "name", asc: s0.col === "name" ? !s0.asc : true }))}
              className="flex items-center gap-1 hover:text-foreground text-left"
            >
              Fund <ArrowUpDown className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => setSort((s0) => ({ col: "investment_count", asc: s0.col === "investment_count" ? !s0.asc : false }))}
              className="flex items-center gap-1 hover:text-foreground justify-end"
            >
              Investments <ArrowUpDown className="w-3 h-3" />
            </button>
          </div>
          {(rowsQ.data?.rows ?? []).map((f) => (
            <Link
              key={f.slug}
              to={`/funds/${f.slug}`}
              className="grid grid-cols-[1fr_140px] gap-3 px-4 py-2.5 items-center border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03]"
            >
              <span className="flex items-center gap-2.5 min-w-0">
                {f.logo ? (
                  <img src={f.logo} alt="" className="w-6 h-6 rounded object-contain bg-white/[0.04] shrink-0" />
                ) : (
                  <span className="w-6 h-6 rounded bg-white/[0.04] grid place-items-center shrink-0">
                    <Wallet className="w-3.5 h-3.5 text-muted-foreground" />
                  </span>
                )}
                <span className="truncate text-[13px] text-foreground">{f.name}</span>
              </span>
              <span className="text-right font-mono tabular-nums text-[12.5px] text-primary">
                {f.investment_count ? f.investment_count.toLocaleString() : "—"}
              </span>
            </Link>
          ))}
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {(rowsQ.data?.rows ?? []).map((f) => (
          <EntityCard
            key={f.slug}
            size="sm"
            href={`/funds/${f.slug}`}
            logoUrl={f.logo}
            icon={<Wallet className="w-4 h-4" />}
            title={f.name}
            subtitle={f.website ? f.website.replace(/^https?:\/\//, "").replace(/\/$/, "") : undefined}
            facts={f.investment_count ? [{ label: "Investments", value: f.investment_count.toLocaleString(), tone: "primary" }] : []}
          />
        ))}
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
