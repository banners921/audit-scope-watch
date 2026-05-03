import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Check, X } from "lucide-react";
import { supabase, type Protocol } from "@/lib/supabase";
import { formatTvl, formatPct } from "@/lib/format";
import { RiskBadge } from "@/components/RiskBadge";

const PAGE_SIZE = 50;

export default function Protocols() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState<string>("");
  const [minTvl, setMinTvl] = useState<string>("");
  const [auditStatus, setAuditStatus] = useState<"all" | "never" | "stale" | "recent">("all");
  const [hasBounty, setHasBounty] = useState(false);
  const [hasHack, setHasHack] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => setPage(0), [debounced, category, minTvl, auditStatus, hasBounty, hasHack]);

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("protocols").select("category").not("category", "is", null);
      if (error) throw error;
      const set = new Set<string>();
      data?.forEach((r: { category: string | null }) => r.category && set.add(r.category));
      return Array.from(set).sort();
    },
  });

  const protocols = useQuery({
    queryKey: ["protocols", debounced, category, minTvl, auditStatus, hasBounty, hasHack, page],
    queryFn: async () => {
      let q = supabase
        .from("protocols")
        .select("*", { count: "exact" })
        .order("security_score", { ascending: false, nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (debounced) q = q.ilike("name", `%${debounced}%`);
      if (category) q = q.eq("category", category);
      if (minTvl) q = q.gte("tvl_usd", Number(minTvl));
      if (hasBounty) q = q.eq("has_bug_bounty", true);
      if (hasHack) q = q.eq("has_been_hacked", true);
      if (auditStatus === "never") q = q.is("last_audit_date", null);
      if (auditStatus === "stale") {
        const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        q = q.lt("last_audit_date", cutoff);
      }
      if (auditStatus === "recent") {
        const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        q = q.gte("last_audit_date", cutoff);
      }

      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data || []) as Protocol[], count: count ?? 0 };
    },
  });

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((protocols.data?.count ?? 0) / PAGE_SIZE)),
    [protocols.data?.count]
  );

  return (
    <div className="space-y-4 max-w-[1400px]">
      <div className="as-card p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search protocols by name…"
            className="as-input pl-10"
          />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="as-input">
            <option value="">All categories</option>
            {categories.data?.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            type="number"
            value={minTvl}
            onChange={(e) => setMinTvl(e.target.value)}
            placeholder="Min TVL ($)"
            className="as-input"
          />
          <select value={auditStatus} onChange={(e) => setAuditStatus(e.target.value as never)} className="as-input">
            <option value="all">Any audit status</option>
            <option value="never">Never audited</option>
            <option value="stale">Stale (&gt;1yr)</option>
            <option value="recent">Recent (≤1yr)</option>
          </select>
          <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-input border border-white/[0.08] cursor-pointer">
            <input type="checkbox" checked={hasBounty} onChange={(e) => setHasBounty(e.target.checked)} className="accent-primary" />
            <span className="text-sm text-muted-foreground">Has bounty</span>
          </label>
          <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-input border border-white/[0.08] cursor-pointer">
            <input type="checkbox" checked={hasHack} onChange={(e) => setHasHack(e.target.checked)} className="accent-primary" />
            <span className="text-sm text-muted-foreground">Has been hacked</span>
          </label>
        </div>
      </div>

      <div className="as-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-white/[0.02]">
              <tr>
                <th className="text-left px-4 py-3">Protocol</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-right px-4 py-3">TVL</th>
                <th className="text-right px-4 py-3">7d</th>
                <th className="text-center px-4 py-3">Risk</th>
                <th className="text-left px-4 py-3">Last Audit</th>
                <th className="text-center px-4 py-3">Bounty</th>
              </tr>
            </thead>
            <tbody>
              {protocols.isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-t border-white/[0.04]">
                    <td colSpan={7} className="px-4 py-3"><div className="h-6 bg-white/[0.03] rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : protocols.data?.rows.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-muted-foreground py-12">No protocols match these filters</td></tr>
              ) : (
                protocols.data?.rows.map((p) => {
                  const change = p.tvl_7d_change ?? null;
                  return (
                    <tr
                      key={p.slug}
                      onClick={() => navigate(`/protocols/${p.slug}`)}
                      className="border-t border-white/[0.04] hover:bg-white/[0.02] cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {p.logo ? (
                            <img src={p.logo} alt="" className="w-7 h-7 rounded-md bg-white/5" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
                          ) : (
                            <div className="w-7 h-7 rounded-md bg-white/5" />
                          )}
                          <span className="font-medium text-white">{p.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{p.category || "—"}</td>
                      <td className="px-4 py-3 text-right font-mono text-white">{formatTvl(p.tvl_usd)}</td>
                      <td className={`px-4 py-3 text-right font-mono ${change == null ? "text-muted-foreground" : change >= 0 ? "text-success" : "text-destructive"}`}>
                        {formatPct(change)}
                      </td>
                      <td className="px-4 py-3 text-center"><RiskBadge score={p.security_score} /></td>
                      <td className="px-4 py-3">
                        {p.last_audit_date ? (
                          <span className="font-mono text-xs text-muted-foreground">{p.last_audit_date}</span>
                        ) : (
                          <span className="text-destructive text-xs font-medium">Never</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {p.has_bug_bounty ? <Check className="w-4 h-4 text-success inline" /> : <X className="w-4 h-4 text-destructive inline" />}
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
            {protocols.data?.count ?? 0} protocols • Page {page + 1} / {totalPages}
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
