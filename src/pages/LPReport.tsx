import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { FileText, Printer, Download, ShieldCheck, AlertTriangle, TrendingUp, Skull, Activity, Bug } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";
import { useAuth } from "@/hooks/useAuth";

function compactUsd(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n === 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function quarter(d: Date): string {
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

export default function LPReport() {
  const { user } = useAuth();
  const now = new Date();
  const q = quarter(now);

  const profileQ = useQuery({
    queryKey: ["lp-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("fund_slug,company_name")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data as { fund_slug: string | null; company_name: string | null } | null;
    },
  });

  const fundSlug = profileQ.data?.fund_slug ?? null;
  const fundName = profileQ.data?.company_name ?? null;

  const fundDetails = useQuery({
    queryKey: ["lp-fund", fundSlug],
    enabled: !!fundSlug,
    queryFn: async () => {
      const { data } = await supabase.from("funds").select("name,description,website").eq("slug", fundSlug!).maybeSingle();
      return data as any;
    },
  });

  const portfolioQ = useQuery({
    queryKey: ["lp-portfolio", fundSlug],
    enabled: !!fundSlug,
    queryFn: async () => {
      const { data } = await supabase
        .from("fund_portfolio")
        .select("company_slug,company_name,category,round_type,amount_usd,round_date")
        .eq("fund_slug", fundSlug!);
      return (data ?? []) as any[];
    },
  });

  const positions = portfolioQ.data ?? [];
  const slugs = useMemo(() => Array.from(new Set(positions.map(p => p.company_slug))), [positions]);

  const enrichQ = useQuery({
    queryKey: ["lp-enrich", slugs.length],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const [comp, risk, tvl, findings, hacks] = await Promise.all([
        supabase.from("companies").select("slug,name,category,url,logo,has_been_hacked,has_bug_bounty,last_audit_date,last_audit_firm").in("slug", slugs),
        supabase.from("protocol_risk_scores").select("company_slug,composite_score,band").in("company_slug", slugs),
        supabase.from("protocol_metrics").select("company_slug,tvl,date").in("company_slug", slugs).not("tvl", "is", null).order("date", { ascending: false }).limit(3000),
        supabase.from("audit_history").select("company_slug,findings_critical,findings_high").in("company_slug", slugs).eq("findings_extraction_status", "extracted"),
        supabase.from("hacks").select("company_slug,name,hack_date,amount_usd").in("company_slug", slugs).order("hack_date", { ascending: false }),
      ]);
      const compMap = new Map<string, any>();
      for (const c of (comp.data ?? []) as any[]) compMap.set(c.slug, c);
      const riskMap = new Map<string, any>();
      for (const r of (risk.data ?? []) as any[]) riskMap.set(r.company_slug, r);
      const tvlMap = new Map<string, number>();
      for (const r of (tvl.data ?? []) as any[]) if (!tvlMap.has(r.company_slug)) tvlMap.set(r.company_slug, Number(r.tvl));
      const findMap = new Map<string, { critical: number; high: number }>();
      for (const f of (findings.data ?? []) as any[]) {
        const e = findMap.get(f.company_slug) ?? { critical: 0, high: 0 };
        e.critical += f.findings_critical || 0;
        e.high += f.findings_high || 0;
        findMap.set(f.company_slug, e);
      }
      const hackList = (hacks.data ?? []) as any[];
      return { compMap, riskMap, tvlMap, findMap, hackList };
    },
  });

  const summary = useMemo(() => {
    if (!enrichQ.data) return null;
    const { compMap, riskMap, tvlMap, findMap, hackList } = enrichQ.data;
    const rows = positions.map((p) => {
      const c = compMap.get(p.company_slug);
      const r = riskMap.get(p.company_slug);
      const f = findMap.get(p.company_slug);
      const tvl = tvlMap.get(p.company_slug);
      return {
        slug: p.company_slug,
        name: c?.name || p.company_name,
        category: c?.category || p.category,
        url: c?.url, logo: c?.logo,
        has_hacked: !!c?.has_been_hacked, has_bounty: !!c?.has_bug_bounty,
        last_audit_date: c?.last_audit_date, last_audit_firm: c?.last_audit_firm,
        tvl, score: r?.composite_score ?? null, band: r?.band ?? null,
        critical: f?.critical ?? 0, high: f?.high ?? 0,
        round_type: p.round_type, amount_usd: Number(p.amount_usd) || 0, round_date: p.round_date,
      };
    });
    const totalPositions = rows.length;
    let bandsCrit = 0, bandsHigh = 0, bandsLow = 0;
    let hacked = 0, bounty = 0, withAudit = 0, totalCriticals = 0, totalHighs = 0;
    let totalTvl = 0;
    for (const r of rows) {
      if (r.band === "critical") bandsCrit++;
      else if (r.band === "high") bandsHigh++;
      else if (r.band === "low") bandsLow++;
      if (r.has_hacked) hacked++;
      if (r.has_bounty) bounty++;
      if (r.last_audit_date) withAudit++;
      totalCriticals += r.critical;
      totalHighs += r.high;
      totalTvl += r.tvl ?? 0;
    }
    const sectors = new Map<string, number>();
    for (const r of rows) sectors.set(r.category || "Uncategorized", (sectors.get(r.category || "Uncategorized") ?? 0) + 1);
    const sectorList = Array.from(sectors.entries()).sort((a, b) => b[1] - a[1]);
    return {
      rows, totalPositions, bandsCrit, bandsHigh, bandsLow, hacked, bounty, withAudit,
      totalCriticals, totalHighs, totalTvl, sectorList, hackList,
    };
  }, [enrichQ.data, positions]);

  const onPrint = () => window.print();
  const onCsv = () => {
    if (!summary) return;
    const header = ["slug", "name", "category", "tvl", "risk_score", "band", "critical", "high", "last_audit_firm", "last_audit_date", "hacked", "bounty"];
    const rows = summary.rows.map((r) => [
      r.slug, r.name, r.category || "", r.tvl ?? "", r.score ?? "", r.band ?? "",
      r.critical, r.high, r.last_audit_firm ?? "", r.last_audit_date ?? "",
      r.has_hacked ? "yes" : "", r.has_bounty ? "yes" : "",
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lp-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!fundSlug) {
    return (
      <div className="as-card p-12 text-center max-w-2xl">
        <FileText className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
        <h3 className="text-base font-semibold text-white">No fund selected</h3>
        <p className="text-sm text-muted-foreground mt-1">Set your fund in <Link to="/profile" className="text-primary hover:underline">Profile</Link> to generate an LP report.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-[1100px] mx-auto print:max-w-none">
      {/* Toolbar — hidden on print */}
      <div className="as-card p-4 print:hidden">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <FileText className="w-4 h-4 text-primary" />
            <h1 className="text-sm font-semibold text-white">Auto LP report · {q}</h1>
            <span className="text-[11px] text-muted-foreground">— shareable portfolio brief</span>
          </div>
          <button onClick={onCsv} className="text-xs px-3 py-1.5 rounded border border-white/[0.08] hover:bg-white/[0.03] inline-flex items-center gap-1">
            <Download className="w-3 h-3" /> CSV
          </button>
          <button onClick={onPrint} className="text-xs px-3 py-1.5 rounded bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 inline-flex items-center gap-1">
            <Printer className="w-3 h-3" /> Print / PDF
          </button>
        </div>
      </div>

      {/* Document */}
      <div className="as-card p-10 print:p-0 print:border-0 print:shadow-none space-y-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] pb-6">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-primary font-bold">Quarterly portfolio brief</div>
            <h1 className="text-3xl font-bold text-white mt-2">{fundDetails.data?.name || fundName || "Your Fund"}</h1>
            <div className="text-[13px] text-muted-foreground mt-1">{q} · {now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
            {fundDetails.data?.description && (
              <p className="text-[12.5px] text-muted-foreground mt-3 max-w-2xl leading-relaxed">{fundDetails.data.description}</p>
            )}
          </div>
          <div className="text-right shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
            Generated by<br /><span className="text-primary font-bold">AuditScope</span>
          </div>
        </div>

        {summary && (
          <>
            {/* Executive summary */}
            <section>
              <div className="text-[11px] uppercase tracking-[0.12em] text-primary font-bold mb-3">Executive summary</div>
              <p className="text-[14px] text-white/90 leading-relaxed">
                {summary.totalPositions} active positions across {summary.sectorList.length} sectors{summary.totalTvl > 0 ? ` with ${compactUsd(summary.totalTvl)} aggregate TVL exposure` : ""}.{" "}
                {summary.bandsCrit + summary.bandsHigh > 0
                  ? <><span className="text-rose-300 font-medium">{summary.bandsCrit + summary.bandsHigh} positions ({Math.round((summary.bandsCrit + summary.bandsHigh) / summary.totalPositions * 100)}%)</span> are flagged at elevated operational risk and warrant near-term attention.</>
                  : <>Risk posture is within acceptable bounds, with no elevated-risk positions in the book.</>
                }{" "}
                {summary.totalCriticals > 0
                  ? <><span className="text-rose-300 font-medium">{summary.totalCriticals} unresolved critical audit findings</span> are tracked across <span className="font-medium">{summary.rows.filter(r => r.critical > 0).length}</span> protocols.</>
                  : <>No critical audit findings are currently outstanding in the book.</>
                }{" "}
                {summary.hacked > 0
                  ? <>Historical hack exposure: <span className="text-rose-300">{summary.hacked} position{summary.hacked === 1 ? "" : "s"}</span> with prior incidents.</>
                  : <>No portfolio company has been hacked historically.</>
                }
              </p>
            </section>

            {/* KPIs */}
            <section>
              <div className="text-[11px] uppercase tracking-[0.12em] text-primary font-bold mb-3">Key metrics</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KPI label="Positions" value={summary.totalPositions.toString()} />
                <KPI label="Portfolio TVL" value={compactUsd(summary.totalTvl)} />
                <KPI label="Elevated risk" value={(summary.bandsCrit + summary.bandsHigh).toString()} sub={`${summary.bandsCrit} crit · ${summary.bandsHigh} high`} tone={(summary.bandsCrit + summary.bandsHigh) > 0 ? "alert" : "good"} />
                <KPI label="Open criticals" value={summary.totalCriticals.toString()} sub={`${summary.totalHighs} highs`} tone={summary.totalCriticals > 0 ? "alert" : "good"} />
                <KPI label="Audited %" value={`${Math.round(summary.withAudit / Math.max(summary.totalPositions, 1) * 100)}%`} sub={`${summary.withAudit}/${summary.totalPositions}`} tone="neutral" />
                <KPI label="Bug bounty %" value={`${Math.round(summary.bounty / Math.max(summary.totalPositions, 1) * 100)}%`} sub={`${summary.bounty}/${summary.totalPositions}`} tone="neutral" />
                <KPI label="Hacked %" value={`${Math.round(summary.hacked / Math.max(summary.totalPositions, 1) * 100)}%`} sub={`${summary.hacked} historic`} tone={summary.hacked > 0 ? "warn" : "good"} />
                <KPI label="Low risk" value={summary.bandsLow.toString()} sub="positions" tone="good" />
              </div>
            </section>

            {/* Sector tilt */}
            <section>
              <div className="text-[11px] uppercase tracking-[0.12em] text-primary font-bold mb-3">Sector composition</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {summary.sectorList.map(([cat, n]) => {
                  const pct = (n / summary.totalPositions) * 100;
                  return (
                    <div key={cat} className="rounded-md border border-white/[0.06] p-3 bg-white/[0.02]">
                      <div className="text-[11px] text-muted-foreground">{cat}</div>
                      <div className="text-lg font-bold tabular-nums text-white mt-1">{n}</div>
                      <div className="h-1 bg-white/[0.05] rounded mt-1.5 overflow-hidden"><div className="h-full bg-primary/60" style={{ width: `${pct}%` }} /></div>
                      <div className="text-[10px] text-muted-foreground mt-1">{pct.toFixed(0)}%</div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Risk register */}
            <section>
              <div className="text-[11px] uppercase tracking-[0.12em] text-primary font-bold mb-3">Risk register — every position</div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-white/[0.1]">
                    <th className="py-2 pr-3">Protocol</th>
                    <th className="py-2 pr-3">Sector</th>
                    <th className="py-2 pr-3 text-right">TVL</th>
                    <th className="py-2 pr-3 text-center">Risk</th>
                    <th className="py-2 pr-3 text-center">Findings</th>
                    <th className="py-2 pr-3">Last audit</th>
                    <th className="py-2 text-center">Posture</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).map((r) => (
                    <tr key={r.slug} className="border-b border-white/[0.04]">
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <BrandLogo name={r.name} url={r.url} logo={r.logo} className="w-5 h-5 rounded shrink-0" />
                          <span className="text-white">{r.name}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{r.category || "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{compactUsd(r.tvl)}</td>
                      <td className="py-2 pr-3 text-center">
                        {r.score != null ? (
                          <span className={`inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${
                            r.band === "critical" ? "bg-rose-500/20 text-rose-200 border-rose-500/40" :
                            r.band === "high" ? "bg-orange-500/15 text-orange-200 border-orange-500/40" :
                            r.band === "medium" ? "bg-amber-500/15 text-amber-200 border-amber-500/30" :
                            "bg-emerald-500/15 text-emerald-200 border-emerald-500/30"
                          }`}>{r.score} · {r.band}</span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2 pr-3 text-center text-[11px]">
                        {r.critical + r.high === 0 ? <span className="text-muted-foreground/40">—</span> : (
                          <span className="font-bold">
                            {r.critical > 0 && <span className="text-rose-300">{r.critical}C </span>}
                            {r.high > 0 && <span className="text-orange-300">{r.high}H</span>}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-[11px]">
                        {r.last_audit_firm ? (
                          <span className="text-white/85">{r.last_audit_firm} <span className="text-muted-foreground">· {r.last_audit_date}</span></span>
                        ) : <span className="text-rose-300">no audit</span>}
                      </td>
                      <td className="py-2 text-center">
                        <span className="inline-flex items-center gap-1 text-[10px]">
                          {r.has_bounty && <Bug className="w-3 h-3 text-emerald-400" />}
                          {r.has_hacked && <Skull className="w-3 h-3 text-rose-400" />}
                          {!r.has_bounty && !r.has_hacked && <span className="text-muted-foreground/40">clean</span>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* Quarterly events / hack history */}
            {summary.hackList.length > 0 && (
              <section>
                <div className="text-[11px] uppercase tracking-[0.12em] text-primary font-bold mb-3 flex items-center gap-2">
                  <Skull className="w-3.5 h-3.5 text-rose-300" /> Historical hack exposure
                </div>
                <div className="space-y-2">
                  {summary.hackList.slice(0, 8).map((h: any, i: number) => (
                    <div key={i} className="text-[13px] flex items-baseline justify-between border-b border-white/[0.04] pb-2">
                      <div>
                        <span className="font-medium text-white">{h.name || "Incident"}</span>{" "}
                        <span className="text-muted-foreground text-[11px]">· {h.hack_date}</span>
                      </div>
                      <span className="tabular-nums font-bold text-rose-300">{compactUsd(Number(h.amount_usd))}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Methodology footer */}
            <section className="text-[10px] text-muted-foreground border-t border-white/[0.06] pt-4">
              <div className="font-bold text-muted-foreground/80 uppercase tracking-wider mb-1">Methodology</div>
              <p className="leading-relaxed">
                Risk scores are computed nightly from audit posture (cadence, findings, firm diversity), on-chain activity (TVL trajectory, anomalies, contract upgradability),
                team activity (hiring momentum, GitHub commits), funding signals, and sentiment. Open findings are AI-extracted from public audit reports. TVL via DefiLlama.
                Hack history via DefiLlama. News via Exa.ai. Audit corpus combines GitHub repos, Cantina, Sherlock, Code4rena, and direct firm scrapes.
              </p>
            </section>
          </>
        )}
      </div>

      <style>{`
        @media print {
          body { background: white !important; color: black; }
          .as-card { background: white !important; border: none !important; box-shadow: none !important; }
        }
      `}</style>
    </div>
  );
}

function KPI({ label, value, sub, tone = "neutral" }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "alert" | "neutral" }) {
  const cls = ({
    good: "border-emerald-500/25 bg-emerald-500/[0.04] text-emerald-200",
    warn: "border-amber-500/30 bg-amber-500/[0.05] text-amber-200",
    alert: "border-rose-500/30 bg-rose-500/[0.06] text-rose-200",
    neutral: "border-white/[0.08] bg-white/[0.02] text-white",
  } as Record<string, string>)[tone];
  return (
    <div className={`rounded-md border px-3 py-2.5 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-[22px] font-bold tabular-nums mt-1">{value}</div>
      {sub && <div className="text-[10px] opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}
