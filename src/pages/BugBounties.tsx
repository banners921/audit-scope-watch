import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bug, Search, FileCode, ShieldCheck, ArrowRight, ExternalLink, Boxes, FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";
import { SaveTargetButton } from "@/components/SaveTargetButton";
import { CategoryChip } from "@/components/CategoryChip";

type BountyRow = {
  id: string;
  protocol_slug: string | null;
  company_slug: string | null;
  platform: string | null;
  max_bounty_usd: number | null;
  program_url: string | null;
  is_active: boolean | null;
  last_updated: string | null;
  critical_max_usd: number | null;
  high_max_usd: number | null;
  medium_max_usd: number | null;
  low_max_usd: number | null;
  scope_summary: string | null;
  scope_chains: string[] | null;
  reward_tokens: string[] | null;
  last_payout_date: string | null;
  total_paid_lifetime_usd: number | null;
  reports_valid_count: number | null;
  program_launched_at: string | null;
};

type Sort = "max_bounty" | "recent" | "platform";

function compactUsd(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
function tightAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400000);
  if (d < 1) return "today";
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
type Tag = { label: string; tone: "alert" | "warn" | "good" | "neutral"; title?: string };
function computeTags(b: BountyRow, companyTvl?: number | null): Tag[] {
  const tags: Tag[] = [];
  const max = b.critical_max_usd ?? b.max_bounty_usd ?? 0;
  // Undersized: TVL ratio
  if (companyTvl && companyTvl > 1_000_000 && max > 0) {
    const pct = (max / companyTvl) * 100;
    if (pct < 1) tags.push({ label: "undersized", tone: "alert", title: `Max bounty is ${pct.toFixed(2)}% of TVL — Immunefi recommends 5-10%` });
    else if (pct < 5) tags.push({ label: "below-recommended", tone: "warn", title: `Bounty is ${pct.toFixed(1)}% of TVL — slightly low` });
    else if (pct >= 10) tags.push({ label: "best-in-class", tone: "good", title: `Bounty is ${pct.toFixed(1)}% of TVL — top decile` });
  }
  // Stale: last payout / launch
  if (b.last_payout_date) {
    const d = (Date.now() - new Date(b.last_payout_date).getTime()) / 86400000;
    if (d > 365) tags.push({ label: "stale", tone: "warn", title: `Last payout ${Math.floor(d / 30)}mo ago` });
  }
  // New program
  if (b.program_launched_at) {
    const d = (Date.now() - new Date(b.program_launched_at).getTime()) / 86400000;
    if (d < 90) tags.push({ label: "new program", tone: "good", title: `Launched ${Math.floor(d)}d ago` });
  }
  // High lifetime payout = serious program
  if ((b.total_paid_lifetime_usd ?? 0) >= 1_000_000) tags.push({ label: `paid ${compactUsd(b.total_paid_lifetime_usd)}+`, tone: "good", title: "Lifetime payout to researchers" });
  // Token-only payout is a yellow flag
  if (b.reward_tokens && b.reward_tokens.length > 0 && !b.reward_tokens.some(t => /usdc|usdt|dai|usd|eth|btc/i.test(t))) {
    tags.push({ label: "token-only", tone: "warn", title: `Pays in ${b.reward_tokens.join(", ")} — not stable` });
  }
  return tags;
}
function tagClasses(tone: Tag["tone"]): string {
  switch (tone) {
    case "alert": return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    case "warn": return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "good": return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    default: return "bg-white/[0.05] text-white/75 border-white/10";
  }
}

function platformColor(p: string | null | undefined): string {
  const k = (p || "").toLowerCase();
  if (k === "immunefi") return "text-orange-300 bg-orange-500/10 border-orange-500/30";
  if (k === "hackenproof") return "text-sky-300 bg-sky-500/10 border-sky-500/30";
  if (k === "code4rena") return "text-rose-300 bg-rose-500/10 border-rose-500/30";
  if (k === "sherlock") return "text-violet-300 bg-violet-500/10 border-violet-500/30";
  if (k === "cantina") return "text-emerald-300 bg-emerald-500/10 border-emerald-500/30";
  return "text-white/80 bg-white/[0.04] border-white/10";
}

