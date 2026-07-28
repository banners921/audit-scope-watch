import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Calendar, Lock, Vote, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";
import { BookTabs } from "@/components/BookTabs";
import { useFundSlug, usePortfolioSlugs, usePortfolioCompanies } from "@/lib/usePortfolioSlugs";

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function daysUntil(d: string): number {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

type CalEvent =
  | { kind: "unlock"; date: string; slug: string; pct: number | null; vesting: string | null }
  | { kind: "vote"; date: string; slug: string; title: string; url: string | null }
  | { kind: "audit"; date: string; slug: string; firm: string; phase: string };

export default function BookCalendar() {
  const fundSlug = useFundSlug();
  const slugsQ = usePortfolioSlugs(fundSlug);
  const slugs = slugsQ.data ?? [];
  const companiesQ = usePortfolioCompanies(slugs);
  const companiesMap = companiesQ.data ?? new Map();

  const unlocksQ = useQuery({
    queryKey: ["bcal-unlocks", slugs.length],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("token_unlocks")
        .select("company_slug,next_unlock_date,next_unlock_pct_supply,vesting_kind,total_vested_remaining_pct,source")
        .in("company_slug", slugs).gte("next_unlock_date", today)
        .order("next_unlock_date", { ascending: true });
      return (data ?? []) as any[];
    },
  });

  const proposalsQ = useQuery({
    queryKey: ["bcal-proposals", slugs.length],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const today = Math.floor(Date.now() / 1000);
      const { data } = await supabase
        .from("governance_proposals")
        .select("company_slug,title,state,end_ts,proposal_url,votes_count,scores_total")
        .in("company_slug", slugs).gte("end_ts", today)
        .order("end_ts", { ascending: true }).limit(40);
      return (data ?? []) as any[];
    },
  });

  // Scheduled audits from contests
  const contestsQ = useQuery({
    queryKey: ["bcal-contests", slugs.length],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("audit_contests")
        .select("company_slug,audit_firm,starts_at,ends_at,status,prize_pool_usd")
        .in("company_slug", slugs).gte("ends_at", today)
        .order("starts_at", { ascending: true });
      return (data ?? []) as any[];
    },
  });

  const events: CalEvent[] = useMemo(() => {
    const items: CalEvent[] = [];
    for (const u of (unlocksQ.data ?? [])) {
      if (!u.next_unlock_date) continue;
      items.push({ kind: "unlock", date: u.next_unlock_date, slug: u.company_slug, pct: u.next_unlock_pct_supply, vesting: u.vesting_kind });
    }
    for (const p of (proposalsQ.data ?? [])) {
      if (!p.end_ts) continue;
      const date = new Date(Number(p.end_ts) * 1000).toISOString().slice(0, 10);
      items.push({ kind: "vote", date, slug: p.company_slug, title: p.title || "Proposal", url: p.proposal_url || null });
    }
    for (const c of (contestsQ.data ?? [])) {
      if (!c.starts_at) continue;
      items.push({ kind: "audit", date: c.starts_at, slug: c.company_slug, firm: c.audit_firm || "—", phase: c.status || "scheduled" });
    }
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }, [unlocksQ.data, proposalsQ.data, contestsQ.data]);

  const byWindow = useMemo(() => {
    const week: CalEvent[] = []; const month: CalEvent[] = []; const later: CalEvent[] = [];
    for (const e of events) {
      const d = daysUntil(e.date);
      if (d <= 7) week.push(e);
      else if (d <= 30) month.push(e);
      else later.push(e);
    }
    return { week, month, later };
  }, [events]);

  if (!fundSlug) {
    return (
      <div className="space-y-4 max-w-4xl">
        <BookTabs />
        <div className="as-card p-8 text-center text-sm text-muted-foreground">Set your fund on <Link to="/profile" className="text-primary hover:underline">your profile</Link> to see your portfolio calendar.</div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-[1600px]">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <BookTabs />
        <span className="text-[11px] text-muted-foreground">{slugs.length} positions</span>
      </div>

      <div>
        <h1 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2">
          <Calendar className="w-5 h-5 text-primary" /> Forward calendar
        </h1>
        <p className="text-xs text-muted-foreground mt-1">Token unlocks, governance votes, and scheduled audits across your book.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <KpiTile label="Unlocks ahead" value={String((unlocksQ.data ?? []).length)} hint="next on each token" tone={(unlocksQ.data ?? []).length > 0 ? "warn" : "good"} />
        <KpiTile label="Open votes" value={String((proposalsQ.data ?? []).length)} hint="Snapshot proposals" tone="neutral" />
        <KpiTile label="Audits scheduled" value={String((contestsQ.data ?? []).length)} hint="contests ahead" tone="neutral" />
      </div>

      <CalSection title="This week" items={byWindow.week} companiesMap={companiesMap} />
      <CalSection title="Next 30 days" items={byWindow.month} companiesMap={companiesMap} />
      <CalSection title="Later" items={byWindow.later} companiesMap={companiesMap} />

      {events.length === 0 && (
        <div className="as-card p-8 text-center text-xs text-muted-foreground">No upcoming calendar events tracked for your book.</div>
      )}
    </div>
  );
}

