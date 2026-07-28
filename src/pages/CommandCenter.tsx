import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity,
  Building2,
  Banknote,
  ShieldCheck,
  AlertTriangle,
  Wallet,
  ArrowUpRight,
  BarChart3,
  Crosshair,
  Clock,
  ExternalLink,
  TrendingUp,
  Newspaper,
  Heart,
  Zap,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type Mode = "fund" | "auditor" | "tooling";
const HZ_FAST = 15_000;       // 15s — for the live activity stream + system pulse
const HZ_KPI = 30_000;        // 30s — for the count strip
const HZ_SLOW = 5 * 60_000;   // 5 min — for sector tally

export default function CommandCenter({
  mode,
  fundSlug,
  fundName,
}: {
  mode: Mode;
  fundSlug: string | null;
  fundName: string | null;
}) {
  // Tick every 10s so "X seconds ago" / "X minutes ago" labels stay fresh
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  // ── KPI counts ────────────────────────────────────────────────────────
  const stats = useQuery({
    queryKey: ["cc-stats"],
    refetchInterval: HZ_KPI,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
    queryFn: async () => {
      const [companies, audits, findings, rounds, hacks, firms] = await Promise.all([
        supabase.from("companies").select("slug", { count: "exact", head: true }),
        supabase.from("audit_history").select("id", { count: "exact", head: true }),
        supabase.from("audit_findings_detail").select("id", { count: "exact", head: true }),
        supabase.from("funding_rounds").select("id", { count: "exact", head: true }),
        supabase.from("hacks").select("id", { count: "exact", head: true }),
        supabase.from("audit_firm_meta").select("firm_name", { count: "exact", head: true }),
      ]);
      return {
        companies: companies.count ?? 0,
        audits: audits.count ?? 0,
        findings: findings.count ?? 0,
        rounds: rounds.count ?? 0,
        hacks: hacks.count ?? 0,
        firms: firms.count ?? 0,
      };
    },
  });

  // ── Live activity stream: data events + cron heartbeat merged ─────────
  const activity = useQuery({
    queryKey: ["cc-activity-mixed"],
    refetchInterval: HZ_FAST,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    queryFn: async () => {
      const [auditR, fundR, hackR, newsR, cronR] = await Promise.all([
        supabase
          .from("audit_history")
          .select("id,protocol_name,company_slug,audit_firm,created_at,findings_critical,findings_high")
          .order("created_at", { ascending: false })
          .limit(8),
        supabase
          .from("funding_rounds")
          .select("id,company_slug,company_name,round_type,amount_usd,created_at")
          .order("created_at", { ascending: false })
          .limit(8),
        supabase
          .from("hacks")
          .select("id,name,company_slug,amount_usd,created_at,classification")
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("news_items")
          .select("id,title,url,company_slug,source,created_at")
          .order("created_at", { ascending: false })
          .limit(5),
        supabase.rpc("recent_cron_pulse", { p_limit: 30 }),
      ]);
      const events: ActivityEvent[] = [];
      for (const a of (auditR.data ?? []) as any[]) {
        events.push({
          kind: "audit",
          id: `audit-${a.id}`,
          slug: a.company_slug,
          title: a.protocol_name || a.company_slug,
          subtitle: a.audit_firm || "Unknown firm",
          extra: a.findings_critical + a.findings_high > 0
            ? `${a.findings_critical || 0} crit · ${a.findings_high || 0} high`
            : null,
          when: a.created_at,
        });
      }
      for (const f of (fundR.data ?? []) as any[]) {
        events.push({
          kind: "funding",
          id: `fund-${f.id}`,
          slug: f.company_slug,
          title: f.company_name || f.company_slug,
          subtitle: f.round_type || "Round",
          extra: f.amount_usd ? `$${formatUsdShort(Number(f.amount_usd))}` : null,
          when: f.created_at,
        });
      }
      for (const h of (hackR.data ?? []) as any[]) {
        events.push({
          kind: "hack",
          id: `hack-${h.id}`,
          slug: h.company_slug,
          title: h.name || h.company_slug || "Hack",
          subtitle: h.classification || "Incident",
          extra: h.amount_usd ? `$${formatUsdShort(Number(h.amount_usd))}` : null,
          when: h.created_at,
        });
      }
      for (const n of (newsR.data ?? []) as any[]) {
        events.push({
          kind: "news",
          id: `news-${n.id}`,
          slug: n.company_slug,
          title: n.title || "News",
          subtitle: n.source || "—",
          extra: null,
          when: n.created_at,
          url: n.url,
        });
      }
      for (const c of (cronR.data ?? []) as any[]) {
        events.push({
          kind: "cron",
          id: `cron-${c.jobname}-${c.start_time}`,
          slug: null,
          title: c.jobname,
          subtitle: c.status === "succeeded" ? "ran successfully" : `status: ${c.status}`,
          extra: c.return_message ? c.return_message.slice(0, 32) : null,
          when: c.start_time,
        });
      }
      events.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
      return events.slice(0, 50);
    },
  });

  // ── Data freshness panel — straight from latest writes ────────────────
  const freshness = useQuery({
    queryKey: ["cc-freshness"],
    refetchInterval: HZ_FAST,
    refetchIntervalInBackground: true,
    staleTime: 10_000,
    queryFn: async () => {
      const [a, f, c, h, n] = await Promise.all([
        supabase.from("audit_history").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("funding_rounds").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("companies").select("last_updated").order("last_updated", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("hacks").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("news_items").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      return {
        audits_last: (a.data as any)?.created_at as string | null,
        rounds_last: (f.data as any)?.created_at as string | null,
        companies_last: (c.data as any)?.last_updated as string | null,
        hacks_last: (h.data as any)?.created_at as string | null,
        news_last: (n.data as any)?.created_at as string | null,
      };
    },
  });

  // ── System pulse: cron health summary ─────────────────────────────────
  const cronHealth = useQuery({
    queryKey: ["cc-cron-health"],
    refetchInterval: HZ_FAST,
    refetchIntervalInBackground: true,
    staleTime: 10_000,
    queryFn: async () => {
      const { data } = await supabase.rpc("cron_health_summary");
      return (data ?? []) as Array<{
        jobname: string;
        schedule: string;
        last_run: string | null;
        last_status: string | null;
        runs_1h: number;
        runs_24h: number;
        fail_24h: number;
      }>;
    },
  });

  // ── Hot sectors (90d) ────────────────────────────────────────────────
  const hot = useQuery({
    queryKey: ["cc-hot-sectors"],
    refetchInterval: HZ_SLOW,
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 90 * 86400_000).toISOString();
      const { data } = await supabase
        .from("audit_history")
        .select("company_slug, companies!inner(category)")
        .gte("created_at", since)
        .limit(2000);
      const tally: Record<string, number> = {};
      for (const row of (data ?? []) as any[]) {
        const cat = row.companies?.category;
        if (cat) tally[cat] = (tally[cat] || 0) + 1;
      }
      return Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 6);
    },
  });

  // ── Fund portfolio strip (only when fundSlug set) ─────────────────────
  const portfolio = useQuery({
    queryKey: ["cc-portfolio", fundSlug],
    enabled: !!fundSlug,
    refetchInterval: HZ_KPI,
    staleTime: 30_000,
    queryFn: async () => {
      const [latest, count] = await Promise.all([
        supabase
          .from("fund_portfolio")
          .select("company_slug,company_name,round_type,amount_usd,round_date")
          .eq("fund_slug", fundSlug!)
          .order("round_date", { ascending: false, nullsFirst: false })
          .limit(6),
        supabase.from("fund_portfolio").select("company_slug", { count: "exact", head: true }).eq("fund_slug", fundSlug!),
      ]);
      return { latest: (latest.data ?? []) as any[], count: count.count ?? 0 };
    },
  });

  const liveJobsLastMin = (cronHealth.data ?? []).filter((j) => {
    if (!j.last_run) return false;
    return Date.now() - new Date(j.last_run).getTime() < 90_000;
  }).length;

  return (
    <div className="max-w-[1320px] mx-auto px-1 py-5 space-y-5">
      {/* Header */}
      <header className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary">
            {mode === "auditor" ? "Auditor" : mode === "tooling" ? "Tooling" : "Fund"} workspace
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight mt-0.5">Command Center</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-[10px] text-muted-foreground font-mono flex items-center gap-1.5">
            <Heart className="w-3 h-3 text-emerald-400 animate-pulse" />
            <span className="text-emerald-300 tabular-nums">{liveJobsLastMin}</span>
            <span>job{liveJobsLastMin === 1 ? "" : "s"} in last 90s</span>
          </div>
          <div className="text-[10px] text-muted-foreground font-mono hidden md:flex items-center gap-1.5">
            <Activity className="w-3 h-3" />
            refresh · 15s
          </div>
        </div>
      </header>

      {/* Fund portfolio strip */}
      {fundSlug && portfolio.data && (
        <section className="as-card p-3 border border-primary/20 bg-primary/[0.025]">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <Wallet className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12px] font-semibold text-white truncate">{fundName || fundSlug}</span>
              <span className="text-[10px] text-muted-foreground">{portfolio.data.count.toLocaleString()} portfolio cos.</span>
            </div>
            <Link to="/portfolio-analytics" className="text-[10px] text-primary hover:underline inline-flex items-center gap-1">
              Open analytics <ArrowUpRight className="w-2.5 h-2.5" />
            </Link>
          </div>
          {portfolio.data.latest.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-1.5">
              {portfolio.data.latest.map((p) => (
                <Link
                  key={p.company_slug}
                  to={`/protocol/${p.company_slug}`}
                  className="rounded-md border border-white/[0.05] bg-white/[0.015] hover:bg-white/[0.04] px-2 py-1.5 text-[11px] truncate"
                >
                  <div className="text-white truncate font-medium">{p.company_name || p.company_slug}</div>
                  {p.round_type && <div className="text-muted-foreground text-[10px]">{p.round_type}</div>}
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-[10.5px] text-muted-foreground">No portfolio events yet — picking your fund will populate this.</div>
          )}
        </section>
      )}

      {!fundSlug && (
        <div className="as-card p-4 border border-dashed border-primary/30 bg-primary/[0.03]">
          <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-primary mb-1.5">Set up your fund</div>
          <div className="text-[12px] text-white/85 leading-relaxed">
            Pick your fund on your{" "}
            <Link to="/profile" className="text-primary hover:underline">
              profile
            </Link>{" "}
            to layer your portfolio on top of the universe view.
          </div>
        </div>
      )}

      {/* KPI strip */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <Kpi label="Companies" value={stats.data?.companies} icon={<Building2 className="w-3.5 h-3.5" />} to="/companies" />
        <Kpi label="Audits" value={stats.data?.audits} icon={<ShieldCheck className="w-3.5 h-3.5" />} to="/audit-firms" />
        <Kpi label="Findings" value={stats.data?.findings} icon={<AlertTriangle className="w-3.5 h-3.5" />} to="/findings" />
        <Kpi label="Funding rounds" value={stats.data?.rounds} icon={<Banknote className="w-3.5 h-3.5" />} to="/funding-rounds" />
        <Kpi label="Audit firms" value={stats.data?.firms} icon={<Crosshair className="w-3.5 h-3.5" />} to="/audit-firms" />
        <Kpi label="Hacks tracked" value={stats.data?.hacks} icon={<TrendingUp className="w-3.5 h-3.5" />} to="/unusual-activity" />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Activity stream */}
        <section className="lg:col-span-2 as-card p-4">
          <header className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-primary" />
              <h2 className="text-[13px] font-semibold text-white">Live activity</h2>
              <span className="text-[10px] text-muted-foreground">data + cron pulse</span>
            </div>
            <div className="text-[10px] text-muted-foreground font-mono">
              {activity.isFetching ? (
                <span className="inline-flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />refreshing…</span>
              ) : (
                <span>updated {timeAgo(new Date(activity.dataUpdatedAt).toISOString())}</span>
              )}
            </div>
          </header>
          {activity.isLoading && <SkeletonRows />}
          {activity.data && (
            <ul className="space-y-0.5">
              {activity.data.map((e) => (
                <ActivityRow key={e.id} ev={e} />
              ))}
            </ul>
          )}
        </section>

        {/* Pipeline / freshness sidebar */}
        <section className="space-y-3">
          <div className="as-card p-4">
            <header className="flex items-center gap-2 mb-3">
              <Clock className="w-3.5 h-3.5 text-primary" />
              <h2 className="text-[13px] font-semibold text-white">Data freshness</h2>
            </header>
            <ul className="space-y-2 text-[11.5px]">
              <FreshnessRow label="Latest funding round" ts={freshness.data?.rounds_last} />
              <FreshnessRow label="Latest company update" ts={freshness.data?.companies_last} />
              <FreshnessRow label="Latest audit" ts={freshness.data?.audits_last} />
              <FreshnessRow label="Latest hack tracked" ts={freshness.data?.hacks_last} />
              <FreshnessRow label="Latest news item" ts={freshness.data?.news_last} />
            </ul>
          </div>

          <div className="as-card p-4">
            <header className="flex items-center gap-2 mb-2">
              <Heart className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <h2 className="text-[13px] font-semibold text-white">System pulse</h2>
              <span className="text-[10px] text-muted-foreground ml-auto">{cronHealth.data?.length ?? 0} jobs</span>
            </header>
            <p className="text-[10.5px] text-muted-foreground mb-2 leading-relaxed">
              Every cron's last run + 24h run count. Proof the engine is alive.
            </p>
            {cronHealth.data && (
              <ul className="space-y-1 max-h-80 overflow-y-auto pr-1">
                {cronHealth.data.slice(0, 12).map((j) => (
                  <li key={j.jobname} className="flex items-center justify-between text-[10.5px] gap-2">
                    <span className="text-white/85 truncate flex-1 font-mono">{j.jobname}</span>
                    <span className="text-muted-foreground tabular-nums">{j.runs_24h}/d</span>
                    <span className={`tabular-nums w-12 text-right font-mono ${j.fail_24h ? "text-rose-300" : "text-emerald-300"}`}>
                      {timeAgo(j.last_run)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="as-card p-4">
            <header className="flex items-center gap-2 mb-3">
              <BarChart3 className="w-3.5 h-3.5 text-primary" />
              <h2 className="text-[13px] font-semibold text-white">Hot sectors (90d)</h2>
            </header>
            {hot.isLoading && <div className="text-[11px] text-muted-foreground">Loading…</div>}
            {hot.data && hot.data.length > 0 && (
              <ul className="space-y-1.5">
                {hot.data.map(([cat, n]) => (
                  <li key={cat} className="flex items-center justify-between text-[11.5px]">
                    <span className="text-white/90">{cat}</span>
                    <span className="text-muted-foreground font-mono">{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Quick jumps */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        <JumpTile to="/companies" icon={<Building2 className="w-3.5 h-3.5" />} title="Companies" hint="Browse + filter" />
        <JumpTile to="/funding-rounds" icon={<Banknote className="w-3.5 h-3.5" />} title="Funding rounds" hint="Recent raises" />
        <JumpTile to="/audit-firms" icon={<ShieldCheck className="w-3.5 h-3.5" />} title="Audits & firms" hint="Reports + findings" />
        <JumpTile to="/funds-intel" icon={<Wallet className="w-3.5 h-3.5" />} title="Funds" hint="VCs we track" />
      </section>
    </div>
  );
}

type ActivityKind = "audit" | "funding" | "hack" | "news" | "cron";
type ActivityEvent = {
  kind: ActivityKind;
  id: string;
  slug: string | null;
  title: string;
  subtitle: string;
  extra: string | null;
  when: string;
  url?: string;
};

function Kpi({ label, value, icon, to }: { label: string; value: number | undefined; icon: React.ReactNode; to: string }) {
  return (
    <Link to={to} className="as-card p-3 hover:border-primary/40 hover:bg-white/[0.025] transition-colors group">
      <div className="flex items-center gap-1.5 text-muted-foreground group-hover:text-primary">
        {icon}
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-xl font-semibold text-white mt-1 tabular-nums">
        {value == null ? <span className="inline-block w-12 h-5 rounded bg-white/[0.04] animate-pulse" /> : value.toLocaleString()}
      </div>
    </Link>
  );
}

function ActivityRow({ ev }: { ev: ActivityEvent }) {
  const dest = ev.url ?? (ev.slug ? `/protocol/${ev.slug}` : ev.kind === "cron" ? null : "/companies");
  const meta = META[ev.kind];
  const body = (
    <div className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-colors text-[12px] ${ev.kind === "cron" ? "opacity-70 hover:opacity-100" : "hover:bg-white/[0.03]"}`}>
      <span className={`shrink-0 ${meta.iconCls}`}>{meta.icon}</span>
      <span className={`truncate flex-1 ${ev.kind === "cron" ? "text-muted-foreground font-mono text-[11.5px]" : "text-white/95"}`}>
        {ev.title}
      </span>
      <span className="text-muted-foreground text-[11px] hidden md:inline truncate max-w-[150px]">{ev.subtitle}</span>
      {ev.extra && (
        <span className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded ${ev.kind === "cron" ? "bg-white/[0.03] text-muted-foreground" : "bg-white/[0.05] text-white/80"}`}>
          {ev.extra}
        </span>
      )}
      <span className="text-[10px] text-muted-foreground font-mono w-14 text-right tabular-nums shrink-0">{timeAgo(ev.when)}</span>
      {dest && <ArrowUpRight className="w-3 h-3 text-muted-foreground/50" />}
    </div>
  );
  if (!dest) return <li>{body}</li>;
  if (dest.startsWith("http")) {
    return <li><a href={dest} target="_blank" rel="noreferrer">{body}</a></li>;
  }
  return <li><Link to={dest}>{body}</Link></li>;
}

const META: Record<ActivityKind, { icon: React.ReactNode; iconCls: string }> = {
  audit: { icon: <ShieldCheck className="w-3.5 h-3.5" />, iconCls: "text-amber-300" },
  funding: { icon: <Banknote className="w-3.5 h-3.5" />, iconCls: "text-emerald-300" },
  hack: { icon: <AlertTriangle className="w-3.5 h-3.5" />, iconCls: "text-rose-300" },
  news: { icon: <Newspaper className="w-3.5 h-3.5" />, iconCls: "text-sky-300" },
  cron: { icon: <Heart className="w-3 h-3" />, iconCls: "text-emerald-400/60" },
};

function FreshnessRow({ label, ts }: { label: string; ts: string | null | undefined }) {
  const age = ts ? Date.now() - new Date(ts).getTime() : null;
  const isStale = age != null && age > 7 * 86400_000;
  const isVeryStale = age != null && age > 30 * 86400_000;
  return (
    <li className="flex items-center justify-between">
      <span className="text-white/85">{label}</span>
      {ts ? (
        <span
          className={`tabular-nums font-mono ${
            isVeryStale ? "text-rose-300" : isStale ? "text-amber-300" : "text-emerald-300"
          }`}
        >
          {timeAgo(ts)}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </li>
  );
}

function JumpTile({ to, icon, title, hint }: { to: string; icon: React.ReactNode; title: string; hint: string }) {
  return (
    <Link to={to} className="as-card p-3 hover:border-primary/40 hover:bg-white/[0.025] transition-colors group flex items-center gap-2.5">
      <span className="text-primary group-hover:scale-110 transition-transform">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-semibold text-white">{title}</div>
        <div className="text-[10.5px] text-muted-foreground">{hint}</div>
      </div>
      <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
    </Link>
  );
}

function SkeletonRows() {
  return (
    <ul className="space-y-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <li key={i} className="h-7 rounded-md bg-white/[0.02] animate-pulse" />
      ))}
    </ul>
  );
}

function timeAgo(ts: string | null | undefined): string {
  if (!ts) return "—";
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 10_000) return "now";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function formatUsdShort(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}
