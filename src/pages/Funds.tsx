import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Globe, Twitter } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { normalizeTwitterUrl } from "@/lib/format";

const PAGE_SIZE = 50;

type Fund = {
  slug: string;
  name: string;
  website: string | null;
  twitter: string | null;
  linkedin: string | null;
  investment_count: number | null;
  rounds_led: string | null;
  secondary_investments: string | null;
  portfolio_companies: string | null;
};

export default function Funds() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(0), [debounced]);

  const funds = useQuery({
    queryKey: ["funds", debounced, page],
    queryFn: async () => {
      let q = supabase
        .from("funds")
        .select("*", { count: "exact" })
        .order("investment_count", { ascending: false, nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (debounced) q = q.ilike("name", `%${debounced}%`);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data || []) as Fund[], count: count ?? 0 };
    },
  });

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((funds.data?.count ?? 0) / PAGE_SIZE)),
    [funds.data?.count]
  );

  return (
    <div className="space-y-4 max-w-[1400px]">
      <div className="as-card p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search funds by name…"
            className="as-input pl-10"
          />
        </div>
      </div>

      <div className="as-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-white/[0.02]">
              <tr>
                <th className="text-left px-4 py-3">Fund</th>
                <th className="text-right px-4 py-3">Investments</th>
                <th className="text-center px-4 py-3">Website</th>
                <th className="text-center px-4 py-3">Twitter</th>
              </tr>
            </thead>
            <tbody>
              {funds.isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-t border-white/[0.04]">
                    <td colSpan={4} className="px-4 py-3"><div className="h-6 bg-white/[0.03] rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : funds.data?.rows.length === 0 ? (
                <tr><td colSpan={4} className="text-center text-muted-foreground py-12">No funds found</td></tr>
              ) : (
                funds.data?.rows.map((f) => {
                  const tw = normalizeTwitterUrl(f.twitter);
                  return (
                    <tr
                      key={f.slug}
                      onClick={() => navigate(`/funds/${f.slug}`)}
                      className="border-t border-white/[0.04] hover:bg-white/[0.02] cursor-pointer"
                    >
                      <td className="px-4 py-3 font-medium text-white">{f.name}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground font-mono">
                        {f.investment_count ?? 0}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {f.website ? (
                          <a href={f.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-primary inline-block">
                            <Globe className="w-4 h-4" />
                          </a>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {tw ? (
                          <a href={tw} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-primary inline-block">
                            <Twitter className="w-4 h-4" />
                          </a>
                        ) : <span className="text-muted-foreground">—</span>}
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
            {funds.data?.count ?? 0} funds • Page {page + 1} / {totalPages}
          </span>
          <div className="flex gap-2">
            <button className="as-btn as-btn-ghost py-1 px-3 text-xs disabled:opacity-40" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</button>
            <button className="as-btn as-btn-ghost py-1 px-3 text-xs disabled:opacity-40" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