function CalSection({ title, items, companiesMap }: { title: string; items: CalEvent[]; companiesMap: Map<string, any> }) {
  if (items.length === 0) return null;
  return (
    <div className="as-card p-0 overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2 bg-white/[0.02]">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <span className="text-[11px] text-muted-foreground ml-1">{items.length} event{items.length === 1 ? "" : "s"}</span>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {items.map((e, i) => <CalRow key={i} ev={e} co={companiesMap.get(e.slug)} />)}
      </div>
    </div>
  );
}

function CalRow({ ev, co }: { ev: CalEvent; co: any }) {
  const d = daysUntil(ev.date);
  const inDays = d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d}d`;
  const icon = ev.kind === "unlock" ? <Lock className="w-3.5 h-3.5 text-amber-300" /> : ev.kind === "vote" ? <Vote className="w-3.5 h-3.5 text-violet-300" /> : <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />;
  const kindLabel = ev.kind === "unlock" ? "Token unlock" : ev.kind === "vote" ? "Governance vote" : "Audit scheduled";
  const subtitle =
    ev.kind === "unlock"
      ? `${ev.pct != null ? ev.pct + "% of supply" : "size unknown"}${ev.vesting ? " · " + ev.vesting : ""}`
      : ev.kind === "vote"
      ? ev.title
      : `${ev.firm} · ${ev.phase}`;
  const href = ev.kind === "vote" && ev.url ? ev.url : `/protocol/${ev.slug}`;
  const external = ev.kind === "vote" && !!ev.url;
  return (
    <a href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined} className="px-5 py-3 flex items-center gap-3 hover:bg-white/[0.02]">
      <div className="text-center shrink-0 w-14">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{new Date(ev.date).toLocaleDateString("en-US", { month: "short" })}</div>
        <div className="text-lg font-bold text-white leading-none mt-0.5">{new Date(ev.date).getDate()}</div>
        <div className="text-[10px] text-muted-foreground/80 mt-0.5">{inDays}</div>
      </div>
      <BrandLogo name={co?.name || ev.slug} url={co?.url} logo={co?.logo} className="w-9 h-9 rounded-md shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link to={`/protocol/${ev.slug}`} onClick={(e) => e.stopPropagation()} className="text-sm font-medium text-white hover:text-primary truncate">{co?.name || ev.slug}</Link>
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded bg-white/[0.06] text-white/80 border border-white/[0.1]">
            {icon}{kindLabel}
          </span>
        </div>
        <div className="text-[12.5px] text-white/80 mt-0.5 line-clamp-1">{subtitle}</div>
      </div>
      <div className="text-[11px] text-muted-foreground shrink-0">{fmtDate(ev.date)}</div>
    </a>
  );
}

function KpiTile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone: "good" | "warn" | "alert" | "neutral" }) {
  const cls = ({ neutral: "border-white/[0.06] bg-white/[0.02]", good: "border-emerald-500/25 bg-emerald-500/[0.04]", warn: "border-amber-500/30 bg-amber-500/[0.04]", alert: "border-rose-500/30 bg-rose-500/[0.06]" } as Record<string, string>)[tone];
  const valCls = ({ neutral: "text-white", good: "text-emerald-300", warn: "text-amber-200", alert: "text-rose-300" } as Record<string, string>)[tone];
  return (
    <div className={`rounded-lg border px-4 py-4 ${cls}`}>
      <div className="text-[10px] uppercase tracking-[0.08em] font-medium text-muted-foreground/90">{label}</div>
      <div className={`text-[26px] leading-none font-bold tabular-nums mt-2 ${valCls}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground/80 mt-2">{hint}</div>}
    </div>
  );
}
