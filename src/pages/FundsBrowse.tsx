import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { EntityCard } from "@/components/EntityCard";

const PAGE_SIZE = 30;

export default function FundsBrowse() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  const rowsQ = useQuery({
    queryKey: ["funds-browse", q, page],
    keepPreviousData: true,
    queryFn: async () => {
      let query = supabase
        .from("funds")
        .select("slug,name,website,logo,investment_count", { count: "exact" })
        .not("name", "is", null);
      if (q.trim().length >= 2) query = query.ilike("name", `%${q.trim()}%`);
      query = query
        .order("investment_count", { ascending: false, nullsFirst: false })
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
      </header>

      {rowsQ.isLoading && <div className="as-card p-6 text-center text-sm text-muted-foreground">Loading…</div>}

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