export default function BugBounties() {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("max_bounty");
  const [platform, setPlatform] = useState("");
  const [renderLimit, setRenderLimit] = useState(300);

  const bountiesQ = useQuery({
    queryKey: ["bug-bounties-all"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const all: BountyRow[] = [];
      const PAGE = 1000;
      for (let from = 0; from < 50000; from += PAGE) {
        const { data, error } = await supabase
          .from("bug_bounties")
          .select("id,protocol_slug,company_slug,platform,max_bounty_usd,program_url,is_active,last_updated,critical_max_usd,high_max_usd,medium_max_usd,low_max_usd,scope_summary,scope_chains,reward_tokens,last_payout_date,total_paid_lifetime_usd,reports_valid_count,program_launched_at")
          .order("max_bounty_usd", { ascending: false, nullsFirst: false })
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        all.push(...(data as BountyRow[]));
        if (data.length < PAGE) break;
      }
      return all;
    },
  });

  // Enrich each bounty with the company row (name, logo, category) for display
  const slugs = useMemo(() => Array.from(new Set((bountiesQ.data ?? []).map(b => b.company_slug || b.protocol_slug).filter(Boolean) as string[])), [bountiesQ.data]);
  const compsQ = useQuery({
    queryKey: ["bug-bounty-companies", slugs.length, slugs.slice(0, 5).join(",")],
    enabled: slugs.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const m = new Map<string, any>();
      const PAGE = 500;
      for (let i = 0; i < slugs.length; i += PAGE) {
        const batch = slugs.slice(i, i + PAGE);
        const { data } = await supabase.from("companies").select("slug,name,logo,url,category").in("slug", batch);
        for (const c of (data ?? []) as any[]) m.set(c.slug, c);
      }
      return m;
    },
  });

  const platforms = useMemo(() => Array.from(new Set((bountiesQ.data ?? []).map(b => b.platform).filter(Boolean))).sort() as string[], [bountiesQ.data]);
  const empty = useMemo(() => new Set<string>(), []);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let list = (bountiesQ.data ?? []).filter(b => {
      if (platform && b.platform !== platform) return false;
      if (ql) {
        const slug = b.company_slug || b.protocol_slug || "";
        const c = compsQ.data?.get(slug);
        const hay = `${slug} ${c?.name || ""} ${b.platform || ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      switch (sort) {
        case "platform": return (a.platform || "").localeCompare(b.platform || "");
        case "recent": return (b.last_updated || "").localeCompare(a.last_updated || "");
        default: return (b.max_bounty_usd ?? 0) - (a.max_bounty_usd ?? 0);
      }
    });
    return list;
  }, [bountiesQ.data, compsQ.data, q, sort, platform]);

  return (
    <div className="space-y-5 max-w-[1600px]">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Bug className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight">Bug Bounties</h1>
            <p className="text-[11px] text-muted-foreground mt-1">Every active bounty program we track across the universe.</p>
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {filtered.length.toLocaleString()} of {(bountiesQ.data ?? []).length.toLocaleString()} bounties
        </div>
      </div>

      {/* Inner tab toggle */}
      <div className="inline-flex rounded-md bg-white/[0.03] border border-white/[0.06] p-0.5 text-[11px]">
        <Link to="/audit-firms" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><ShieldCheck className="w-3 h-3" /> Firms</Link>
        <Link to="/audited-repos" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><FileCode className="w-3 h-3" /> Repos</Link>
        <Link to="/audit-reports" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><FileText className="w-3 h-3" /> Reports</Link>
        <span className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 bg-primary/15 text-primary font-medium"><Bug className="w-3 h-3" /> Bug Bounties</span>
        <Link to="/smart-contracts" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><Boxes className="w-3 h-3" /> Smart Contracts</Link>
      </div>

      <div className="as-card p-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-[400px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search protocol or platform…" className="w-full pl-8 pr-3 py-1.5 text-[12px] bg-white/[0.03] border border-white/[0.08] rounded text-white placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40" />
        </div>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="bg-white/[0.03] border border-white/[0.08] rounded px-2 py-1.5 text-[12px] text-white">
          <option value="">All platforms</option>
          {platforms.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="bg-white/[0.03] border border-white/[0.08] rounded px-2 py-1.5 text-[12px] text-white">
          <option value="max_bounty">Sort: biggest bounty</option>
          <option value="recent">Sort: recently updated</option>
          <option value="platform">Sort: by platform</option>
        </select>
      </div>

      {bountiesQ.isLoading ? (
        <div className="as-card p-8 text-center text-xs text-muted-foreground">Loading bounties…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.slice(0, renderLimit).map((b) => {
              const slug = b.company_slug || b.protocol_slug || "";
              const c = compsQ.data?.get(slug);
              const pCls = platformColor(b.platform);
              return (
                <div key={b.id} className="as-card p-3.5 flex flex-col gap-2.5 group relative">
                  <div className="absolute top-2 right-2 z-10">
                    {slug && <SaveTargetButton slug={slug} name={c?.name || slug} logo={c?.logo} kind="company" />}
                  </div>
                  <div className="flex items-start gap-2.5 pr-7">
                    <BrandLogo name={c?.name || slug} url={c?.url} logo={c?.logo} className="w-10 h-10 rounded-md shrink-0" />
                    <div className="min-w-0 flex-1">
                      {slug ? (
                        <Link to={`/protocol/${slug}`} className="text-sm font-semibold text-white truncate hover:text-primary block">{c?.name || slug}</Link>
                      ) : (
                        <div className="text-sm font-semibold text-white truncate">{c?.name || "—"}</div>
                      )}
                      <div className="text-[10px] truncate"><CategoryChip cat={c?.category} selected={empty} onToggle={() => {}} stopProp /></div>
                    </div>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 pt-1 border-t border-white/[0.04]">
                    <div>
                      <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">Max bounty</div>
                      <div className="text-base font-bold text-emerald-300 tabular-nums">{compactUsd(b.critical_max_usd ?? b.max_bounty_usd)}</div>
                    </div>
                    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${pCls}`}>{b.platform || "—"}</span>
                  </div>
                  {/* Severity tiers strip — only when enriched */}
                  {(b.critical_max_usd || b.high_max_usd || b.medium_max_usd || b.low_max_usd) && (
                    <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
                      {b.critical_max_usd != null && <span className="text-rose-300 tabular-nums">C {compactUsd(b.critical_max_usd)}</span>}
                      {b.high_max_usd != null && <span className="text-orange-300 tabular-nums">H {compactUsd(b.high_max_usd)}</span>}
                      {b.medium_max_usd != null && <span className="text-amber-300 tabular-nums">M {compactUsd(b.medium_max_usd)}</span>}
                      {b.low_max_usd != null && <span className="text-sky-300 tabular-nums">L {compactUsd(b.low_max_usd)}</span>}
                    </div>
                  )}
                  {/* Scope summary */}
                  {b.scope_summary && (
                    <p className="text-[11px] text-muted-foreground line-clamp-2 italic border-l-2 border-primary/30 pl-2 leading-snug">{b.scope_summary}</p>
                  )}
                  {/* Smart tags */}
                  {(() => {
                    const tags = computeTags(b, c?.total_raised_usd);
                    return tags.length > 0 ? (
                      <div className="flex items-center gap-1 flex-wrap">
                        {tags.map((t, i) => (
                          <span key={i} title={t.title} className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${tagClasses(t.tone)}`}>{t.label}</span>
                        ))}
                      </div>
                    ) : null;
                  })()}
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground border-t border-white/[0.04] pt-2 mt-auto">
                    {b.is_active === false ? <span className="text-rose-300 inline-flex items-center gap-1">● Inactive</span> : <span className="text-emerald-300 inline-flex items-center gap-1">● Active</span>}
                    <span className="ml-auto">{b.last_updated ? `updated ${tightAgo(b.last_updated)}` : "—"}</span>
                    {b.program_url && (
                      <a href={b.program_url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        program <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                    {slug && (
                      <Link to={`/protocol/${slug}`} className="text-muted-foreground hover:text-primary inline-flex items-center"><ArrowRight className="w-3 h-3" /></Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {filtered.length > renderLimit && (
            <div className="px-4 py-3 text-xs text-muted-foreground text-center flex items-center justify-center gap-3">
              <span>Showing {renderLimit.toLocaleString()} of {filtered.length.toLocaleString()}.</span>
              <button onClick={() => setRenderLimit(l => l + 500)} className="text-primary hover:underline">Load 500 more</button>
              <button onClick={() => setRenderLimit(filtered.length)} className="text-primary hover:underline">Show all</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
