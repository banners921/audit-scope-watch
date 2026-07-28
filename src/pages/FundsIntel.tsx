import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Banknote, Search, List, LayoutGrid, ArrowRight, Globe, Twitter, Briefcase } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";
import { SaveTargetButton } from "@/components/SaveTargetButton";

type FundRow = {
  slug: string;
  name: string;
  logo: string | null;
  website: string | null;
  twitter: string | null;
  linkedin: string | null;
  investment_count: number | null;
  last_updated: string | null;
};

type Sort = "investments" | "name" | "recent";

function tightAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400000);
  if (d < 1) return "today";
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}

export default function FundsIntel() {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("investments");
  const [renderLimit, setRenderLimit] = useState(300);

  const fundsQ = useQuery({
    queryKey: ["intel-funds"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const all: FundRow[] = [];
      const PAGE = 1000;
      for (let from = 0; from < 50000; from += PAGE) {
        const { data, error } = await supabase
          .from("funds")
          .select("slug,name,logo,website,twitter,linkedin,investment_count,last_updated")
          .order("investment_count", { ascending: false, nullsFirst: false })
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        all.push(...(data as FundRow[]));
        if (data.length < PAGE) break;
      }
      return all;
    },
  });

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let list = (fundsQ.data ?? []).filter(f => !ql || f.name.toLowerCase().includes(ql) || f.slug.toLowerCase().includes(ql));
    list.sort((a, b) => {
      switch (sort) {
        case "name": return (a.name || "").localeCompare(b.name || "");
        case "recent": return (b.last_updated || "").localeCompare(a.last_updated || "");
        default: return (b.investment_count ?? 0) - (a.investment_count ?? 0);
      }
    });
    return list;
  }, [fundsQ.data, q, sort]);

  return (
    <div className="space-y-5 max-w-[1600px]">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Banknote className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight">Funds</h1>
            <p className="text-[11px] text-muted-foreground mt-1">Every crypto-native fund we track. Click to see portfolio + investment activity.</p>
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {filtered.length.toLocaleString()} of {(fundsQ.data ?? []).length.toLocaleString()} funds
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-md bg-white/[0.03] border border-white/[0.06] p-0.5 text-[11px]">
          <button type="button" onClick={() => setView("list")} className={`px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 transition-colors ${view === "list" ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-white"}`}>
            <List className="w-3 h-3" /> List
          </button>
          <button type="button" onClick={() => setView("grid")} className={`px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 transition-colors ${view === "grid" ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-white"}`}>
            <LayoutGrid className="w-3 h-3" /> Grid
          </button>
        </div>
      </div>

      <div className="as-card p-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-[360px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search funds…" className="w-full pl-8 pr-3 py-1.5 text-[12px] bg-white/[0.03] border border-white/[0.08] rounded text-white placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40" />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="bg-white/[0.03] border border-white/[0.08] rounded px-2 py-1.5 text-[12px] text-white">
          <option value="investments">Sort: most investments</option>
          <option value="name">Sort: name (A–Z)</option>
          <option value="recent">Sort: recently updated</option>
        </select>
      </div>

      {fundsQ.isLoading ? (
        <div className="as-card p-8 text-center text-xs text-muted-foreground">Loading funds…</div>
      ) : view === "grid" ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.slice(0, renderLimit).map((f) => (
              <Link key={f.slug} to={`/funds/${f.slug}`} className="as-card p-3.5 hover:border-primary/40 hover:bg-white/[0.025] transition-colors flex flex-col gap-2 group relative">
                <div className="absolute top-2 right-2 z-10"><SaveTargetButton slug={f.slug} name={f.name} kind="fund" /></div>
                <div className="flex items-start gap-2.5 pr-7">
                  <BrandLogo name={f.name} url={f.website} logo={f.logo} className="w-10 h-10 rounded-md shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white truncate group-hover:text-primary">{f.name}</div>
                    <div className="text-[10px] text-muted-foreground/80 truncate">Fund</div>
                  </div>
                </div>
                <div className="flex items-baseline gap-2 pt-1 border-t border-white/[0.04]">
                  <div>
                    <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">Investments</div>
                    <div className="text-base font-bold text-emerald-300 tabular-nums">{(f.investment_count ?? 0).toLocaleString()}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground border-t border-white/[0.04] pt-2 mt-auto">
                  {f.website && <a href={f.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="hover:text-primary inline-flex items-center gap-1"><Globe className="w-2.5 h-2.5" /></a>}
                  {f.twitter && <a href={f.twitter.startsWith("http") ? f.twitter : `https://x.com/${f.twitter.replace(/^@/, "")}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="hover:text-primary inline-flex items-center gap-1"><Twitter className="w-2.5 h-2.5" /></a>}
                  <span className="ml-auto">{f.last_updated ? `updated ${tightAgo(f.last_updated)} ago` : "—"}</span>
                </div>
              </Link>
            ))}
          </div>
          {filtered.length > renderLimit && (
            <div className="px-4 py-3 text-xs text-muted-foreground text-center flex items-center justify-center gap-3">
              <span>Showing {renderLimit.toLocaleString()} of {filtered.length.toLocaleString()}.</span>
              <button onClick={() => setRenderLimit(l => l + 500)} className="text-primary hover:underline">Load 500 more</button>
              <button onClick={() => setRenderLimit(filtered.length)} className="text-primary hover:underline">Show all</button>
            </div>
          )}
        </>
      ) : (
        <div className="as-card p-0 overflow-hidden">
          <div className="overflow-x-auto max-h-[760px]">
            <table className="w-full text-xs">
              <thead className="bg-white/[0.02] border-b border-white/[0.04] sticky top-0 z-10">
                <tr className="text-left text-[10px] uppercase tracking-[0.08em] font-medium text-muted-foreground">
                  <th className="px-3 py-2.5">Fund</th>
                  <th className="px-2 py-2.5 text-right">Investments</th>
                  <th className="px-3 py-2.5">Links</th>
                  <th className="px-3 py-2.5">Updated</th>
                  <th className="px-2 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filtered.slice(0, renderLimit).map((f) => (
                  <tr key={f.slug} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5">
                      <Link to={`/funds/${f.slug}`} className="flex items-center gap-2 hover:text-primary">
                        <BrandLogo name={f.name} url={f.website} logo={f.logo} className="w-7 h-7 rounded shrink-0" />
                        <span className="text-sm text-white truncate max-w-[280px]">{f.name}</span>
                      </Link>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-emerald-300 font-medium">{(f.investment_count ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-[11px] text-muted-foreground">
                      <div className="inline-flex items-center gap-2">
                        {f.website && <a href={f.website} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1"><Globe className="w-3 h-3" /></a>}
                        {f.twitter && <a href={f.twitter.startsWith("http") ? f.twitter : `https://x.com/${f.twitter.replace(/^@/, "")}`} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1"><Twitter className="w-3 h-3" /></a>}
                        {f.linkedin && <a href={f.linkedin} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1"><Briefcase className="w-3 h-3" /></a>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-muted-foreground tabular-nums">{f.last_updated ? `${tightAgo(f.last_updated)} ago` : "—"}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-1">
                        <SaveTargetButton slug={f.slug} name={f.name} kind="fund" />
                        <Link to={`/funds/${f.slug}`} className="text-muted-foreground hover:text-primary inline-flex items-center"><ArrowRight className="w-3 h-3" /></Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > renderLimit && (
              <div className="px-4 py-3 text-xs text-muted-foreground text-center flex items-center justify-center gap-3">
                <span>Showing {renderLimit.toLocaleString()} of {filtered.length.toLocaleString()}.</span>
                <button onClick={() => setRenderLimit(l => l + 500)} className="text-primary hover:underline">Load 500 more</button>
                <button onClick={() => setRenderLimit(filtered.length)} className="text-primary hover:underline">Show all</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
