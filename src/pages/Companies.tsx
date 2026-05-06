import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, ArrowUp, ArrowDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Company } from "@/lib/companies";
import { CompanyLogo } from "@/components/CompanyLogo";

const PAGE_SIZE = 50;

type CompanyWithSignals = Company & {
  last_audit_date: string | null;
  total_tvl_usd: number | null;
  has_bug_bounty: boolean | null;
  has_been_hacked: boolean | null;
  total_raised_usd: number | null;
};

function computeSignals(c: CompanyWithSignals): number {
  let n = 0;
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  if (!c.last_audit_date) n++;
  else if (new Date(c.last_audit_date) < twelveMonthsAgo) n++;
  if ((c.total_tvl_usd ?? 0) > 1_000_000) n++;
  if (!c.has_bug_bounty) n++;
  if (c.has_been_hacked === true) n++;
  if ((c.total_raised_usd ?? 0) > 1_000_000) n++;
  return n;
}

function SignalBadge({ count }: { count: number }) {
  const cls =
    count >= 4
      ? "bg-destructive/15 text-destructive border-destructive/30"
      : count >= 2
        ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
        : "bg-white/5 text-muted-foreground border-white/10";
  return (
    <span className={`inline-flex items-center justify-center min-w-[1.75rem] px-2 py-0.5 rounded-md border text-xs font-mono font-semibold ${cls}`}>
      {count}
    </span>
  );
}

export default function Companies() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(0);
  const [signalSort, setSignalSort] = useState<"desc" | "asc" | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(0), [debounced, category]);

  const categories = useQuery({
    queryKey: ["company-categories"],
    queryFn: async () => {
      const set = new Set<string>();
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("companies")
          .select("category")
          .not("category", "is", null)
          .neq("category", "")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        data?.forEach((r: { category: string | null }) => r.category && set.add(r.category));
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    },
  });

  const companies = useQuery({
    queryKey: ["companies", debounced, category, page],
    queryFn: async () => {
      let q = supabase
        .from("companies")
        .select("*", { count: "exact" })
        .order("name", { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (debounced) q = q.ilike("name", `%${debounced}%`);
      if (category) q = q.eq("category", category);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data || []) as CompanyWithSignals[], count: count ?? 0 };
    },
  });

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((companies.data?.count ?? 0) / PAGE_SIZE)),
    [companies.data?.count]
  );

  const displayRows = useMemo(() => {
    const rows = companies.data?.rows ?? [];
    const withCounts = rows.map((c) => ({ c, n: computeSignals(c) }));
    if (signalSort) {
      withCounts.sort((a, b) => (signalSort === "desc" ? b.n - a.n : a.n - b.n));
    }
    return withCounts;
  }, [companies.data?.rows, signalSort]);

  const handleSignalHeaderClick = () => {
    setSignalSort((s) => (s === "desc" ? "asc" : "desc"));
  };

  return (
    <div className="space-y-4 max-w-[1400px]">
      <div className="as-card p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search companies by name…"
            className="as-input pl-10"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="as-input">
            <option value="">All categories</option>
            {categories.data?.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="text-xs font-mono text-muted-foreground px-1">
        {(companies.data?.count ?? 0).toLocaleString()} companies
      </div>

      <div className="as-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-white/[0.02]">
              <tr>
                <th className="text-left px-4 py-3">Company</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-center px-4 py-3">
                  <button
                    type="button"
                    onClick={handleSignalHeaderClick}
                    className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-white transition-colors"
                  >
                    Signals
                    {signalSort === "desc" && <ArrowDown className="w-3 h-3" />}
                    {signalSort === "asc" && <ArrowUp className="w-3 h-3" />}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {companies.isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-t border-white/[0.04]">
                    <td colSpan={4} className="px-4 py-3"><div className="h-6 bg-white/[0.03] rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : displayRows.length === 0 ? (
                <tr><td colSpan={4} className="text-center text-muted-foreground py-12">No companies match these filters</td></tr>
              ) : (
                displayRows.map(({ c, n }) => {
                  return (
                    <tr
                      key={c.slug}
                      onClick={() => navigate(`/companies/${c.slug}`)}
                      className="border-t border-white/[0.04] hover:bg-white/[0.02] cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <CompanyLogo logo={c.logo} url={c.url} name={c.name} />
                          <span className="font-medium text-white">{c.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{c.category || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground max-w-md">
                        <span className="line-clamp-1">{c.description || "—"}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <SignalBadge count={n} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.04] text-xs text-muted-foreground">
          <span className="font-mono">
            {companies.data?.count ?? 0} companies • Page {page + 1} / {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              className="as-btn as-btn-ghost py-1 px-3 text-xs disabled:opacity-40"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Prev
            </button>
            <button
              className="as-btn as-btn-ghost py-1 px-3 text-xs disabled:opacity-40"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
