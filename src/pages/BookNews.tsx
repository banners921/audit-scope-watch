import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Newspaper, Skull, Activity, ExternalLink, Filter } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";
import { BookTabs } from "@/components/BookTabs";
import { useFundSlug, usePortfolioSlugs, usePortfolioCompanies } from "@/lib/usePortfolioSlugs";

function compactUsd(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n === 0) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${(n / 1_000).toFixed(0)}K`;
}

function daysAgo(d: string | null | undefined): string {
  if (!d) return "—";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (days < 1) {
    const hours = Math.floor((Date.now() - new Date(d).getTime()) / 3600000);
    if (hours < 1) return "just now";
    return `${hours}h ago`;
  }
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const WINDOWS = [
  { label: "24h", hours: 24 },
  { label: "72h", hours: 72 },
  { label: "7d", hours: 24 * 7 },
  { label: "30d", hours: 24 * 30 },
] as const;

export default function BookNews() {
  const fundSlug = useFundSlug();
  const slugsQ = usePortfolioSlugs(fundSlug);
  const slugs = slugsQ.data ?? [];
  const companiesQ = usePortfolioCompanies(slugs);
  const companiesMap = companiesQ.data ?? new Map();

  const [windowHours, setWindowHours] = useState<number>(72);
  const [filter, setFilter] = useState<"all" | "news" | "hack" | "anomaly">("all");

  const newsQ = useQuery({
    queryKey: ["bnews-news", slugs.length, windowHours],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();
      const { data } = await supabase
        .from("news_items").select("company_slug,title,url,source,sentiment,published_at,summary")
        .in("company_slug", slugs).gte("published_at", cutoff)
        .order("published_at", { ascending: false }).limit(200);
      return (data ?? []) as any[];
    },
  });

  const hacksQ = useQuery({
    queryKey: ["bnews-hacks", slugs.length, windowHours],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - windowHours * 3600 * 1000).toISOString().slice(0, 10);
      const { data } = await supabase.from("hacks")
        .select("company_slug,name,hack_date,amount_usd,technique,returned_funds")
        .in("company_slug", slugs).gte("hack_date", cutoff)
        .order("hack_date", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  const anomQ = useQuery({
    queryKey: ["bnews-anom", slugs.length, windowHours],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - windowHours * 3600 * 1000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("metric_anomalies").select("company_slug,chain,date,z_score,direction,detail,metric_kind")
        .in("company_slug", slugs).gte("date", cutoff)
        .order("date", { ascending: false }).limit(80);
      return (data ?? []) as any[];
    },
  });

  const timeline = useMemo(() => {
    const items: Array<{ kind: "news" | "hack" | "anomaly"; ts: string; slug: string; title: string; subtitle: string; url?: string; sentiment?: string; severity: "critical" | "warn" | "info" }> = [];
    if (filter === "all" || filter === "hack") {
      for (const h of (hacksQ.data ?? [])) {
        items.push({
          kind: "hack", ts: h.hack_date, slug: h.company_slug,
          title: `Hack: ${h.name || "incident"}`,
          subtitle: `${compactUsd(Number(h.amount_usd))}${h.technique ? " · " + h.technique : ""}${h.returned_funds ? " · " + compactUsd(Number(h.returned_funds)) + " returned" : ""}`,
          severity: "critical",
        });
      }
    }
    if (filter === "all" || filter === "anomaly") {
      for (const a of (anomQ.data ?? [])) {
        if (Math.abs(Number(a.z_score) || 0) < 2.5) continue;
        items.push({
          kind: "anomaly", ts: a.date, slug: a.company_slug,
          title: `On-chain ${a.direction === "up" ? "spike" : "drop"} ${a.direction === "up" ? "+" : "-"}${Math.abs(Number(a.z_score)).toFixed(1)}σ`,
          subtitle: `${a.metric_kind || "tx_count"} · ${a.chain || ""} · ${a.detail || ""}`,
          severity: Math.abs(Number(a.z_score)) >= 4 ? "critical" : "warn",
        });
      }
    }
    if (filter === "all" || filter === "news") {
      for (const n of (newsQ.data ?? [])) {
        items.push({
          kind: "news", ts: n.published_at, slug: n.company_slug,
          title: n.title, subtitle: `${n.source || "news"} · ${n.summary?.slice(0, 120) || ""}`,
          url: n.url, sentiment: n.sentiment,
          severity: n.sentiment === "negative" ? "warn" : "info",
        });
      }
    }
    return items.sort((a, b) => (b.ts > a.ts ? 1 : -1));
  }, [hacksQ.data, anomQ.data, newsQ.data, filter]);

  // Group by day
  const byDay = useMemo(() => {
    const m = new Map<string, typeof timeline>();
    for (const item of timeline) {
      const day = item.ts.slice(0, 10);
      const arr = m.get(day) ?? [];
      arr.push(item);
      m.set(day, arr);
    }
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [timeline]);

  if (!fundSlug) {
    return (
      <div className="space-y-4 max-w-4xl">
        <BookTabs />
        <div className="as-card p-8 text-center text-sm text-muted-foreground">Set your fund on <Link to="/profile" className="text-primary hover:underline">your profile</Link> to see your portfolio news feed.</div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-[1600px]">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <BookTabs />
        <span className="text-[11px] text-muted-foreground">{slugs.length} positions tracked</span>
      </div>

      <div>
        <h1 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2">
          <Newspaper className="w-5 h-5 text-primary" /> Portfolio news
        </h1>
        <p className="text-xs text-muted-foreground mt-1">News, hack incidents, and on-chain anomalies across your book.</p>
      </div>

      {/* Filter bar */}
      <div className="as-card p-3 flex items-center gap-3 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-muted-foreground" />
        <div className="inline-flex rounded-md bg-white/[0.03] border border-white/[0.06] p-0.5 text-[11px]">
          {WINDOWS.map((w) => (
            <button key={w.hours} onClick={() => setWindowHours(w.hours)} className={`px-2.5 py-1 rounded transition-colors ${windowHours === w.hours ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-white"}`}>
              {w.label}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-md bg-white/[0.03] border border-white/[0.06] p-0.5 text-[11px]">
          {(["all", "news", "hack", "anomaly"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded transition-colors capitalize ${filter === f ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-white"}`}>
              {f}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground ml-auto">{timeline.length} items</span>
      </div>

      {/* Timeline */}
      {byDay.length === 0 ? (
        <div className="as-card p-8 text-center text-xs text-muted-foreground">No items in the selected window.</div>
      ) : (
        <div className="space-y-4">
          {byDay.map(([day, items]) => (
            <div key={day} className="as-card p-0 overflow-hidden">
              <div className="px-5 py-2 border-b border-white/[0.06] bg-white/[0.02]">
                <span className="text-[11px] uppercase tracking-[0.08em] font-medium text-muted-foreground">{new Date(day).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</span>
                <span className="text-[10px] text-muted-foreground/70 ml-2">{items.length} item{items.length === 1 ? "" : "s"}</span>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {items.map((e, i) => {
                  const co = companiesMap.get(e.slug);
                  const sev = e.severity === "critical" ? "border-l-rose-500" : e.severity === "warn" ? "border-l-amber-500" : "border-l-primary/40";
                  return (
                    <a key={i} href={e.url || `/protocol/${e.slug}`} target={e.url ? "_blank" : undefined} rel={e.url ? "noopener noreferrer" : undefined} className={`px-5 py-3 flex items-start gap-3 hover:bg-white/[0.02] border-l-2 ${sev}`}>
                      <BrandLogo name={co?.name || e.slug} url={co?.url} logo={co?.logo} className="w-9 h-9 rounded-md shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link to={`/protocol/${e.slug}`} onClick={(ev) => ev.stopPropagation()} className="text-sm font-medium text-white hover:text-primary truncate">{co?.name || e.slug}</Link>
                          <EventBadge kind={e.kind} sentiment={e.sentiment} />
                          <span className="text-[10px] text-muted-foreground ml-auto">{daysAgo(e.ts)}</span>
                          {e.url && <ExternalLink className="w-3 h-3 text-muted-foreground" />}
                        </div>
                        <div className="text-[13px] text-white/85 mt-0.5 line-clamp-2">{e.title}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{e.subtitle}</div>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EventBadge({ kind, sentiment }: { kind: "news" | "hack" | "anomaly"; sentiment?: string }) {
  if (kind === "hack") return <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-rose-500/25 text-rose-100 border border-rose-500/50"><Skull className="w-2.5 h-2.5" />hack</span>;
  if (kind === "anomaly") return <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-100 border border-amber-500/40"><Activity className="w-2.5 h-2.5" />anomaly</span>;
  const tone = sentiment === "negative" ? "bg-rose-500/15 text-rose-200 border-rose-500/30" : sentiment === "positive" ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/30" : "bg-white/[0.06] text-white/80 border-white/[0.1]";
  return <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border ${tone}`}><Newspaper className="w-2.5 h-2.5" />news</span>;
}
