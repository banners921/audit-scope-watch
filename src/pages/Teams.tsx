import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Target, TrendingUp, ShieldCheck, AlertTriangle, Banknote, Briefcase, Skull, Bug,
  ArrowRight, Sparkles, Search, Filter, Bookmark, Crosshair, Bell, Building2,
  Activity, Newspaper, Calendar, Dot, Users, Flame, DollarSign, ExternalLink, ChevronDown,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";
import { useAuth } from "@/hooks/useAuth";
import { HexagonScore } from "@/components/HexagonScore";
import { computeSalesAxes, scoreToTone } from "@/lib/hexagonScores";
import { fetchAuditAggregates } from "@/lib/auditAggregates";

function compactUsd(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n === 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function tightAgo(d: string | null | undefined): string {
  if (!d) return "—";
  const ms = Date.now() - new Date(d).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

type Profile = {
  user_id: string;
  company_name: string | null;
  firm_type: string | null;
  specialties: string[] | null;
  focus_categories: string[] | null;
  must_haves: string[] | null;
  disqualifiers: string[] | null;
  min_tvl_usd: number | null;
  existing_client_slugs: string[] | null;
  hide_existing_clients: boolean | null;
  ideal_target_slugs: string[] | null;
  sells_what: string | null;
  value_prop: string | null;
  icp_summary: string | null;
};

type Tab = "suggested" | "companies" | "firms" | "saved";

type Props = { dashboardMode?: boolean };

export default function Teams({ dashboardMode = false }: Props = {}) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const profileQ = useQuery({
    queryKey: ["teams-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("user_id,company_name,firm_type,specialties,focus_categories,must_haves,disqualifiers,min_tvl_usd,existing_client_slugs,hide_existing_clients,ideal_target_slugs,sells_what,value_prop,icp_summary")
        .eq("user_id", user!.id).maybeSingle();
      return data as Profile | null;
    },
  });
  const profile = profileQ.data;

  // ALL companies (broad universe — we'll rank client-side using profile)
  const universeQ = useQuery({
    queryKey: ["teams-universe"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const out: any[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabase
          .from("companies")
          .select("slug,name,category,url,logo,has_been_hacked,has_bug_bounty,last_audit_date,last_audit_firm,audit_count,unique_auditor_count,total_raised_usd,description")
          .order("name", { ascending: true })
          .range(from, from + 999);
        if (!data || data.length === 0) break;
        out.push(...data);
        if (data.length < 1000) break;
        from += 1000;
        if (out.length > 10000) break;
      }
      return out as any[];
    },
  });

  // Enrich with risk + economic data
  const slugs = useMemo(() => (universeQ.data ?? []).map((c) => c.slug), [universeQ.data]);
  const enrichQ = useQuery({
    queryKey: ["teams-enrich", slugs.length],
    enabled: slugs.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // Use Coinbase-style aggregate: latest tvl, recent funding, hiring
      const [tvlRaw, fundingRaw, hiringRaw, hacksRaw] = await Promise.all([
        supabase.from("protocol_metrics").select("company_slug,tvl_usd,date").not("tvl_usd","is",null).order("date",{ascending:false}).limit(20000),
        supabase.from("funding_rounds").select("company_slug,amount_usd,round_type,date").order("date",{ascending:false,nullsFirst:false}).limit(8000),
        supabase.from("hiring_aggregates").select("company_slug,role_count,smart_contract_count,security_count"),
        supabase.from("hacks").select("company_slug,hack_date,amount_usd,technique").order("hack_date",{ascending:false,nullsFirst:false}).limit(2000),
      ]);
      const tvlMap = new Map<string, number>();
      for (const r of (tvlRaw.data ?? []) as any[]) if (!tvlMap.has(r.company_slug)) tvlMap.set(r.company_slug, Number(r.tvl_usd));
      const fundingMap = new Map<string, { date: string; amount_usd: number | null; round_type: string | null }>();
      for (const r of (fundingRaw.data ?? []) as any[]) if (!fundingMap.has(r.company_slug)) fundingMap.set(r.company_slug, { date: r.date, amount_usd: Number(r.amount_usd) || null, round_type: r.round_type });
      const hiringMap = new Map<string, any>();
      for (const r of (hiringRaw.data ?? []) as any[]) hiringMap.set(r.company_slug, r);
      const hacksMap = new Map<string, any>();
      for (const r of (hacksRaw.data ?? []) as any[]) if (!hacksMap.has(r.company_slug)) hacksMap.set(r.company_slug, r);
      return { tvlMap, fundingMap, hiringMap, hacksMap };
    },
  });

  // Saved targets
  const savedQ = useQuery({
    queryKey: ["teams-saved", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("saved_targets")
        .select("id,company_slug,company_name,company_logo,target_kind,pipeline_stage,saved_at,notes,last_signal_at")
        .eq("user_id", user!.id).order("saved_at", { ascending: false });
      return (data ?? []) as any[];
    },
  });
  const savedSet = useMemo(() => new Set((savedQ.data ?? []).map((s: any) => `${s.target_kind || 'company'}::${s.company_slug}`)), [savedQ.data]);

  // Audit firms (for "firms" tab)
  const firmsQ = useQuery({
    queryKey: ["teams-firms"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const all: Array<{ audit_firm: string; company_slug: string; audit_date: string | null }> = [];
      let from = 0;
      while (true) {
        const { data } = await supabase.from("audit_history").select("audit_firm,company_slug,audit_date").not("audit_firm","is",null).range(from, from + 999);
        if (!data || data.length === 0) break;
        all.push(...(data as any));
        if (data.length < 1000) break;
        from += 1000;
        if (from > 20000) break;
      }
      const m = new Map<string, { firm: string; clients: Set<string>; audits: number; latest: string | null }>();
      for (const r of all) {
        const f = (r.audit_firm || "").trim(); if (!f) continue;
        const e = m.get(f) ?? { firm: f, clients: new Set(), audits: 0, latest: null };
        e.clients.add(r.company_slug); e.audits++;
        if (r.audit_date && (!e.latest || r.audit_date > e.latest)) e.latest = r.audit_date;
        m.set(f, e);
      }
      return Array.from(m.values()).map(v => ({ firm: v.firm, clients: v.clients.size, audits: v.audits, latest: v.latest }));
    },
  });

  // Live signals (last 7d) — recent hacks, audits, funding, anomalies
  const signalsQ = useQuery({
    queryKey: ["teams-signals"],
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const [hacks, audits, funding] = await Promise.all([
        supabase.from("hacks").select("company_slug,name,hack_date,amount_usd,technique").gte("hack_date", since).order("hack_date",{ascending:false}).limit(40),
        supabase.from("audit_history").select("company_slug,audit_firm,audit_date,report_url").gte("audit_date", since).order("audit_date",{ascending:false}).limit(40),
        supabase.from("funding_rounds").select("company_slug,amount_usd,round_type,date").gte("date", since).order("date",{ascending:false}).limit(40),
      ]);
      const items: Array<{ kind: string; ts: string; slug: string; title: string; sub: string; sev: "alert" | "warn" | "info"; url?: string | null }> = [];
      for (const h of (hacks.data ?? []) as any[]) items.push({ kind: "hack", ts: h.hack_date, slug: h.company_slug, title: `Hack · ${compactUsd(Number(h.amount_usd))}`, sub: h.technique || h.name || "incident", sev: "alert" });
      for (const a of (audits.data ?? []) as any[]) items.push({ kind: "audit", ts: a.audit_date, slug: a.company_slug, title: `New audit · ${a.audit_firm}`, sub: a.report_url ? "report published" : "completed", sev: "info", url: a.report_url });
      for (const f of (funding.data ?? []) as any[]) items.push({ kind: "raise", ts: f.date, slug: f.company_slug, title: `Raised ${compactUsd(Number(f.amount_usd))} · ${f.round_type || "round"}`, sub: "fresh budget", sev: "warn" });
      return items.sort((a, b) => (b.ts > a.ts ? 1 : -1)).slice(0, 60);
    },
  });

  // Toggle save
  const toggleSave = async (slug: string, kind: "company" | "firm", name?: string, logo?: string | null) => {
    if (!user) return;
    const key = `${kind}::${slug}`;
    if (savedSet.has(key)) {
      await supabase.from("saved_targets").delete().eq("user_id", user.id).eq("company_slug", slug).eq("target_kind", kind);
    } else {
      await supabase.from("saved_targets").insert({ user_id: user.id, company_slug: slug, company_name: name || slug, company_logo: logo || null, target_kind: kind, pipeline_stage: "follow", saved_at: new Date().toISOString() });
    }
    qc.invalidateQueries({ queryKey: ["teams-saved", user.id] });
  };

  // ---- Scoring algorithm ----
  // Hot lead = recent funding + audit gap + (matches user's focus_categories / specialties) + TVL above min_tvl
  const scoredCompanies = useMemo(() => {
    if (!universeQ.data || !enrichQ.data) return [] as any[];
    const profileTokens: string[] = [];
    if (profile?.focus_categories) profileTokens.push(...profile.focus_categories.map(s => s.toLowerCase()));
    if (profile?.specialties) profileTokens.push(...profile.specialties.map(s => s.toLowerCase()));
    if (profile?.must_haves) profileTokens.push(...profile.must_haves.map(s => s.toLowerCase()));
    const disqualifiers = (profile?.disqualifiers ?? []).map(s => s.toLowerCase());
    const minTvl = Number(profile?.min_tvl_usd ?? 0);
    const hideExisting = profile?.hide_existing_clients !== false;
    const existing = new Set((profile?.existing_client_slugs ?? []).map(s => s.toLowerCase()));
    const idealTargets = new Set((profile?.ideal_target_slugs ?? []).map(s => s.toLowerCase()));

    const rows = universeQ.data.map((c: any) => {
      const tvl = enrichQ.data!.tvlMap.get(c.slug) ?? null;
      const funding = enrichQ.data!.fundingMap.get(c.slug) ?? null;
      const hiring = enrichQ.data!.hiringMap.get(c.slug) ?? null;
      const hack = enrichQ.data!.hacksMap.get(c.slug) ?? null;

      // Filter out disqualifiers + existing clients
      const blob = `${c.name} ${c.category || ""} ${c.description || ""}`.toLowerCase();
      if (disqualifiers.some(d => blob.includes(d))) return null;
      if (hideExisting && existing.has(c.slug.toLowerCase())) return null;

      let score = 0;
      const reasons: string[] = [];

      // 1. ICP match (categories / specialties)
      let matched = 0;
      for (const t of profileTokens) {
        if (!t) continue;
        if (blob.includes(t)) { matched++; }
      }
      if (matched > 0) { score += Math.min(matched * 8, 24); reasons.push(`ICP fit (${matched} keyword match)`); }

      // 2. Ideal target preset
      if (idealTargets.has(c.slug.toLowerCase())) { score += 30; reasons.push("on your target list"); }

      // 3. Min TVL gate
      if (minTvl > 0 && (!tvl || tvl < minTvl)) return null;

      // 4. Recent funding = budget unlocked (huge buying signal)
      if (funding?.date) {
        const days = Math.floor((Date.now() - new Date(funding.date).getTime()) / 86400000);
        if (days < 90) { score += 25; reasons.push(`raised ${compactUsd(funding.amount_usd)} ${days}d ago`); }
        else if (days < 180) { score += 15; reasons.push(`raised ${compactUsd(funding.amount_usd)} ${Math.floor(days/30)}mo ago`); }
      }

      // 5. TVL signal — bigger = bigger contract
      if (tvl != null) {
        if (tvl >= 100_000_000) { score += 20; reasons.push(`${compactUsd(tvl)} TVL`); }
        else if (tvl >= 10_000_000) { score += 12; reasons.push(`${compactUsd(tvl)} TVL`); }
        else if (tvl >= 1_000_000) { score += 5; reasons.push(`${compactUsd(tvl)} TVL`); }
      }

      // 6. Audit gap
      if (!c.last_audit_date) {
        score += 22; reasons.push("no audit on file");
      } else {
        const days = Math.floor((Date.now() - new Date(c.last_audit_date).getTime()) / 86400000);
        if (days > 540) { score += 22; reasons.push(`last audit ${Math.floor(days/30)}mo ago`); }
        else if (days > 365) { score += 15; reasons.push(`last audit ${Math.floor(days/30)}mo ago`); }
        else if (days > 180) { score += 8; reasons.push(`last audit ${Math.floor(days/30)}mo ago`); }
      }

      // 7. Security hiring = active buying signal
      if (hiring?.security_count > 0) { score += 14; reasons.push(`${hiring.security_count} sec role open`); }
      if (hiring?.smart_contract_count >= 3) { score += 8; reasons.push(`${hiring.smart_contract_count} SC eng hiring`); }

      // 8. Past hack = wants better security
      if (c.has_been_hacked || hack) {
        score += 12;
        const hackText = hack?.hack_date ? `hacked ${tightAgo(hack.hack_date)} (${compactUsd(Number(hack.amount_usd))})` : "past hack on record";
        reasons.push(hackText);
      }

      // 9. Bounty already exists = active security buyer (positive signal, slight boost)
      if (c.has_bug_bounty) { score += 4; reasons.push("active bounty (security-conscious)"); }

      // 10. Multi-firm audited = already buys audits = warm-but-loyal
      if ((c.unique_auditor_count ?? 0) >= 2) { score += 3; }

      return { ...c, tvl, funding, hiring, hack, opportunity_score: score, opportunity_reasons: reasons };
    }).filter(Boolean) as any[];

    return rows.sort((a, b) => b.opportunity_score - a.opportunity_score);
  }, [universeQ.data, enrichQ.data, profile]);

  // ---- UI state ----
  const [tab, setTab] = useState<Tab>(dashboardMode ? "saved" : "suggested");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [minTvlFilter, setMinTvlFilter] = useState<number>(0);
  const [auditGapFilter, setAuditGapFilter] = useState<number>(0); // months
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [icpOpen, setIcpOpen] = useState(false);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const c of (universeQ.data ?? [])) if (c.category) s.add(c.category);
    return Array.from(s).sort();
  }, [universeQ.data]);

  // Audit-data-first dim: fetch firm rotation + tier-1 + contests + fix rate
  // for the visible top-N. Powers the "Audit posture" hexagon axis.
  const topVisibleSlugs = useMemo(
    () => scoredCompanies.slice(0, 100).map(p => p.slug),
    [scoredCompanies],
  );
  const auditAggQ = useQuery({
    queryKey: ["teams-audit-agg", topVisibleSlugs.join(",")],
    enabled: topVisibleSlugs.length > 0,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => fetchAuditAggregates(topVisibleSlugs),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = tab === "suggested" ? scoredCompanies.filter(p => p.opportunity_score >= 25) : (universeQ.data ?? []).map((c: any) => ({ ...c, tvl: enrichQ.data?.tvlMap.get(c.slug) ?? null, funding: enrichQ.data?.fundingMap.get(c.slug) ?? null, hiring: enrichQ.data?.hiringMap.get(c.slug) ?? null, opportunity_score: scoredCompanies.find(s => s.slug === c.slug)?.opportunity_score ?? 0, opportunity_reasons: scoredCompanies.find(s => s.slug === c.slug)?.opportunity_reasons ?? [] }));
    if (q) list = list.filter((p: any) => p.name.toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q));
    if (categoryFilter) list = list.filter((p: any) => p.category === categoryFilter);
    if (minTvlFilter > 0) list = list.filter((p: any) => p.tvl && p.tvl >= minTvlFilter);
    if (auditGapFilter > 0) {
      list = list.filter((p: any) => {
        if (!p.last_audit_date) return true;
        const days = Math.floor((Date.now() - new Date(p.last_audit_date).getTime()) / 86400000);
        return days >= auditGapFilter * 30;
      });
    }
    return list;
  }, [tab, scoredCompanies, universeQ.data, enrichQ.data, search, categoryFilter, minTvlFilter, auditGapFilter]);

  const filteredFirms = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (firmsQ.data ?? []).filter(f => !q || f.firm.toLowerCase().includes(q)).sort((a, b) => b.clients - a.clients);
  }, [firmsQ.data, search]);

  const savedRows = useMemo(() => (savedQ.data ?? []), [savedQ.data]);

  // Hot count + new signals
  const hotCount = useMemo(() => scoredCompanies.filter(p => p.opportunity_score >= 60).length, [scoredCompanies]);
  const warmCount = useMemo(() => scoredCompanies.filter(p => p.opportunity_score >= 40 && p.opportunity_score < 60).length, [scoredCompanies]);
  const newSignals24h = useMemo(() => (signalsQ.data ?? []).filter(s => (Date.now() - new Date(s.ts).getTime()) / 86400000 <= 1).length, [signalsQ.data]);

  return (
    <div className="space-y-3 max-w-[1800px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-md bg-primary/10 border border-primary/30 flex items-center justify-center">
            <Target className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight">
              {dashboardMode ? "Your pipeline" : "Teams · Sales floor"}
            </h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {profile?.company_name ? `${profile.company_name}` : "Profile not set — "}
              {!profile?.company_name && <Link to="/profile" className="text-primary hover:underline">add your firm</Link>}
              {profile?.icp_summary && <> · {profile.icp_summary.slice(0, 120)}</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dashboardMode && (
            <Link
              to="/generate-targets"
              className="text-[11px] px-3 py-1.5 rounded border border-primary/40 bg-primary/15 hover:bg-primary/25 text-primary inline-flex items-center gap-1.5 font-medium"
              title="Open the Target Finder radar scan"
            >
              <Sparkles className="w-3 h-3" /> Generate targets
            </Link>
          )}
          <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1"><Bell className="w-3 h-3" /> auto-updates 5min</span>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <KpiTile label="🔥 Hot targets" value={String(hotCount)} hint="60+ score" tone="alert" />
        <KpiTile label="Warm" value={String(warmCount)} hint="40–59 score" tone="warn" />
        <KpiTile label="New signals 24h" value={String(newSignals24h)} hint={`${(signalsQ.data ?? []).length} in 7d`} tone={newSignals24h > 0 ? "warn" : "neutral"} />
        <KpiTile label="Followed" value={String(savedRows.length)} hint="your pipeline" tone="neutral" />
        <KpiTile label="Universe" value={(scoredCompanies.length).toLocaleString()} hint={`${(universeQ.data ?? []).length.toLocaleString()} total`} tone="neutral" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3">
        {/* MAIN — Tabs + table */}
        <div className="space-y-3">
          {!dashboardMode && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex rounded-md bg-white/[0.03] border border-white/[0.06] p-0.5 text-[11px]">
                <TabBtn active={tab === "suggested"} onClick={() => setTab("suggested")} icon={<Sparkles className="w-3 h-3" />}>Suggested for you</TabBtn>
                <TabBtn active={tab === "companies"} onClick={() => setTab("companies")} icon={<Building2 className="w-3 h-3" />}>All companies</TabBtn>
                <TabBtn active={tab === "firms"} onClick={() => setTab("firms")} icon={<ShieldCheck className="w-3 h-3" />}>Audit firms</TabBtn>
                <TabBtn active={tab === "saved"} onClick={() => setTab("saved")} icon={<Crosshair className="w-3 h-3" />}>Followed · {savedRows.length}</TabBtn>
              </div>
              <div className="flex-1" />
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="pl-7 pr-3 py-1.5 text-xs bg-white/[0.03] border border-white/[0.08] rounded text-white placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40 w-56" />
              </div>
            </div>
          )}

          {!dashboardMode && tab !== "firms" && tab !== "saved" && (
            <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
              <Filter className="w-3 h-3 text-muted-foreground mr-1" />
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="bg-white/[0.03] border border-white/[0.08] rounded px-2 py-1 text-white">
                <option value="">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={minTvlFilter} onChange={(e) => setMinTvlFilter(Number(e.target.value))} className="bg-white/[0.03] border border-white/[0.08] rounded px-2 py-1 text-white">
                <option value="0">Any TVL</option>
                <option value="1000000">$1M+</option>
                <option value="10000000">$10M+</option>
                <option value="50000000">$50M+</option>
                <option value="100000000">$100M+</option>
              </select>
              <select value={auditGapFilter} onChange={(e) => setAuditGapFilter(Number(e.target.value))} className="bg-white/[0.03] border border-white/[0.08] rounded px-2 py-1 text-white">
                <option value="0">Any audit recency</option>
                <option value="6">6+ months stale</option>
                <option value="12">12+ months stale</option>
                <option value="18">18+ months stale</option>
              </select>
              <span className="text-muted-foreground ml-2">{filtered.length} match{filtered.length === 1 ? "" : "es"}</span>
            </div>
          )}

          {/* Content */}
          {tab === "firms" ? (
            <div className="as-card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                <span className="text-[11px] uppercase tracking-wider font-semibold text-white">Audit firms</span>
                <span className="text-[10px] text-muted-foreground ml-auto">{filteredFirms.length} firms</span>
              </div>
              <div className="divide-y divide-white/[0.04] max-h-[680px] overflow-y-auto">
                {filteredFirms.map((f) => {
                  const key = `firm::${f.firm}`;
                  const isSaved = savedSet.has(key);
                  return (
                    <div key={f.firm} className="px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02] group">
                      <BrandLogo name={f.firm} className="w-8 h-8 rounded-md shrink-0" />
                      <div className="flex-1 min-w-0">
                        <Link to={`/auditors/${encodeURIComponent(f.firm)}`} className="text-sm font-medium text-white hover:text-primary truncate">{f.firm}</Link>
                        <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">{f.clients} clients · {f.audits} audits · latest {f.latest || "—"}</div>
                      </div>
                      <SaveButton saved={isSaved} onClick={() => toggleSave(f.firm, "firm", f.firm, null)} />
                      <Link to={`/auditors/${encodeURIComponent(f.firm)}`} className="text-muted-foreground hover:text-primary"><ArrowRight className="w-3 h-3" /></Link>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : tab === "saved" ? (
            <>
              <div className="as-card p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
                  <Bookmark className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-white">Followed pipeline</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{savedRows.length} saved</span>
                </div>
                {savedRows.length === 0 ? (
                  <div className="px-4 py-12 text-center text-xs text-muted-foreground">
                    No followed targets yet. Click the <Bookmark className="w-3 h-3 inline" /> icon on any company or firm to add.
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.04] max-h-[680px] overflow-y-auto">
                    {savedRows.map((s) => (
                      <div key={s.id} className="px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02]">
                        <BrandLogo name={s.company_name || s.company_slug} logo={s.company_logo} className="w-8 h-8 rounded-md shrink-0" />
                        <div className="flex-1 min-w-0">
                          <Link to={s.target_kind === "firm" ? `/auditors/${encodeURIComponent(s.company_slug)}` : `/protocol/${s.company_slug}`} className="text-sm font-medium text-white hover:text-primary truncate inline-block">{s.company_name || s.company_slug}</Link>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {s.target_kind === "firm" ? "Audit firm" : "Company"} · saved {tightAgo(s.saved_at)} ago{s.last_signal_at ? ` · new signal ${tightAgo(s.last_signal_at)} ago` : ""}
                          </div>
                        </div>
                        <SaveButton saved={true} onClick={() => toggleSave(s.company_slug, s.target_kind || "company")} />
                        <Link to={s.target_kind === "firm" ? `/auditors/${encodeURIComponent(s.company_slug)}` : `/protocol/${s.company_slug}`} className="text-muted-foreground hover:text-primary"><ArrowRight className="w-3 h-3" /></Link>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ICP collapsible — only in dashboard mode */}
              {dashboardMode && (
                <div className="as-card p-0 overflow-hidden">
                  <button type="button" onClick={() => setIcpOpen(v => !v)} className="w-full px-4 py-3 flex items-center gap-2 hover:bg-white/[0.02] transition-colors" aria-expanded={icpOpen}>
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[11px] uppercase tracking-wider font-semibold text-white">Your ICP</span>
                    {profile?.icp_summary && <span className="text-[10px] text-muted-foreground truncate flex-1 text-left normal-case">{profile.icp_summary.slice(0, 80)}{profile.icp_summary.length > 80 ? "…" : ""}</span>}
                    {!profile?.icp_summary && <span className="text-[10px] text-muted-foreground italic flex-1 text-left normal-case">Not set</span>}
                    <Link to="/profile" onClick={(e) => e.stopPropagation()} className="text-primary text-[10px] normal-case hover:underline">edit</Link>
                    <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${icpOpen ? "rotate-0" : "-rotate-90"}`} />
                  </button>
                  {icpOpen && (
                    <div className="px-4 py-3 border-t border-white/[0.04] space-y-2">
                      {profile?.icp_summary ? (
                        <p className="text-[12px] text-white/80 leading-relaxed">{profile.icp_summary}</p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground italic">No ICP set. Define one on your profile to power smarter target ranking.</p>
                      )}
                      <div className="space-y-1.5 text-[11px]">
                        {profile?.focus_categories && profile.focus_categories.length > 0 && <Tag label="Focus" items={profile.focus_categories} />}
                        {profile?.specialties && profile.specialties.length > 0 && <Tag label="Specialties" items={profile.specialties} />}
                        {profile?.min_tvl_usd && profile.min_tvl_usd > 0 && <Tag label="Min TVL" items={[compactUsd(profile.min_tvl_usd)]} />}
                        {profile?.must_haves && profile.must_haves.length > 0 && <Tag label="Must-have" items={profile.must_haves} />}
                        {profile?.disqualifiers && profile.disqualifiers.length > 0 && <Tag label="Disqualifiers" items={profile.disqualifiers} tone="muted" />}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            // Suggested OR all companies (same render)
            <div className="as-card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
                {tab === "suggested" ? <Sparkles className="w-3.5 h-3.5 text-primary" /> : <Building2 className="w-3.5 h-3.5 text-primary" />}
                <span className="text-[11px] uppercase tracking-wider font-semibold text-white">
                  {tab === "suggested" ? "Best fits for your profile" : "Browse all companies"}
                </span>
                {tab === "suggested" && (
                  <span className="text-[10px] text-muted-foreground ml-1">
                    sorted by ICP match + buy-signal × deal-size
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground ml-auto">{filtered.length}</span>
              </div>
              <div className="divide-y divide-white/[0.04] max-h-[720px] overflow-y-auto">
                {filtered.slice(0, 100).map((p: any) => {
                  const key = `company::${p.slug}`;
                  const isSaved = savedSet.has(key);
                  const isExpanded = expandedSlug === p.slug;
                  return (
                    <div key={p.slug}>
                      <div className="px-4 py-3 flex items-start gap-3 hover:bg-white/[0.02] group cursor-pointer" onClick={() => setExpandedSlug(isExpanded ? null : p.slug)}>
                        <OpportunityBadge score={p.opportunity_score} />
                        <BrandLogo name={p.name} url={p.url} logo={p.logo} className="w-9 h-9 rounded-md shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link to={`/protocol/${p.slug}`} onClick={(e) => e.stopPropagation()} className="text-sm font-medium text-white hover:text-primary truncate">{p.name}</Link>
                            {p.category && <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-white/[0.04] px-1.5 py-0.5 rounded">{p.category}</span>}
                            {p.tvl && <span className="text-[10px] text-emerald-300 bg-emerald-500/[0.05] border border-emerald-500/20 px-1.5 py-0.5 rounded inline-flex items-center gap-1"><TrendingUp className="w-2.5 h-2.5" /> {compactUsd(p.tvl)}</span>}
                            {p.has_bug_bounty && <Bug className="w-3 h-3 text-emerald-300" />}
                            {p.has_been_hacked && <Skull className="w-3 h-3 text-rose-400" />}
                          </div>
                          {tab === "suggested" && p.opportunity_reasons?.length > 0 && (
                            <div className="text-[11px] text-amber-200/80 mt-1 leading-snug">
                              {p.opportunity_reasons.slice(0, 4).join(" · ")}
                            </div>
                          )}
                          <div className="text-[10px] text-muted-foreground/80 mt-0.5 tabular-nums">
                            {p.last_audit_date ? `last audit ${p.last_audit_firm || "—"} · ${p.last_audit_date}` : "no audit on file"}
                            {p.audit_count != null && ` · ${p.audit_count} total audits`}
                          </div>
                        </div>
                        <SaveButton saved={isSaved} onClick={() => toggleSave(p.slug, "company", p.name, p.logo)} />
                        <Link to={`/protocol/${p.slug}`} onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity mt-2"><ArrowRight className="w-3 h-3" /></Link>
                      </div>
                      {isExpanded && (
                        <SalesHexExpansion p={p} agg={auditAggQ.data?.get(p.slug)} />
                      )}
                    </div>
                  );
                })}
                {filtered.length > 100 && (
                  <div className="px-4 py-3 text-xs text-muted-foreground text-center">Showing 100 of {filtered.length}. Refine to narrow.</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT RAIL — Live signals + ICP summary */}
        <div className="space-y-3">
          {/* Live signals */}
          <div className="as-card p-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-white/[0.06] bg-white/[0.02] flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-primary" />
              <h3 className="text-[11px] font-semibold text-white uppercase tracking-wider">Live signals</h3>
              <span className="text-[10px] text-muted-foreground ml-auto">{(signalsQ.data ?? []).length} · 7d</span>
            </div>
            {(signalsQ.data ?? []).length === 0 ? (
              <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">No fresh signals.</div>
            ) : (
              <div className="divide-y divide-white/[0.04] max-h-[460px] overflow-y-auto">
                {(signalsQ.data ?? []).map((e, i) => {
                  const dotCls = e.sev === "alert" ? "bg-rose-400" : e.sev === "warn" ? "bg-amber-400" : "bg-sky-400";
                  const kindIcon = e.kind === "hack" ? <Skull className="w-2.5 h-2.5" /> : e.kind === "raise" ? <Banknote className="w-2.5 h-2.5" /> : e.kind === "audit" ? <ShieldCheck className="w-2.5 h-2.5" /> : <Activity className="w-2.5 h-2.5" />;
                  return (
                    <div key={i} className="px-3 py-2 hover:bg-white/[0.02]">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />
                        <Link to={`/protocol/${e.slug}`} className="text-[11px] font-medium text-white truncate flex-1 hover:text-primary">{e.slug}</Link>
                        <span className="text-[9px] uppercase font-bold text-muted-foreground inline-flex items-center gap-1">{kindIcon}{e.kind}</span>
                        <span className="text-[9px] text-muted-foreground tabular-nums">{tightAgo(e.ts)}</span>
                      </div>
                      <div className="text-[11px] text-white/85 line-clamp-1 mt-0.5">{e.title}</div>
                      <div className="text-[10px] text-muted-foreground/80 line-clamp-1 flex items-center gap-1.5">
                        <span className="truncate">{e.sub}</span>
                        {e.url && (
                          <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline shrink-0">open ↗</a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ICP summary — only show in right rail when NOT in dashboard mode */}
          {!dashboardMode && (
            <div className="as-card p-3">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-primary" />
                Your ICP
                <Link to="/profile" className="text-primary text-[10px] normal-case ml-auto hover:underline">edit</Link>
              </div>
              {profile?.icp_summary ? (
                <p className="text-[12px] text-white/80 leading-relaxed mb-2">{profile.icp_summary}</p>
              ) : (
                <p className="text-[11px] text-muted-foreground italic mb-2">No ICP set. Define one on your profile to power smarter target ranking.</p>
              )}
              <div className="space-y-1.5 text-[11px]">
                {profile?.focus_categories && profile.focus_categories.length > 0 && <Tag label="Focus" items={profile.focus_categories} />}
                {profile?.specialties && profile.specialties.length > 0 && <Tag label="Specialties" items={profile.specialties} />}
                {profile?.min_tvl_usd && profile.min_tvl_usd > 0 && <Tag label="Min TVL" items={[compactUsd(profile.min_tvl_usd)]} />}
                {profile?.must_haves && profile.must_haves.length > 0 && <Tag label="Must-have" items={profile.must_haves} />}
                {profile?.disqualifiers && profile.disqualifiers.length > 0 && <Tag label="Disqualifiers" items={profile.disqualifiers} tone="muted" />}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SalesHexExpansion({ p, agg }: { p: any; agg?: { audit_count: number; firms_used: number; tier1_count: number; contest_count: number; fix_rate: number | null } | null }) {
  const inputs = {
    recent_funding_amount: p.funding?.amount_usd ?? null,
    recent_funding_days_ago: p.funding?.date ? Math.floor((Date.now() - new Date(p.funding.date).getTime()) / 86400000) : null,
    last_audit_ago_days: p.last_audit_date ? Math.floor((Date.now() - new Date(p.last_audit_date).getTime()) / 86400000) : null,
    audit_count: agg?.audit_count ?? p.audit_count ?? 0,
    audit_firms_used_count: agg?.firms_used ?? null,
    tier1_audit_count: agg?.tier1_count ?? null,
    contest_count: agg?.contest_count ?? null,
    fix_rate: agg?.fix_rate ?? null,
    tvl_usd: p.tvl ?? null,
    total_raised_usd: p.total_raised_usd ?? null,
    security_hires: p.hiring?.security_count ?? null,
    smart_contract_hires: p.hiring?.smart_contract_count ?? null,
    has_been_hacked: p.has_been_hacked ?? false,
    open_critical: 0,
    recent_anomaly_z: null,
    icp_fit_score: Math.min(p.opportunity_score, 100),
  };
  const { axes, composite } = computeSalesAxes(inputs);
  const tone = scoreToTone(composite);
  return (
    <div className="bg-white/[0.015] border-t border-white/[0.04]">
      <div className="px-4 py-4 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex-1 max-w-md">
          <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-primary/90 mb-1">Sales opportunity profile</div>
          <p className="text-[12.5px] text-white/80 leading-relaxed">
            {p.name} scores <span className="font-bold text-white">{composite}/100</span> as a sales target.
            Strongest signal: <span className="text-emerald-200">{[...axes].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0].label.toLowerCase()}</span>.
            Weakest: <span className="text-amber-200">{[...axes].sort((a, b) => (a.value ?? 0) - (b.value ?? 0))[0].label.toLowerCase()}</span>.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2 text-[10.5px]">
            {p.opportunity_reasons?.slice(0, 6).map((r: string, i: number) => (
              <span key={i} className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-200 border border-amber-500/20">{r}</span>
            ))}
          </div>
        </div>
        <HexagonScore axes={axes as any} centerLabel="Opp." centerValue={composite} centerTone={tone} size={260} variant="sales" />
      </div>
    </div>
  );
}

function TabBtn({ children, active, onClick, icon }: { children: React.ReactNode; active: boolean; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`px-3 py-1.5 rounded inline-flex items-center gap-1.5 transition-colors ${active ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-white"}`}>
      {icon} {children}
    </button>
  );
}

function KpiTile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone: "good" | "warn" | "alert" | "neutral" }) {
  const cls = ({ neutral: "border-white/[0.06] bg-white/[0.02]", good: "border-emerald-500/25 bg-emerald-500/[0.04]", warn: "border-amber-500/25 bg-amber-500/[0.04]", alert: "border-rose-500/30 bg-rose-500/[0.06]" } as Record<string, string>)[tone];
  const valCls = ({ neutral: "text-white", good: "text-emerald-300", warn: "text-amber-200", alert: "text-rose-300" } as Record<string, string>)[tone];
  return (
    <div className={`rounded-md border px-3 py-2.5 ${cls}`}>
      <div className="text-[9.5px] uppercase tracking-[0.08em] font-medium text-muted-foreground/90">{label}</div>
      <div className={`text-[20px] leading-none font-bold tabular-nums mt-1.5 ${valCls}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground/80 mt-1.5">{hint}</div>}
    </div>
  );
}

function OpportunityBadge({ score }: { score: number }) {
  const tone = score >= 60 ? { bg: "bg-rose-500/15", txt: "text-rose-200", border: "border-rose-500/40", label: "HOT" }
    : score >= 40 ? { bg: "bg-amber-500/15", txt: "text-amber-200", border: "border-amber-500/40", label: "WARM" }
    : score >= 25 ? { bg: "bg-sky-500/10", txt: "text-sky-200", border: "border-sky-500/30", label: "FIT" }
    : { bg: "bg-white/[0.04]", txt: "text-muted-foreground/70", border: "border-white/[0.06]", label: "—" };
  return (
    <div className={`w-10 h-10 rounded-md border ${tone.bg} ${tone.txt} ${tone.border} flex flex-col items-center justify-center shrink-0`}>
      <span className="text-sm font-bold tabular-nums leading-none">{score}</span>
      <span className="text-[7.5px] uppercase tracking-wider opacity-80 mt-0.5">{tone.label}</span>
    </div>
  );
}

function SaveButton({ saved, onClick }: { saved: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      className={`p-1.5 rounded transition-colors ${saved ? "text-primary bg-primary/15 hover:bg-primary/25 ring-1 ring-primary/40" : "text-muted-foreground hover:text-primary hover:bg-white/[0.04]"}`}
      title={saved ? "Remove from targets" : "Save as target"}
    >
      <Crosshair className="w-3.5 h-3.5" />
    </button>
  );
}

function Tag({ label, items, tone = "default" }: { label: string; items: string[]; tone?: "default" | "muted" }) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1 mt-0.5">
        {items.slice(0, 8).map((it, i) => (
          <span key={i} className={`text-[10.5px] px-1.5 py-0.5 rounded border ${tone === "muted" ? "border-white/[0.06] bg-white/[0.02] text-muted-foreground" : "border-primary/20 bg-primary/[0.05] text-primary"}`}>
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}
