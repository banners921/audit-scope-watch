import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity, Building2, Banknote, ShieldCheck, Skull, Newspaper, Briefcase,
  AlertTriangle, ArrowRight, Crosshair, Sparkles,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { BrandLogo } from "@/components/BrandLogo";
import { SaveTargetButton } from "@/components/SaveTargetButton";
import { CategoryChip } from "@/components/CategoryChip";

type SavedRow = {
  id: string;
  company_slug: string;
  company_name: string | null;
  company_logo: string | null;
  saved_at: string;
  target_kind: "company" | "firm" | "fund" | null;
  pipeline_stage: string | null;
  last_signal_at: string | null;
};

function compactUsd(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
function tightAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400000);
  if (d < 1) {
    const h = Math.floor(ms / 3600000);
    return h <= 0 ? "now" : `${h}h`;
  }
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}

export default function Monitor() {
  const { user } = useAuth();
  const [empty] = useState(new Set<string>());

  const savedQ = useQuery({
    queryKey: ["monitor-saved", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("saved_targets")
        .select("id,company_slug,company_name,company_logo,saved_at,target_kind,pipeline_stage,last_signal_at")
        .eq("user_id", user!.id)
        .order("saved_at", { ascending: false });
      return (data ?? []) as SavedRow[];
    },
  });

  const watchedCompanies = useMemo(() => (savedQ.data ?? []).filter(s => (s.target_kind ?? "company") === "company"), [savedQ.data]);
  const watchedFirms = useMemo(() => (savedQ.data ?? []).filter(s => s.target_kind === "firm"), [savedQ.data]);
  const watchedFunds = useMemo(() => (savedQ.data ?? []).filter(s => s.target_kind === "fund"), [savedQ.data]);

  const companySlugs = useMemo(() => watchedCompanies.map(s => s.company_slug), [watchedCompanies]);
  const firmNames = useMemo(() => watchedFirms.map(s => s.company_slug), [watchedFirms]);
  const fundSlugs = useMemo(() => watchedFunds.map(s => s.company_slug), [watchedFunds]);

  // Enrich companies
  const compsQ = useQuery({
    queryKey: ["monitor-companies", companySlugs.length, companySlugs.slice(0, 5).join(",")],
    enabled: companySlugs.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("companies")
        .select("slug,name,logo,url,category,total_raised_usd,has_been_hacked,has_bug_bounty,last_audit_date,audit_count")
        .in("slug", companySlugs);
      const m = new Map<string, any>();
      for (const c of (data ?? []) as any[]) m.set(c.slug, c);
      return m;
    },
  });

  // Enrich firms (audit_firm_stats)
  const firmsStatsQ = useQuery({
    queryKey: ["monitor-firm-stats", firmNames.length, firmNames.slice(0, 5).join(",")],
    enabled: firmNames.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_firm_stats")
        .select("firm,total_audits,audited_protocols,latest_audit_date,avg_findings,avg_high_severity")
        .in("firm", firmNames);
      const m = new Map<string, any>();
      for (const f of (data ?? []) as any[]) m.set(f.firm, f);
      return m;
    },
  });

  // Enrich funds
  const fundsQ = useQuery({
    queryKey: ["monitor-funds", fundSlugs.length, fundSlugs.slice(0, 5).join(",")],
    enabled: fundSlugs.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("funds")
        .select("slug,name,logo,description,website,twitter")
        .in("slug", fundSlugs);
      const m = new Map<string, any>();
      for (const f of (data ?? []) as any[]) m.set(f.slug, f);
      return m;
    },
  });

  // Fund-portfolio counts
  const fundPortfolioQ = useQuery({
    queryKey: ["monitor-fund-portfolio", fundSlugs.length, fundSlugs.slice(0, 5).join(",")],
    enabled: fundSlugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("fund_portfolio")
        .select("fund_slug,company_slug")
        .in("fund_slug", fundSlugs);
      const m = new Map<string, Set<string>>();
      for (const r of (data ?? []) as any[]) {
        if (!m.has(r.fund_slug)) m.set(r.fund_slug, new Set());
        m.get(r.fund_slug)!.add(r.company_slug);
      }
      return m;
    },
  });

  // Signal counts per company over last 30d
  const companySignalsQ = useQuery({
    queryKey: ["monitor-signals", companySlugs.length, companySlugs.slice(0, 5).join(",")],
    enabled: companySlugs.length > 0,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const sinceDate = since.slice(0, 10);
      const [news, hacks, audits, hiring, raises] = await Promise.all([
        supabase.from("news_items").select("company_slug,published_at,title,url,sentiment").gte("published_at", since).in("company_slug", companySlugs).order("published_at", { ascending: false }).limit(200),
        supabase.from("hacks").select("company_slug,name,hack_date,amount_usd,technique,source_url,summary").gte("hack_date", sinceDate).in("company_slug", companySlugs).order("hack_date", { ascending: false }).limit(60),
        supabase.from("audit_history").select("company_slug,audit_firm,audit_date,report_url").gte("audit_date", sinceDate).in("company_slug", companySlugs).order("audit_date", { ascending: false }).limit(60),
        supabase.from("account_signals").select("company_slug,signal_type,signal_subtype,title,detail,evidence_url,fired_at").gte("fired_at", since).in("company_slug", companySlugs).order("fired_at", { ascending: false }).limit(80),
        supabase.from("funding_rounds").select("company_slug,company_name,amount_usd,round_type,date").gte("date", sinceDate).in("company_slug", companySlugs).order("date", { ascending: false }).limit(60),
      ]);
      const perSlug = new Map<string, { news: number; hacks: number; audits: number; hiring: number; raises: number }>();
      const bump = (slug: string, k: keyof { news: number; hacks: number; audits: number; hiring: number; raises: number }) => {
        const cur = perSlug.get(slug) ?? { news: 0, hacks: 0, audits: 0, hiring: 0, raises: 0 };
        cur[k]++; perSlug.set(slug, cur);
      };
      for (const x of (news.data ?? []) as any[]) bump(x.company_slug, "news");
      for (const x of (hacks.data ?? []) as any[]) bump(x.company_slug, "hacks");
      for (const x of (audits.data ?? []) as any[]) bump(x.company_slug, "audits");
      for (const x of (hiring.data ?? []) as any[]) bump(x.company_slug, "hiring");
      for (const x of (raises.data ?? []) as any[]) bump(x.company_slug, "raises");
      return {
        perSlug,
        items: { news: news.data ?? [], hacks: hacks.data ?? [], audits: audits.data ?? [], hiring: hiring.data ?? [], raises: raises.data ?? [] },
      };
    },
  });

  // Activity feed (combined; portfolio-watched only)
  const activity = useMemo(() => {
    const sig = companySignalsQ.data;
    if (!sig) return [] as any[];
    const items: any[] = [];
    for (const x of sig.items.news) items.push({ kind: "news", ts: x.published_at, slug: x.company_slug, title: x.title, sub: "news", url: x.url, sev: x.sentiment === "negative" ? "warn" : "info" });
    for (const x of sig.items.hacks) items.push({ kind: "hack", ts: x.hack_date, slug: x.company_slug, title: `Hack · ${compactUsd(Number(x.amount_usd))}`, sub: x.technique || x.summary?.slice(0, 100) || "incident", url: x.source_url, sev: "alert" });
    for (const x of sig.items.audits) items.push({ kind: "audit", ts: x.audit_date, slug: x.company_slug, title: `New audit · ${x.audit_firm || "—"}`, sub: x.report_url ? "report published" : "completed", url: x.report_url, sev: "info" });
    for (const x of sig.items.hiring) items.push({ kind: "hiring", ts: x.fired_at, slug: x.company_slug, title: x.title || x.signal_subtype || x.signal_type, sub: x.detail?.slice(0, 100) || x.signal_type, url: x.evidence_url, sev: "info" });
    for (const x of sig.items.raises) items.push({ kind: "raise", ts: x.date, slug: x.company_slug, title: `Raised ${compactUsd(Number(x.amount_usd))} · ${x.round_type || "round"}`, sub: "fresh capital", sev: "warn" });
    items.sort((a, b) => (b.ts > a.ts ? 1 : -1));
    return items.slice(0, 80);
  }, [companySignalsQ.data]);

  if (savedQ.isLoading) {
    return <div className="p-8 text-center text-xs text-muted-foreground">Loading monitor…</div>;
  }

  const totalWatched = watchedCompanies.length + watchedFirms.length + watchedFunds.length;
  if (totalWatched === 0) {
    return (
      <div className="max-w-[800px] mx-auto py-12 text-center space-y-3">
        <Crosshair className="w-7 h-7 text-primary mx-auto" />
        <h1 className="text-lg font-semibold text-white">Nothing on watch yet</h1>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          Click the <Crosshair className="w-3 h-3 inline-block -mt-0.5 text-primary" /> bullseye on any
          company, fund, or audit firm to add it here. The Monitor surfaces every news item, hack,
          audit, raise, and hiring signal across what you're watching.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1600px]">
      <header className="space-y-1">
        <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary">Watch list</div>
        <h1 className="text-xl font-semibold text-white tracking-tight">Monitor</h1>
        <p className="text-[11px] text-muted-foreground">
          {watchedCompanies.length} compan{watchedCompanies.length === 1 ? "y" : "ies"} ·{" "}
          {watchedFunds.length} fund{watchedFunds.length === 1 ? "" : "s"} ·{" "}
          {watchedFirms.length} audit firm{watchedFirms.length === 1 ? "" : "s"} on watch
        </p>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
        <div className="space-y-4">
          {/* Companies */}
          <section>
            <SectionHeader icon={<Building2 className="w-3.5 h-3.5" />} label="Companies" count={watchedCompanies.length} />
            {watchedCompanies.length === 0 ? (
              <EmptyHint message="No companies on watch. Click the bullseye on any protocol dossier or Companies row." />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {watchedCompanies.map(s => {
                  const c = compsQ.data?.get(s.company_slug);
                  const sig = companySignalsQ.data?.perSlug.get(s.company_slug);
                  return (
                    <Link key={s.id} to={`/protocol/${s.company_slug}`} className="as-card p-3 hover:border-primary/40 hover:bg-white/[0.025] transition-colors group relative flex flex-col gap-2">
                      <div className="absolute top-2 right-2 z-10">
                        <SaveTargetButton slug={s.company_slug} name={s.company_name || s.company_slug} logo={s.company_logo} kind="company" />
                      </div>
                      <div className="flex items-start gap-2.5 pr-7">
                        <BrandLogo name={s.company_name || s.company_slug} url={c?.url} logo={s.company_logo || c?.logo} className="w-9 h-9 rounded-md shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white truncate group-hover:text-primary">{s.company_name || s.company_slug}</div>
                          <div className="text-[10px] truncate"><CategoryChip cat={c?.category} selected={empty} onToggle={() => {}} stopProp /></div>
                        </div>
                      </div>
                      <div className="grid grid-cols-5 gap-1 text-center pt-1.5 border-t border-white/[0.04]">
                        <SigPip label="News" value={sig?.news ?? 0} />
                        <SigPip label="Audits" value={sig?.audits ?? 0} tone={sig?.audits ? "good" : "neutral"} />
                        <SigPip label="Raises" value={sig?.raises ?? 0} tone={sig?.raises ? "good" : "neutral"} />
                        <SigPip label="Hiring" value={sig?.hiring ?? 0} />
                        <SigPip label="Hacks" value={sig?.hacks ?? 0} tone={sig?.hacks ? "alert" : "neutral"} />
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground border-t border-white/[0.04] pt-1.5 mt-auto">
                        {c?.has_been_hacked && <Skull className="w-3 h-3 text-rose-400" aria-label="Past hack" />}
                        {c?.has_bug_bounty && <ShieldCheck className="w-3 h-3 text-emerald-300" aria-label="Active bug bounty" />}
                        <span className="ml-auto">Saved {tightAgo(s.saved_at)} ago</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          {/* Funds */}
          <section>
            <SectionHeader icon={<Banknote className="w-3.5 h-3.5" />} label="Funds" count={watchedFunds.length} />
            {watchedFunds.length === 0 ? (
              <EmptyHint message="No funds on watch. Open a fund profile and click the bullseye to add it." />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {watchedFunds.map(s => {
                  const f = fundsQ.data?.get(s.company_slug);
                  const positions = fundPortfolioQ.data?.get(s.company_slug)?.size ?? 0;
                  return (
                    <Link key={s.id} to={`/funds/${s.company_slug}`} className="as-card p-3 hover:border-primary/40 hover:bg-white/[0.025] transition-colors group relative flex flex-col gap-2">
                      <div className="absolute top-2 right-2 z-10">
                        <SaveTargetButton slug={s.company_slug} name={s.company_name || f?.name || s.company_slug} kind="fund" />
                      </div>
                      <div className="flex items-start gap-2.5 pr-7">
                        <BrandLogo name={s.company_name || f?.name || s.company_slug} url={f?.website} logo={f?.logo} className="w-9 h-9 rounded-md shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white truncate group-hover:text-primary">{s.company_name || f?.name || s.company_slug}</div>
                          <div className="text-[10px] text-muted-foreground/80 truncate">{f?.description?.slice(0, 80) || "Fund"}</div>
                        </div>
                      </div>
                      <div className="flex items-baseline justify-between gap-2 pt-1.5 border-t border-white/[0.04]">
                        <div>
                          <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">Positions</div>
                          <div className="text-base font-bold text-emerald-300 tabular-nums">{positions}</div>
                        </div>
                        <span className="text-[10px] text-muted-foreground">Saved {tightAgo(s.saved_at)} ago</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          {/* Audit firms */}
          <section>
            <SectionHeader icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Audit firms" count={watchedFirms.length} />
            {watchedFirms.length === 0 ? (
              <EmptyHint message="No audit firms on watch. Open an audit firm and click the bullseye to add it." />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {watchedFirms.map(s => {
                  const f = firmsStatsQ.data?.get(s.company_slug);
                  return (
                    <Link key={s.id} to={`/auditors/${encodeURIComponent(s.company_slug)}`} className="as-card p-3 hover:border-primary/40 hover:bg-white/[0.025] transition-colors group relative flex flex-col gap-2">
                      <div className="absolute top-2 right-2 z-10">
                        <SaveTargetButton slug={s.company_slug} name={s.company_name || s.company_slug} kind="firm" />
                      </div>
                      <div className="flex items-start gap-2.5 pr-7">
                        <BrandLogo name={s.company_name || s.company_slug} className="w-9 h-9 rounded-md shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white truncate group-hover:text-primary">{s.company_name || s.company_slug}</div>
                          <div className="text-[10px] text-muted-foreground/80 truncate">{f?.audited_protocols ?? 0} clients · {f?.total_audits ?? 0} audits</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-center pt-1.5 border-t border-white/[0.04]">
                        <SigPip label="Audits" value={f?.total_audits ?? 0} />
                        <SigPip label="Avg find" value={f?.avg_findings != null ? Number(f.avg_findings).toFixed(1) : "—"} />
                        <SigPip label="High sev" value={f?.avg_high_severity != null ? Number(f.avg_high_severity).toFixed(1) : "—"} />
                      </div>
                      <div className="text-[10px] text-muted-foreground border-t border-white/[0.04] pt-1.5 mt-auto">
                        Latest audit {f?.latest_audit_date || "—"}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* RIGHT RAIL — combined activity for watched companies */}
        <div className="space-y-3 xl:sticky xl:top-4 xl:self-start">
          <div className="as-card p-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-white/[0.06] bg-white/[0.02] flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-primary" />
              <h3 className="text-[11px] font-semibold text-white uppercase tracking-wider">Live activity</h3>
              <span className="text-[10px] text-muted-foreground ml-auto">{activity.length} · 30d</span>
            </div>
            {companySignalsQ.isLoading ? (
              <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">Loading activity…</div>
            ) : activity.length === 0 ? (
              <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">No activity in the last 30 days across watched companies.</div>
            ) : (
              <div className="divide-y divide-white/[0.04] max-h-[760px] overflow-y-auto">
                {activity.map((e, i) => {
                  const dotCls = e.sev === "alert" ? "bg-rose-400" : e.sev === "warn" ? "bg-amber-400" : "bg-sky-400";
                  const kindIcon = e.kind === "hack" ? <Skull className="w-2.5 h-2.5" />
                    : e.kind === "audit" ? <ShieldCheck className="w-2.5 h-2.5" />
                    : e.kind === "raise" ? <Banknote className="w-2.5 h-2.5" />
                    : e.kind === "hiring" ? <Briefcase className="w-2.5 h-2.5" />
                    : <Newspaper className="w-2.5 h-2.5" />;
                  return (
                    <div key={i} className="px-3 py-2 hover:bg-white/[0.02]">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${dotCls} shrink-0`} />
                        <Link to={`/protocol/${e.slug}`} className="text-[11px] font-medium text-white truncate flex-1 hover:text-primary">{e.slug}</Link>
                        <span className="text-[9px] uppercase font-bold text-muted-foreground inline-flex items-center gap-1 shrink-0">{kindIcon}{e.kind}</span>
                        <span className="text-[9px] text-muted-foreground tabular-nums shrink-0">{tightAgo(e.ts)}</span>
                      </div>
                      <div className="text-[11px] text-white/85 line-clamp-2 mt-0.5">{e.title}</div>
                      <div className="text-[10px] text-muted-foreground/80 line-clamp-1 flex items-center gap-1.5">
                        <span className="truncate">{e.sub}</span>
                        {e.url && <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline shrink-0 ml-auto">open ↗</a>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick insights summary */}
          <div className="as-card p-3">
            <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-primary" />
              Quick insights
            </div>
            <div className="space-y-1.5 text-[11.5px]">
              <Insight tone="alert" icon={<Skull className="w-3 h-3" />} label="Hack alerts" value={activity.filter(a => a.kind === "hack").length} />
              <Insight tone="good" icon={<ShieldCheck className="w-3 h-3" />} label="Fresh audits" value={activity.filter(a => a.kind === "audit").length} />
              <Insight tone="warn" icon={<Banknote className="w-3 h-3" />} label="New raises" value={activity.filter(a => a.kind === "raise").length} />
              <Insight tone="neutral" icon={<Briefcase className="w-3 h-3" />} label="Hiring signals" value={activity.filter(a => a.kind === "hiring").length} />
              <Insight tone="neutral" icon={<Newspaper className="w-3 h-3" />} label="News items" value={activity.filter(a => a.kind === "news").length} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="text-primary">{icon}</div>
      <div className="text-[10.5px] uppercase tracking-wider font-semibold text-white">{label}</div>
      <span className="text-[10px] text-muted-foreground tabular-nums">{count}</span>
    </div>
  );
}

function EmptyHint({ message }: { message: string }) {
  return <div className="as-card p-4 text-[11px] text-muted-foreground italic border border-dashed border-white/[0.08]">{message}</div>;
}

function SigPip({ label, value, tone = "neutral" }: { label: string; value: number | string; tone?: "good" | "warn" | "alert" | "neutral" }) {
  const cls = tone === "alert" && Number(value) > 0 ? "text-rose-300"
    : tone === "good" && Number(value) > 0 ? "text-emerald-300"
    : tone === "warn" && Number(value) > 0 ? "text-amber-300"
    : "text-white/85";
  return (
    <div>
      <div className={`text-[12px] font-bold tabular-nums ${cls}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70">{label}</div>
    </div>
  );
}

function Insight({ icon, label, value, tone = "neutral" }: { icon: React.ReactNode; label: string; value: number; tone?: "good" | "warn" | "alert" | "neutral" }) {
  const cls = tone === "alert" && value > 0 ? "text-rose-300"
    : tone === "good" && value > 0 ? "text-emerald-300"
    : tone === "warn" && value > 0 ? "text-amber-300"
    : "text-white/80";
  return (
    <div className="flex items-center gap-2">
      <span className={cls}>{icon}</span>
      <span className="text-white/80 flex-1">{label}</span>
      <span className={`tabular-nums font-medium ${cls}`}>{value}</span>
    </div>
  );
}
