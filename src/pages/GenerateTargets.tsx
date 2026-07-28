import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Target, ArrowLeft, Sparkles, Crosshair, X, TrendingUp, Banknote, Skull, Bug, ShieldCheck, ArrowRight, ExternalLink, Activity } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { BrandLogo } from "@/components/BrandLogo";
import { RadarScanner } from "@/components/RadarScanner";
import { HexagonScore } from "@/components/HexagonScore";
import { computeSalesAxes, scoreToTone } from "@/lib/hexagonScores";
import { fetchAuditAggregates } from "@/lib/auditAggregates";

type Profile = {
  user_id: string;
  company_name: string | null;
  role: string | null;
  firm_type: string | null;
  specialties: string[] | null;
  focus_categories: string[] | null;
  must_haves: string[] | null;
  disqualifiers: string[] | null;
  min_tvl_usd: number | null;
  existing_client_slugs: string[] | null;
  hide_existing_clients: boolean | null;
  ideal_target_slugs: string[] | null;
  icp_summary: string | null;
};

function compactUsd(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n === 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

type Stage = { label: string; durationMs: number; weight: number };
const STAGES: Stage[] = [
  { label: "Loading your ICP profile", durationMs: 500, weight: 0.05 },
  { label: "Scanning the universe — 7,800 companies", durationMs: 900, weight: 0.18 },
  { label: "Filtering by category & TVL band", durationMs: 700, weight: 0.30 },
  { label: "Cross-referencing recent funding rounds", durationMs: 900, weight: 0.45 },
  { label: "Detecting security hiring momentum", durationMs: 700, weight: 0.58 },
  { label: "Reading audit-gap signals", durationMs: 900, weight: 0.72 },
  { label: "Surfacing hacks + risk events", durationMs: 700, weight: 0.85 },
  { label: "Ranking by deal-fit × signal strength", durationMs: 700, weight: 0.95 },
  { label: "Ready", durationMs: 200, weight: 1.0 },
];

type Target = {
  slug: string; name: string; category: string | null; url: string | null; logo: string | null;
  has_been_hacked: boolean; has_bug_bounty: boolean; last_audit_date: string | null;
  last_audit_firm: string | null; audit_count: number | null; total_raised_usd: number | null;
  tvl: number | null;
  funding: { date: string; amount_usd: number | null; round_type: string | null } | null;
  hiring: { role_count?: number; security_count?: number; smart_contract_count?: number } | null;
  hack: any | null;
  opportunity_score: number; opportunity_reasons: string[];
};

export default function GenerateTargets() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [stage, setStage] = useState(0);
  const [progress, setProgress] = useState(0);
  const [scanning, setScanning] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const profileQ = useQuery({
    queryKey: ["gt-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("user_id,company_name,role,firm_type,specialties,focus_categories,must_haves,disqualifiers,min_tvl_usd,existing_client_slugs,hide_existing_clients,ideal_target_slugs,icp_summary")
        .eq("user_id", user!.id).maybeSingle();
      return data as Profile | null;
    },
  });
  const profile = profileQ.data;

  const universeQ = useQuery({
    queryKey: ["gt-universe"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const out: any[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabase
          .from("companies")
          .select("slug,name,category,url,logo,has_been_hacked,has_bug_bounty,last_audit_date,last_audit_firm,audit_count,total_raised_usd,description")
          .is("parent_slug", null)
          .order("name", { ascending: true })
          .range(from, from + 999);
        if (!data || data.length === 0) break;
        out.push(...data);
        if (data.length < 1000) break;
        from += 1000;
        if (out.length > 10000) break;
      }
      return out;
    },
  });
  const slugs = useMemo(() => (universeQ.data ?? []).map((c: any) => c.slug), [universeQ.data]);

  const enrichQ = useQuery({
    queryKey: ["gt-enrich", slugs.length],
    enabled: slugs.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [tvlRaw, fundingRaw, hiringRaw, hacksRaw] = await Promise.all([
        supabase.from("protocol_metrics").select("company_slug,tvl_usd,date").not("tvl_usd", "is", null).order("date", { ascending: false }).limit(20000),
        supabase.from("funding_rounds").select("company_slug,amount_usd,round_type,date").order("date", { ascending: false, nullsFirst: false }).limit(8000),
        supabase.from("hiring_aggregates").select("company_slug,role_count,smart_contract_count,security_count"),
        supabase.from("hacks").select("company_slug,hack_date,amount_usd,technique").order("hack_date", { ascending: false, nullsFirst: false }).limit(2000),
      ]);
      const tvlMap = new Map<string, number>();
      for (const r of (tvlRaw.data ?? []) as any[]) if (!tvlMap.has(r.company_slug)) tvlMap.set(r.company_slug, Number(r.tvl_usd));
      const fundingMap = new Map<string, any>();
      for (const r of (fundingRaw.data ?? []) as any[]) if (!fundingMap.has(r.company_slug)) fundingMap.set(r.company_slug, r);
      const hiringMap = new Map<string, any>();
      for (const r of (hiringRaw.data ?? []) as any[]) hiringMap.set(r.company_slug, r);
      const hacksMap = new Map<string, any>();
      for (const r of (hacksRaw.data ?? []) as any[]) if (!hacksMap.has(r.company_slug)) hacksMap.set(r.company_slug, r);
      return { tvlMap, fundingMap, hiringMap, hacksMap };
    },
  });

  const savedQ = useQuery({
    queryKey: ["gt-saved", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("saved_targets").select("company_slug,target_kind").eq("user_id", user!.id);
      const s = new Set<string>();
      for (const r of (data ?? []) as any[]) s.add(`${r.target_kind || "company"}::${r.company_slug}`);
      return s;
    },
  });
  const savedSet = savedQ.data ?? new Set<string>();

  // Stage-walk animation runs once on mount. It only animates the radar UI —
  // it does NOT block on data loading (that's done via the derived `scanning`
  // state below, which reacts to live query states without a stale closure).
  const [stagesDone, setStagesDone] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function walk() {
      for (let i = 0; i < STAGES.length; i++) {
        if (cancelled) return;
        setStage(i);
        setProgress(STAGES[i].weight);
        await new Promise((r) => setTimeout(r, STAGES[i].durationMs));
      }
      if (!cancelled) setStagesDone(true);
    }
    walk();
    return () => { cancelled = true; };
  }, []);

  // Live data-readiness signal. Queries are considered "ready" when they're
  // no longer loading — null data (e.g. no profile saved) is still "ready",
  // we just render an empty-state below.
  const dataReady =
    !profileQ.isLoading && !universeQ.isLoading && !enrichQ.isLoading;

  // Effective scanning state — true until animation finishes AND data is ready.
  useEffect(() => {
    if (stagesDone && dataReady) setScanning(false);
  }, [stagesDone, dataReady]);

  // Safety hatch: if something stalls past 30s, force out of the scan view so
  // we at least show what we have rather than spinning indefinitely.
  useEffect(() => {
    const t = setTimeout(() => setScanning(false), 30_000);
    return () => clearTimeout(t);
  }, []);

  const targets: Target[] = useMemo(() => {
    if (!universeQ.data || !enrichQ.data || !profile) return [];
    const profileTokens: string[] = [];
    if (profile.focus_categories) profileTokens.push(...profile.focus_categories.map(s => s.toLowerCase()));
    if (profile.specialties) profileTokens.push(...profile.specialties.map(s => s.toLowerCase()));
    if (profile.must_haves) profileTokens.push(...profile.must_haves.map(s => s.toLowerCase()));
    const disqualifiers = (profile.disqualifiers ?? []).map(s => s.toLowerCase());
    const minTvl = Number(profile.min_tvl_usd ?? 0);
    const hideExisting = profile.hide_existing_clients !== false;
    const existing = new Set((profile.existing_client_slugs ?? []).map(s => s.toLowerCase()));
    const idealTargets = new Set((profile.ideal_target_slugs ?? []).map(s => s.toLowerCase()));

    const rows: Target[] = [];
    for (const c of (universeQ.data as any[])) {
      const tvl = enrichQ.data!.tvlMap.get(c.slug) ?? null;
      const funding = enrichQ.data!.fundingMap.get(c.slug) ?? null;
      const hiring = enrichQ.data!.hiringMap.get(c.slug) ?? null;
      const hack = enrichQ.data!.hacksMap.get(c.slug) ?? null;
      const blob = `${c.name} ${c.category || ""} ${c.description || ""}`.toLowerCase();
      if (disqualifiers.some(d => blob.includes(d))) continue;
      if (hideExisting && existing.has(c.slug.toLowerCase())) continue;
      if (minTvl > 0 && (!tvl || tvl < minTvl)) continue;

      let score = 0;
      const reasons: string[] = [];
      let icpMatched = 0;
      for (const t of profileTokens) { if (t && blob.includes(t)) icpMatched++; }
      if (icpMatched > 0) { score += Math.min(icpMatched * 9, 28); reasons.push(`${icpMatched} ICP keyword match${icpMatched === 1 ? "" : "es"}`); }
      if (idealTargets.has(c.slug.toLowerCase())) { score += 35; reasons.push("on your target list"); }
      if (funding?.date) {
        const days = Math.floor((Date.now() - new Date(funding.date).getTime()) / 86400000);
        if (days < 90) { score += 28; reasons.push(`raised ${compactUsd(funding.amount_usd)} ${days}d ago — budget fresh`); }
        else if (days < 180) { score += 16; reasons.push(`raised ${compactUsd(funding.amount_usd)} ${Math.floor(days / 30)}mo ago`); }
      }
      if (tvl != null) {
        if (tvl >= 100_000_000) { score += 22; reasons.push(`${compactUsd(tvl)} TVL — premium contract size`); }
        else if (tvl >= 10_000_000) { score += 14; reasons.push(`${compactUsd(tvl)} TVL`); }
        else if (tvl >= 1_000_000) { score += 6; reasons.push(`${compactUsd(tvl)} TVL`); }
      }
      if (!c.last_audit_date) { score += 24; reasons.push("never audited"); }
      else {
        const days = Math.floor((Date.now() - new Date(c.last_audit_date).getTime()) / 86400000);
        if (days > 540) { score += 24; reasons.push(`last audit ${Math.floor(days / 30)}mo ago`); }
        else if (days > 365) { score += 16; reasons.push(`last audit ${Math.floor(days / 30)}mo ago`); }
        else if (days > 180) { score += 8; reasons.push(`last audit ${Math.floor(days / 30)}mo ago`); }
      }
      if ((hiring?.security_count ?? 0) > 0) { score += 16; reasons.push(`${hiring.security_count} security role${hiring.security_count > 1 ? "s" : ""} open — active buyer`); }
      if ((hiring?.smart_contract_count ?? 0) >= 3) { score += 10; reasons.push(`${hiring.smart_contract_count} SC eng hiring`); }
      if (c.has_been_hacked || hack) {
        score += 14;
        const text = hack?.hack_date
          ? `hacked ${Math.floor((Date.now() - new Date(hack.hack_date).getTime()) / 86400000)}d ago · ${compactUsd(Number(hack.amount_usd))}`
          : "past hack on record";
        reasons.push(text);
      }
      if (c.has_bug_bounty) { score += 4; reasons.push("already buys bounty"); }

      rows.push({
        slug: c.slug, name: c.name, category: c.category, url: c.url, logo: c.logo,
        has_been_hacked: !!c.has_been_hacked, has_bug_bounty: !!c.has_bug_bounty,
        last_audit_date: c.last_audit_date, last_audit_firm: c.last_audit_firm,
        audit_count: c.audit_count, total_raised_usd: c.total_raised_usd,
        tvl, funding, hiring, hack, opportunity_score: Math.min(100, score),
        opportunity_reasons: reasons,
      });
    }
    return rows.sort((a, b) => b.opportunity_score - a.opportunity_score).slice(0, 24);
  }, [universeQ.data, enrichQ.data, profile]);

  const toggleSave = async (t: Target) => {
    if (!user) return;
    const key = `company::${t.slug}`;
    if (savedSet.has(key)) {
      await supabase.from("saved_targets").delete().eq("user_id", user.id).eq("company_slug", t.slug).eq("target_kind", "company");
    } else {
      await supabase.from("saved_targets").insert({
        user_id: user.id, company_slug: t.slug, company_name: t.name, company_logo: t.logo,
        target_kind: "company", pipeline_stage: "follow", saved_at: new Date().toISOString(),
      });
    }
    qc.invalidateQueries({ queryKey: ["gt-saved", user.id] });
    qc.invalidateQueries({ queryKey: ["saved-targets-set", user.id] });
    qc.invalidateQueries({ queryKey: ["teams-saved", user.id] });
  };

  const dismiss = (slug: string) => setDismissed((s) => new Set(s).add(slug));
  const visibleTargets = targets.filter((t) => !dismissed.has(t.slug));

  // Audit-data-first dimension: fetch per-company audit aggregates (firm rotation,
  // tier-1 coverage, contest count, fix rate) for the top results. Powers the
  // "Audit posture" axis in the hexagon score.
  const auditAggQ = useQuery({
    queryKey: ["gt-audit-agg", visibleTargets.map(t => t.slug).join(",")],
    enabled: visibleTargets.length > 0 && !scanning,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => fetchAuditAggregates(visibleTargets.map(t => t.slug)),
  });

  if (scanning) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center max-w-2xl mx-auto px-4">
        <button onClick={() => navigate(-1)} className="absolute top-4 left-4 text-xs text-muted-foreground hover:text-white inline-flex items-center gap-1">
          <ArrowLeft className="w-3 h-3" /> Cancel
        </button>
        <div className="text-center mb-6">
          <div className="text-[10px] uppercase tracking-[0.2em] text-primary/80 font-bold mb-2">AuditScope · Target Finder</div>
          <h1 className="text-2xl font-bold text-white">Scanning the universe</h1>
          {profile?.company_name && <p className="text-sm text-muted-foreground mt-1">for {profile.company_name}</p>}
        </div>
        <RadarScanner active size={400} progress={progress} />
        <div className="mt-8 text-center w-full max-w-md">
          <div className="text-sm text-white font-medium tabular-nums">{STAGES[stage]?.label || "Scanning"}…</div>
          <div className="mt-3 h-1 rounded-full bg-white/[0.05] overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-500 to-primary transition-all duration-300" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="text-[10px] text-muted-foreground mt-2 tabular-nums">{Math.round(progress * 100)}%</div>
        </div>
        <div className="mt-6 text-[10.5px] text-muted-foreground italic text-center max-w-md">
          Cross-referencing {(universeQ.data ?? []).length.toLocaleString()} companies · {enrichQ.data ? enrichQ.data.fundingMap.size.toLocaleString() : 0} funding events · live hiring + hack signals
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1600px]">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <button onClick={() => navigate("/dashboard")} className="text-xs text-muted-foreground hover:text-white inline-flex items-center gap-1 mb-2">
            <ArrowLeft className="w-3 h-3" /> Dashboard
          </button>
          <h1 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" /> Target Finder · Results
          </h1>
          <p className="text-[11px] text-muted-foreground mt-1">
            {visibleTargets.length} prospects ranked by ICP fit × live buy-signal strength
          </p>
        </div>
        <button onClick={() => { setScanning(true); setStage(0); setProgress(0); setDismissed(new Set()); }} className="text-[11px] px-3 py-1.5 rounded border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary inline-flex items-center gap-1.5">
          <Sparkles className="w-3 h-3" /> Re-scan
        </button>
      </div>

      {/* Result cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {visibleTargets.map((t) => {
          const agg = auditAggQ.data?.get(t.slug);
          const inputs = {
            recent_funding_amount: t.funding?.amount_usd ?? null,
            recent_funding_days_ago: t.funding?.date ? Math.floor((Date.now() - new Date(t.funding.date).getTime()) / 86400000) : null,
            last_audit_ago_days: t.last_audit_date ? Math.floor((Date.now() - new Date(t.last_audit_date).getTime()) / 86400000) : null,
            audit_count: agg?.audit_count ?? t.audit_count ?? 0,
            audit_firms_used_count: agg?.firms_used ?? null,
            tier1_audit_count: agg?.tier1_count ?? null,
            contest_count: agg?.contest_count ?? null,
            fix_rate: agg?.fix_rate ?? null,
            tvl_usd: t.tvl,
            total_raised_usd: t.total_raised_usd,
            security_hires: t.hiring?.security_count ?? null,
            smart_contract_hires: t.hiring?.smart_contract_count ?? null,
            has_been_hacked: t.has_been_hacked,
            open_critical: 0,
            recent_anomaly_z: null,
            icp_fit_score: Math.min(t.opportunity_score, 100),
          };
          const { axes, composite } = computeSalesAxes(inputs);
          const tone = scoreToTone(composite);
          const isSaved = savedSet.has(`company::${t.slug}`);
          return (
            <div key={t.slug} className="as-card p-4 flex flex-col gap-3 relative">
              <button onClick={() => dismiss(t.slug)} className="absolute top-2 right-2 text-muted-foreground/40 hover:text-rose-400 transition-colors" title="Dismiss">
                <X className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-start gap-3">
                <BrandLogo name={t.name} url={t.url} logo={t.logo} className="w-10 h-10 rounded-md shrink-0" />
                <div className="flex-1 min-w-0">
                  <Link to={`/protocol/${t.slug}`} className="text-sm font-semibold text-white hover:text-primary truncate inline-block">{t.name}</Link>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {t.category && <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground bg-white/[0.04] px-1.5 py-0.5 rounded">{t.category}</span>}
                    {t.has_bug_bounty && <Bug className="w-3 h-3 text-emerald-300" />}
                    {t.has_been_hacked && <Skull className="w-3 h-3 text-rose-400" />}
                  </div>
                </div>
                <div className={`text-base font-bold tabular-nums px-2 py-1 rounded ${tone === "strong" ? "text-emerald-200 bg-emerald-500/15" : tone === "solid" ? "text-sky-200 bg-sky-500/15" : tone === "concerning" ? "text-amber-200 bg-amber-500/15" : tone === "weak" ? "text-orange-200 bg-orange-500/15" : "text-rose-200 bg-rose-500/15"}`}>
                  {composite}
                </div>
              </div>

              <div className="flex justify-center">
                <HexagonScore axes={axes as any} centerLabel="Opp." centerValue={composite} centerTone={tone} size={200} variant="sales" />
              </div>

              <div className="space-y-1">
                <div className="text-[9.5px] uppercase tracking-[0.1em] font-bold text-muted-foreground">Why it fits</div>
                <div className="flex flex-wrap gap-1">
                  {t.opportunity_reasons.slice(0, 5).map((r, i) => (
                    <span key={i} className="text-[10.5px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-200 border border-amber-500/20">{r}</span>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-white/[0.04] mt-auto">
                <button
                  onClick={() => toggleSave(t)}
                  className={`flex-1 text-[11px] px-2.5 py-1.5 rounded border inline-flex items-center justify-center gap-1.5 transition-colors ${isSaved ? "border-primary/40 bg-primary/15 text-primary ring-1 ring-primary/40" : "border-white/[0.08] hover:border-primary/40 hover:bg-primary/[0.05] text-white"}`}
                >
                  <Crosshair className="w-3 h-3" /> {isSaved ? "Saved" : "Save target"}
                </button>
                <Link to={`/protocol/${t.slug}`} className="text-[11px] px-2.5 py-1.5 rounded border border-white/[0.08] hover:border-primary/40 hover:bg-white/[0.03] text-muted-foreground hover:text-white inline-flex items-center gap-1">
                  Open <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {visibleTargets.length === 0 && (
        <div className="as-card p-12 text-center">
          <div className="text-sm text-muted-foreground mb-3">No targets matched your ICP.</div>
          <Link to="/profile" className="text-xs text-primary hover:underline">Tune your profile →</Link>
        </div>
      )}
    </div>
  );
}
