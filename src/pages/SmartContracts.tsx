import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search, ShieldCheck, FileCode, Bug, Boxes, ExternalLink, Copy, FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";
import { canonicalCategory, categoryTextColor } from "@/lib/categories";
import { toast } from "sonner";

type Row = {
  id: string;
  chain: string;
  address: string;
  kind: string | null;
  label: string | null;
  company_slug: string;
  // Joined company fields:
  company_name: string;
  company_logo: string | null;
  company_url: string | null;
  company_category: string | null;
  company_description: string | null;
  last_audit_firm: string | null;
  last_audit_date: string | null;
  audit_count: number | null;
};

const EXPLORERS: Record<string, (addr: string) => string> = {
  ethereum: (a) => `https://etherscan.io/address/${a}`,
  bsc: (a) => `https://bscscan.com/address/${a}`,
  polygon: (a) => `https://polygonscan.com/address/${a}`,
  arbitrum: (a) => `https://arbiscan.io/address/${a}`,
  optimism: (a) => `https://optimistic.etherscan.io/address/${a}`,
  base: (a) => `https://basescan.org/address/${a}`,
  avalanche: (a) => `https://snowtrace.io/address/${a}`,
  fantom: (a) => `https://ftmscan.com/address/${a}`,
  solana: (a) => `https://solscan.io/account/${a}`,
  tron: (a) => `https://tronscan.org/#/address/${a}`,
  sui: (a) => `https://suivision.xyz/account/${a}`,
  aptos: (a) => `https://aptoscan.com/account/${a}`,
  cardano: () => `https://cardanoscan.io`,
  near: (a) => `https://nearblocks.io/address/${a}`,
};

function explorerUrl(chain: string, address: string): string | null {
  const fn = EXPLORERS[chain?.toLowerCase()];
  if (!fn) return null;
  return fn(address);
}

