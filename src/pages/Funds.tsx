import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Globe, Twitter, TrendingUp } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { normalizeTwitterUrl } from "@/lib/format";
import { ViewToggle, type ViewMode } from "@/components/ViewToggle";

const PAGE_SIZE = 50;
const VIEW_KEY = "as_funds_view";

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

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export default function Funds() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(0);
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "grid";
    return (window.localStorage.getItem(VIEW_KEY) as ViewMode) || "grid";
  });

  useEffect(() => {
    window.localStorage.setItem(VIEW_KEY, view);
  }, [view]);

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

  const rows = funds.data?.rows ?? [];

  return (
    <div className="space-y-4 max-w-[1400px]">
      <div className="as-card p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search funds by name…"
            className="as-input pl-10"
          />
        </div>
        <ViewToggle value={view} onChange={setView} />
      </div>

      {funds.isLoading ? (
        view === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="as-card p-4 h-32 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="as-card p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 bg-white/[0.03] rounded animate-pulse" />
            ))}
          </div>
        )
      ) : rows.length === 0 ? (
        <div className="as-card p-12 text-center text-sm text-muted-foreground">No funds found</div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {rows.map((f) => (
            <FundCard key={f.slug} f={f} onClick={() => navigate(`/funds/${f.slug}`)} />
          ))}
        </div>
      ) : (
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
                {rows.map((f) => {
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
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
        <span className="font-mono">
          {funds.data?.count ?? 0} funds • Page {page + 1} / {totalPages}
        </span>
        <div className="flex gap-2">
          <button className="as-btn as-btn-ghost py-1 px-3 text-xs disabled:opacity-40" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</button>
          <button className="as-btn as-btn-ghost py-1 px-3 text-xs disabled:opacity-40" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}

function FundCard({ f, onClick }: { f: Fund; onClick: () => void }) {
  const domain = extractDomain(f.website);
  const logo = domain ? `https://cdn.brandfetch.io/${domain}` : null;
  const tw = normalizeTwitterUrl(f.twitter);
  const initial = (f.name?.trim()?.[0] || "?").toUpperCase();
  return (
    <button
      type="button"
      onClick={onClick}
      className="as-card p-4 text-left hover:border-white/20 transition-colors group"
    >
      <div className="flex items-start gap-3">
        {logo ? (
          <img
            src={logo}
            alt=""
            className="w-10 h-10 rounded-lg bg-white/5 object-contain shrink-0"
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              img.style.display = "none";
              const sib = img.nextElementSibling as HTMLElement | null;
              if (sib) sib.style.display = "flex";
            }}
          />
        ) : null}
        <div
          className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 items-center justify-center text-sm font-semibold text-primary shrink-0"
          style={{ display: logo ? "none" : "flex" }}
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white truncate">{f.name}</div>
          <div className="text-[11px] font-mono text-muted-foreground mt-0.5 inline-flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            {f.investment_count ?? 0} investments
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3">
        {f.website && (
          <a href={f.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-primary" aria-label="Website">
            <Globe className="w-3.5 h-3.5" />
          </a>
        )}
        {tw && (
          <a href={tw} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-primary" aria-label="Twitter">
            <Twitter className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </button>
  );
}
