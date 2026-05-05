import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Twitter } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Company } from "@/lib/companies";
import { normalizeTwitterUrl } from "@/lib/format";
import { CompanyLogo } from "@/components/CompanyLogo";

const PAGE_SIZE = 50;

export default function Companies() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(0), [debounced, category]);

  const categories = useQuery({
    queryKey: ["company-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("category")
        .not("category", "is", null)
        .limit(5000);
      if (error) throw error;
      const set = new Set<string>();
      data?.forEach((r: { category: string | null }) => r.category && set.add(r.category));
      return Array.from(set).sort();
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
      return { rows: (data || []) as Company[], count: count ?? 0 };
    },
  });

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((companies.data?.count ?? 0) / PAGE_SIZE)),
    [companies.data?.count]
  );

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

      <div className="as-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-white/[0.02]">
              <tr>
                <th className="text-left px-4 py-3">Company</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-center px-4 py-3">Twitter</th>
              </tr>
            </thead>
            <tbody>
              {companies.isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-t border-white/[0.04]">
                    <td colSpan={4} className="px-4 py-3"><div className="h-6 bg-white/[0.03] rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : companies.data?.rows.length === 0 ? (
                <tr><td colSpan={4} className="text-center text-muted-foreground py-12">No companies match these filters</td></tr>
              ) : (
                companies.data?.rows.map((c) => {
                  const tw = normalizeTwitterUrl(c.twitter);
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
                        {tw ? (
                          <a href={tw} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-primary inline-block">
                            <Twitter className="w-4 h-4" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
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
