import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ShieldCheck, AlertTriangle, Clock, Skull, ArrowRight, Calendar } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, Cell, PieChart, Pie, Legend } from "recharts";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";
import { BookTabs } from "@/components/BookTabs";
import { useFundSlug, usePortfolioSlugs, usePortfolioCompanies } from "@/lib/usePortfolioSlugs";

function compactUsd(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n === 0) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

const SEV_COLORS: Record<string, string> = { critical: "#f43f5e", high: "#fb923c", medium: "#fbbf24", low: "#94a3b8", info: "#64748b" };
const BAND_COLORS: Record<string, string> = { low: "#10b981", medium: "#fbbf24", high: "#fb923c", critical: "#f43f5e" };

export default function BookSecurity() {
  const fundSlug = useFundSlug();
  const slugsQ = usePortfolioSlugs(fundSlug);
  const slugs = slugsQ.data ?? [];
  const companiesQ = usePortfolioCompanies(slugs);
  const companiesMap = companiesQ.data ?? new Map();

  const findingsQ = useQuery({
    queryKey: ["bsec-findings", slugs.length],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_findings_detail").select("company_slug,severity,status,title,audit_id,created_at")
        .in("company_slug", slugs).limit(8000);
      return (data ?? []) as any[];
    },
  });

  const auditsQ = useQuery({
    queryKey: ["bsec-audits", slugs.length],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_history")
        .select("company_slug,audit_firm,audit_date,findings_critical,findings_high,findings_medium,findings_low")
        .in("company_slug", slugs).order("audit_date", { ascending: false, nullsFirst: false });
      return (data ?? []) as any[];
    },
  });

  const tvlQ = useQuery({
    queryKey: ["bsec-tvl", slugs.length],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("protocol_metrics").select("company_slug,tvl,date")
        .in("company_slug", slugs).not("tvl", "is", null).order("date", { ascending: false }).limit(2000);
      const m = new Map<string, number>();
      for (const r of (data ?? []) as any[]) if (!m.has(r.company_slug)) m.set(r.company_slug, Number(r.tvl));
      return m;
    },
  });

  const scoresQ = useQuery({
    queryKey: ["bsec-scores", slugs.length],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("protocol_risk_scores").select("company_slug,composite_score,band").in("company_slug", slugs);
      return (data ?? []) as any[];
    },
  });

  const hacksQ = useQuery({
    queryKey: ["bsec-hacks", slugs.length],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("hacks").select("company_slug,name,hack_date,amount_usd,technique,returned_funds").in("company_slug", slugs).order("hack_date", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  const bountiesQ = useQuery({
    queryKey: ["bsec-bounties", slugs.length],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("bug_bounties").select("company_slug,platform,max_bounty_usd,is_active").in("company_slug", slugs);
      return (data ?? []) as any[];
    },
  });

  // Findings open by company
  const openByCompany = useMemo(() => {
    const isOpen = (s: string) => !["fixed", "resolved", "remediated", "acknowledged", "won't fix", "wontfix"].includes((s || "").toLowerCase());
    const m = new Map<string, { critical: number; high: number; medium: number; low: number; lastAudit: string | null }>();
    for (const f of (findingsQ.data ?? [])) {
      if (!isOpen(f.status)) continue;
      const sev = (f.severity || "").toLowerCase();
      const e = m.get(f.company_slug) ?? { critical: 0, high: 0, medium: 0, low: 0, lastAudit: null };
      if (sev === "critical") e.critical++;
      else if (sev === "high") e.high++;
      else if (sev === "medium") e.medium++;
      else if (sev === "low") e.low++;
      m.set(f.company_slug, e);
    }
    return m;
  }, [findingsQ.data]);

  // Severity distribution across book
  const severityDist = useMemo(() => {
    const dist: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const isOpen = (s: string) => !["fixed", "resolved", "remediated", "acknowledged", "won't fix", "wontfix"].includes((s || "").toLowerCase());
    for (const f of (findingsQ.data ?? [])) {
      if (!isOpen(f.status)) continue;
      const sev = (f.severity || "").toLowerCase();
      if (sev in dist) dist[sev]++;
    }
    return Object.entries(dist).map(([severity, count]) => ({ severity, count }));
  }, [findingsQ.data]);

  // Open findings register
  const openRegister = useMemo(() => {
    const rows: Array<{ slug: string; name: string; critical: number; high: number; tvl: number | null; lastAudit: string | null; firm: string | null; url: string | null; logo: string | null }> = [];
    const auditMostRecent = new Map<string, { date: string; firm: string }>();
    for (const a of (auditsQ.data ?? [])) {
      if (!a.audit_date) continue;
      if (!auditMostRecent.has(a.company_slug)) auditMostRecent.set(a.company_slug, { date: a.audit_date, firm: a.audit_firm });
    }
    for (const [slug, f] of openByCompany) {
      if (f.critical + f.high === 0) continue;
      const co = companiesMap.get(slug);
      const audit = auditMostRecent.get(slug);
      rows.push({
        slug, name: co?.name || slug,
        critical: f.critical, high: f.high,
        tvl: tvlQ.data?.get(slug) ?? null,
        lastAudit: audit?.date || co?.last_audit_date || null,
        firm: audit?.firm || co?.last_audit_firm || null,
        url: co?.url || null, logo: co?.logo || null,
      });
    }
    return rows.sort((a, b) => (b.critical * 5 + b.high) - (a.critical * 5 + a.high));
  }, [openByCompany, auditsQ.data, companiesMap, tvlQ.data]);

  // Audit decay watchlist
  const auditDecay = useMemo(() => {
    const items: Array<{ slug: string; name: string; daysSince: number; tvl: number | null; firm: string | null; url: string | null; logo: string | null }> = [];
    for (const [slug, co] of companiesMap) {
      const tvl = tvlQ.data?.get(slug) ?? null;
      if (!co.last_audit_date) {
        if (tvl && tvl > 5_000_000) items.push({ slug, name: co.name, daysSince: 999, tvl, firm: null, url: co.url, logo: co.logo });
        continue;
      }
      const days = Math.floor((Date.now() - new Date(co.last_audit_date).getTime()) / 86400000);
      if (days > 365 && tvl && tvl > 5_000_000) items.push({ slug, name: co.name, daysSince: days, tvl, firm: co.last_audit_firm, url: co.url, logo: co.logo });
    }
    return items.sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0));
  }, [companiesMap, tvlQ.data]);

  // Risk band distribution
  const bandDist = useMemo(() => {
    const dist: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const s of (scoresQ.data ?? [])) if (s.band in dist) dist[s.band]++;
    return Object.entries(dist).filter(([, n]) => n > 0).map(([band, count]) => ({ band, count, fill: BAND_COLORS[band] }));
  }, [scoresQ.data]);

  // Active bounty coverage
  const bountyCoverage = useMemo(() => {
    const bountyMap = new Map<string, { active: boolean; max: number }>();
    for (const b of (bountiesQ.data ?? [])) {
      const e = bountyMap.get(b.company_slug) ?? { active: false, max: 0 };
      if (b.is_active !== false) e.active = true;
      e.max = Math.max(e.max, Number(b.max_bounty_usd) || 0);
      bountyMap.set(b.company_slug, e);
    }
    const covered = Array.from(bountyMap.values()).filter(b => b.active).length;
    return { covered, total: slugs.length, pct: slugs.length > 0 ? (covered / slugs.length) * 100 : 0 };
  }, [bountiesQ.data, slugs.length]);

  if (!fundSlug) {
    return (
      <div className="space-y-4 max-w-4xl">
        <BookTabs />
        <div className="as-card p-8 text-center text-sm text-muted-foreground">Set your fund on <Link to="/profile" className="text-primary hover:underline">your profile</Link> to see your portfolio security view.</div>
      </div>
    );
  }

  const totalCriticals = severityDist.find(d => d.severity === "critical")?.count ?? 0;
  const totalHighs = severityDist.find(d => d.severity === "high")?.count ?? 0;

  return (
    <div className="space-y-5 max-w-[1600px]">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <BookTabs />
        <span className="text-[11px] text-muted-foreground">{slugs.length} positions</span>
      </div>

      <div>
        <h1 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" /> Security landscape
        </h1>
        <p className="text-xs text-muted-foreground mt-1">Findings, audits, hacks, and bounty coverage across your entire book.</p>
        <div className="text-[11px] text-amber-300/80 mt-2 px-2.5 py-1.5 rounded border border-amber-500/20 bg-amber-500/[0.04] inline-block">
          ⓘ Finding counts reflect what auditors reported in the audit document — we do not verify live patch status. Older audits may show issues that have since been fixed.
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile label="Crit reported" value={String(totalCriticals)} tone={totalCriticals > 0 ? "alert" : "good"} hint="in latest audits · not live-verified" />
        <KpiTile label="High reported" value={String(totalHighs)} tone={totalHighs > 0 ? "warn" : "good"} hint="in latest audits · not live-verified" />
        <KpiTile label="Audit-decay flags" value={String(auditDecay.length)} tone={auditDecay.length > 0 ? "warn" : "good"} hint="$5M+ TVL, 12mo+ silent" />
        <KpiTile label="Bounty coverage" value={`${bountyCoverage.pct.toFixed(0)}%`} tone={bountyCoverage.pct > 60 ? "good" : bountyCoverage.pct > 30 ? "warn" : "alert"} hint={`${bountyCoverage.covered}/${bountyCoverage.total} positions`} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="as-card p-4">
          <h3 className="text-sm font-semibold text-white mb-3">Findings by severity <span className="text-[10px] font-normal text-muted-foreground">· as reported in audits</span></h3>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={severityDist} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="severity" stroke="#888" fontSize={10} />
                <YAxis stroke="#888" fontSize={10} allowDecimals={false} />
                <ReTooltip contentStyle={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)", fontSize: 11 }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {severityDist.map((d, i) => <Cell key={i} fill={SEV_COLORS[d.severity] || "#888"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="as-card p-4">
          <h3 className="text-sm font-semibold text-white mb-3">Risk-band distribution</h3>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={bandDist} dataKey="count" nameKey="band" cx="50%" cy="50%" outerRadius={70} innerRadius={45} label={(d: any) => `${d.band}: ${d.count}`} labelLine={false} fontSize={10}>
                  {bandDist.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <ReTooltip contentStyle={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)", fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Open findings register */}
      <div className="as-card p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-300" />
          <h3 className="text-sm font-semibold text-white">Critical & high findings — reported in audits</h3>
          <span className="text-[11px] text-muted-foreground ml-1">{openRegister.length} position{openRegister.length === 1 ? "" : "s"} · not live-verified</span>
          <Link to="/findings" className="ml-auto text-[11px] text-primary hover:underline inline-flex items-center gap-1">
            full register <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {openRegister.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-muted-foreground">No critical or high findings reported in tracked audits across your book.</div>
        ) : (
          <div className="divide-y divide-white/[0.04] max-h-[480px] overflow-y-auto">
            {openRegister.map((f) => (
              <Link key={f.slug} to={`/protocol/${f.slug}`} className="px-5 py-3 flex items-center gap-3 hover:bg-white/[0.02]">
                <BrandLogo name={f.name} url={f.url} logo={f.logo} className="w-9 h-9 rounded-md shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{f.name}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    last audit {f.firm || "—"} {f.lastAudit ? `· ${new Date(f.lastAudit).toLocaleDateString()}` : ""} · TVL {compactUsd(f.tvl)}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {f.critical > 0 && <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-200 border border-rose-500/40 text-[11px] font-bold tabular-nums">{f.critical} crit</span>}
                  {f.high > 0 && <span className="px-2 py-0.5 rounded bg-orange-500/15 text-orange-200 border border-orange-500/30 text-[11px] font-bold tabular-nums">{f.high} high</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Audit decay + hack history */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="as-card p-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-300" />
            <h3 className="text-sm font-semibold text-white">Audit decay watchlist</h3>
            <span className="text-[11px] text-muted-foreground ml-1">{">"} 12mo on $5M+ TVL</span>
          </div>
          {auditDecay.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">No audit-decay flags.</div>
          ) : (
            <div className="divide-y divide-white/[0.04] max-h-[400px] overflow-y-auto">
              {auditDecay.map((a) => (
                <Link key={a.slug} to={`/protocol/${a.slug}`} className="px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02]">
                  <BrandLogo name={a.name} url={a.url} logo={a.logo} className="w-8 h-8 rounded-md shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{a.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      last audit {a.firm || "—"} · {a.daysSince >= 999 ? "no audit on file" : `${Math.floor(a.daysSince / 30)}mo ago`}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold tabular-nums text-amber-200">{compactUsd(a.tvl)}</div>
                    <div className="text-[10px] text-muted-foreground">TVL</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="as-card p-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
            <Skull className="w-4 h-4 text-rose-400" />
            <h3 className="text-sm font-semibold text-white">Hack history in book</h3>
            <span className="text-[11px] text-muted-foreground ml-1">{(hacksQ.data ?? []).length} incident{(hacksQ.data ?? []).length === 1 ? "" : "s"} on record</span>
          </div>
          {(hacksQ.data ?? []).length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">No hack incidents on record across your portfolio.</div>
          ) : (
            <div className="divide-y divide-white/[0.04] max-h-[400px] overflow-y-auto">
              {(hacksQ.data ?? []).map((h: any, i: number) => {
                const co = companiesMap.get(h.company_slug);
                return (
                  <Link key={i} to={`/protocol/${h.company_slug}`} className="px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02]">
                    <BrandLogo name={co?.name || h.company_slug} url={co?.url} logo={co?.logo} className="w-8 h-8 rounded-md shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{co?.name || h.company_slug}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                        {h.name || "incident"} · {h.technique || "technique unknown"}
                        {h.returned_funds ? ` · ${compactUsd(Number(h.returned_funds))} returned` : ""}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold tabular-nums text-rose-300">{compactUsd(Number(h.amount_usd))}</div>
                      <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1"><Calendar className="w-2.5 h-2.5" />{h.hack_date ? new Date(h.hack_date).toLocaleDateString() : "—"}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
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