function truncateAddr(a: string): string {
  if (!a) return "";
  if (a.length <= 16) return a;
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const CHAIN_BADGE: Record<string, string> = {
  ethereum: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  bsc: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  polygon: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  arbitrum: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  optimism: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  base: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  avalanche: "bg-red-500/15 text-red-300 border-red-500/30",
  solana: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  tron: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  cardano: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  sui: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  aptos: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  near: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};
function chainBadge(c: string): string {
  return CHAIN_BADGE[c?.toLowerCase()] || "bg-white/[0.05] text-white/70 border-white/10";
}

export default function SmartContracts() {
  const [q, setQ] = useState("");
  const [chainFilter, setChainFilter] = useState<string>("all");
  const [renderLimit, setRenderLimit] = useState(200);

  const rowsQ = useQuery({
    queryKey: ["smart-contracts"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // Supabase REST caps responses at 1000 rows — paginate explicitly
      const PAGE = 1000;
      const rows: any[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from("chain_addresses")
          .select("id,chain,address,kind,label,company_slug")
          .eq("enabled", true)
          .order("id", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows.push(...data);
        if (data.length < PAGE) break;
        offset += PAGE;
        if (offset > 20000) break; // hard safety stop
      }
      const slugs = Array.from(new Set(rows.map(r => r.company_slug).filter(Boolean)));
      const companyMap = new Map<string, any>();
      if (slugs.length > 0) {
        // Batched fetch to avoid the 1000 row default
        for (let i = 0; i < slugs.length; i += 1000) {
          const chunk = slugs.slice(i, i + 1000);
          const { data: comps } = await supabase
            .from("companies")
            .select("slug,name,logo,url,category,description,last_audit_firm,last_audit_date,audit_count")
            .in("slug", chunk);
          for (const c of (comps ?? []) as any[]) companyMap.set(c.slug, c);
        }
      }
      return rows.map(r => {
        const c = companyMap.get(r.company_slug);
        return {
          ...r,
          company_name: c?.name || r.company_slug,
          company_logo: c?.logo || null,
          company_url: c?.url || null,
          company_category: c?.category || null,
          company_description: c?.description || null,
          last_audit_firm: c?.last_audit_firm || null,
          last_audit_date: c?.last_audit_date || null,
          audit_count: c?.audit_count ?? 0,
        };
      }) as Row[];
    },
  });

  const chains = useMemo(() => {
    const s = new Set<string>();
    for (const r of rowsQ.data ?? []) if (r.chain) s.add(r.chain.toLowerCase());
    return Array.from(s).sort();
  }, [rowsQ.data]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (rowsQ.data ?? []).filter(r => {
      if (chainFilter !== "all" && r.chain.toLowerCase() !== chainFilter) return false;
      if (ql) {
        const hay = `${r.company_name} ${r.company_slug} ${r.address} ${r.chain} ${r.company_category || ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [rowsQ.data, q, chainFilter]);

  async function copyAddr(addr: string) {
    try { await navigator.clipboard.writeText(addr); toast.success("Address copied"); }
    catch { toast.error("Copy failed"); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-white">Smart contracts</h1>
        <span className="text-xs text-muted-foreground">{rowsQ.data?.length.toLocaleString() || "—"} deployed addresses across {chains.length} chains</span>
      </div>

      {/* Inner tab strip — matches Audits page */}
      <div className="inline-flex rounded-md bg-white/[0.03] border border-white/[0.06] p-0.5 text-[11px]">
        <Link to="/audit-firms" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><ShieldCheck className="w-3 h-3" /> Firms</Link>
        <Link to="/audited-repos" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><FileCode className="w-3 h-3" /> Repos</Link>
        <Link to="/audit-reports" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><FileText className="w-3 h-3" /> Reports</Link>
        <Link to="/bug-bounties" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><Bug className="w-3 h-3" /> Bug Bounties</Link>
        <span className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 bg-primary/15 text-primary font-medium"><Boxes className="w-3 h-3" /> Smart Contracts</span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            placeholder="Search address, protocol, chain…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="bg-white/[0.04] border border-white/10 rounded pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40 w-72"
          />
        </div>
        <select
          value={chainFilter}
          onChange={(e) => setChainFilter(e.target.value)}
          className="bg-white/[0.04] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white"
        >
          <option value="all">All chains ({chains.length})</option>
          {chains.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="ml-auto text-[11px] text-muted-foreground">{filtered.length.toLocaleString()} matching</div>
      </div>

      {/* Grid */}
      {rowsQ.isLoading ? (
        <div className="as-card p-4 text-center text-xs text-muted-foreground">Loading deployed contracts…</div>
      ) : filtered.length === 0 ? (
        <div className="as-card p-4 text-center text-xs text-muted-foreground">No contracts match the filters.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.slice(0, renderLimit).map((r) => {
              const cat = canonicalCategory(r.company_category);
              const explorer = explorerUrl(r.chain, r.address);
              return (
                <div key={r.id} className="as-card p-3.5 flex flex-col gap-2.5 hover:border-primary/40 transition-colors">
                  <div className="flex items-start gap-2.5">
                    <BrandLogo name={r.company_name} url={r.company_url} logo={r.company_logo} className="w-10 h-10 rounded-md shrink-0" />
                    <div className="min-w-0 flex-1">
                      <Link to={`/protocol/${r.company_slug}`} className="text-sm font-semibold text-white hover:text-primary truncate block">
                        {r.company_name}
                      </Link>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${chainBadge(r.chain)}`}>
                          {r.chain}
                        </span>
                        {cat && <span className={`text-[10px] ${categoryTextColor(cat)}`}>· {cat}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Address row */}
                  <div className="flex items-center gap-1.5 text-[11px] font-mono bg-white/[0.02] border border-white/[0.04] rounded px-2 py-1.5">
                    <span className="text-muted-foreground/80 truncate flex-1" title={r.address}>{truncateAddr(r.address)}</span>
                    <button onClick={() => copyAddr(r.address)} title="Copy address" className="text-muted-foreground/60 hover:text-primary shrink-0">
                      <Copy className="w-3 h-3" />
                    </button>
                    {explorer && (
                      <a href={explorer} target="_blank" rel="noreferrer" title="Open in explorer" className="text-muted-foreground/60 hover:text-primary shrink-0">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>

                  {/* Brief description */}
                  {r.company_description && (
                    <div className="text-[11.5px] text-muted-foreground/90 line-clamp-2 leading-snug">
                      {r.company_description}
                    </div>
                  )}

                  {/* Audit footer */}
                  <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-white/[0.04] text-[10.5px]">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <ShieldCheck className="w-3 h-3" />
                      <span className="tabular-nums">{r.audit_count ?? 0} {r.audit_count === 1 ? "audit" : "audits"}</span>
                    </div>
                    {r.last_audit_firm && r.last_audit_date ? (
                      <div className="text-right">
                        <div className="text-white/90 truncate max-w-[160px]">{r.last_audit_firm}</div>
                        <div className="text-[10px] text-muted-foreground tabular-nums">{fmtDate(r.last_audit_date)}</div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground/60 italic">No audits yet</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {filtered.length > renderLimit && (
            <div className="text-center py-3 text-xs text-muted-foreground">
              Showing {renderLimit.toLocaleString()} of {filtered.length.toLocaleString()}.
              <button onClick={() => setRenderLimit(l => l + 300)} className="text-primary hover:underline ml-2">Load 300 more</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
