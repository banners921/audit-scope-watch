import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Radar, Target, Flame } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { fetchLlamaProtocol } from "@/lib/liveData";
import { formatTvl } from "@/lib/format";
import { CompanyLogo } from "@/components/CompanyLogo";
import { LangBadge } from "@/components/LangBadge";
import { RadarAnimation } from "./RadarAnimation";
import { DashboardFilters, DEFAULT_FILTERS, TargetCompany } from "./types";
import { useAuth } from "@/hooks/useAuth";

type Props = {
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
};

const TVL_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "Any TVL", value: 0 },
  { label: "$100K+", value: 100_000 },
  { label: "$1M+", value: 1_000_000 },
  { label: "$5M+", value: 5_000_000 },
  { label: "$10M+", value: 10_000_000 },
];

function monthsAgo(d: string | null): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24 * 30));
}

function errMsg(e: unknown): string {
  if (!e) return "Unknown error";
  if (e instanceof Error) return e.message;
  if (typeof e === "object") {
    const o = e as { message?: string; details?: string; hint?: string; code?: string };
    if (o.message) return `${o.message}${o.code ? ` (${o.code})` : ""}${o.details ? ` — ${o.details}` : ""}`;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}

type IcpContext = {
  categorySet: Set<string>; // lowercase categories user cares about
  langSet: Set<string>;     // lowercase languages user cares about
  chainSet: Set<string>;    // lowercase chains user cares about
};

function scoreCompany(
  c: TargetCompany,
  tvl: number | null,
  recentFunding: boolean,
  warm: boolean,
  icpHit: boolean,
): number {
  let score = 0;
  if (!c.last_audit_date) score += 25;
  else {
    const m = monthsAgo(c.last_audit_date);
    if (m != null && m >= 12) score += 20;
  }
  if (tvl != null && tvl > 1_000_000) score += 20;
  if (c.has_bug_bounty === false) score += 15;
  if ((c.audit_count ?? 0) > 0) score += 10;
  if (recentFunding) score += 10;
  if (warm) score += 15;
  if (icpHit) score += 10;
  return Math.min(100, score);
}

function isIcpHit(c: TargetCompany, ctx: IcpContext, companyCategory: string | null): boolean {
  if (ctx.categorySet.size > 0 && companyCategory && ctx.categorySet.has(companyCategory.toLowerCase())) {
    return true;
  }
  if (ctx.langSet.size > 0 && c.smart_contract_language && ctx.langSet.has(c.smart_contract_language.toLowerCase())) {
    return true;
  }
  if (ctx.chainSet.size > 0 && (c.chains || []).some((ch) => ctx.chainSet.has(ch.toLowerCase()))) {
    return true;
  }
  return false;
}

function ScoreBar({ score }: { score: number }) {
  const color = score > 75 ? "bg-red-500" : score > 50 ? "bg-orange-400" : "bg-emerald-400";
  return (
    <div className="flex items-center gap-2 w-20">
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground w-6 text-right">{score}</span>
    </div>
  );
}

function TvlCell({ slugs }: { slugs: string[] }) {
  const tvl = useTvlSum(slugs);
  if (tvl.isLoading) {
    return <span className="inline-block w-12 h-3 bg-white/10 rounded animate-pulse" />;
  }
  return <span className="font-mono text-xs text-white">{tvl.data != null ? formatTvl(tvl.data) : "—"}</span>;
}

function useTvlSum(slugs: string[]) {
  return useQuery({
    queryKey: ["llama-tvl-sum", slugs.join(",")],
    enabled: slugs.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const vals = await Promise.all(slugs.map((s) => fetchLlamaProtocol(s)));
      const sums = vals.map((v) => v.tvl).filter((v): v is number => v != null);
      return sums.length > 0 ? sums.reduce((a, b) => a + b, 0) : null;
    },
  });
}

function FilterSelect<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ label: string; value: T }>;
}) {
  return (
    <select
      value={String(value)}
      onChange={(e) => {
        const found = options.find((o) => String(o.value) === e.target.value);
        if (found) onChange(found.value);
      }}
      className="text-xs bg-white/[0.04] border border-white/10 rounded-md px-2 py-1 text-white outline-none hover:bg-white/[0.06] focus:border-primary"
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
      ))}
    </select>
  );
}

export function ActiveTargets({ selectedSlug, onSelect }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [view, setView] = useState<"all" | "warm" | "saved">("all");
  const [generating, setGenerating] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const revealedRef = useRef(false);

  useEffect(() => {
    if (!revealedRef.current) {
      revealedRef.current = true;
      setRevealed(true);
    }
  }, []);

  const languages = useQuery({
    queryKey: ["dashboard-languages"],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const set = new Set<string>();
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("protocols")
          .select("smart_contract_language")
          .not("smart_contract_language", "is", null)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        data?.forEach((r: { smart_contract_language: string | null }) => {
          if (r.smart_contract_language) set.add(r.smart_contract_language);
        });
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    },
  });

  const chains = useQuery({
    queryKey: ["dashboard-chains"],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const set = new Set<string>();
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("protocols")
          .select("chains")
          .not("chains", "is", null)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        data?.forEach((r: { chains: string[] | null }) => {
          (r.chains || []).forEach((c) => c && set.add(c));
        });
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    },
  });

  const targets = useQuery({
    queryKey: ["dashboard-targets", filters],
    queryFn: async (): Promise<TargetCompany[]> => {
      // Pull child protocols matching language/chain filters first so we can
      // resolve which companies (parents) qualify.
      let pq = supabase
        .from("protocols")
        .select("slug,parent_slug,smart_contract_language,chains")
        .not("parent_slug", "is", null);
      if (filters.language) pq = pq.eq("smart_contract_language", filters.language);
      if (filters.chain) pq = pq.contains("chains", [filters.chain]);
      const { data: pRows, error: pErr } = await pq.limit(5000);
      if (pErr) throw pErr;

      const protocolsByCompany = new Map<string, { slugs: string[]; chains: Set<string>; langs: Set<string> }>();
      (pRows || []).forEach((p) => {
        const parent = p.parent_slug as string;
        if (!parent) return;
        const entry = protocolsByCompany.get(parent) || { slugs: [], chains: new Set(), langs: new Set() };
        entry.slugs.push(p.slug);
        (p.chains as string[] | null)?.forEach((c) => c && entry.chains.add(c));
        if (p.smart_contract_language) entry.langs.add(p.smart_contract_language);
        protocolsByCompany.set(parent, entry);
      });

      const candidateSlugs = Array.from(protocolsByCompany.keys());
      if (candidateSlugs.length === 0) return [];

      // Audit-status + bug-bounty filters apply on the company itself.
      let cq = supabase
        .from("companies")
        .select(
          "slug,name,logo,category,audit_count,has_bug_bounty,last_audit_date,last_audit_firm,unique_auditor_count,url,twitter,github",
        )
        .in("slug", candidateSlugs.slice(0, 1000));

      if (filters.auditStatus === "never") cq = cq.is("last_audit_date", null);
      if (filters.auditStatus === "stale") {
        const t = new Date();
        t.setMonth(t.getMonth() - 12);
        cq = cq.lt("last_audit_date", t.toISOString().slice(0, 10));
      }
      if (filters.auditStatus === "recent") {
        const t = new Date();
        t.setMonth(t.getMonth() - 6);
        cq = cq.gte("last_audit_date", t.toISOString().slice(0, 10));
      }
      if (filters.bugBounty === "yes") cq = cq.eq("has_bug_bounty", true);
      if (filters.bugBounty === "no") cq = cq.eq("has_bug_bounty", false);

      const { data, error } = await cq.limit(200);
      if (error) throw error;

      const rows: TargetCompany[] = (data || []).map((c) => {
        const entry = protocolsByCompany.get(c.slug);
        return {
          slug: c.slug,
          name: c.name,
          logo: c.logo,
          category: c.category,
          audit_count: c.audit_count,
          has_bug_bounty: c.has_bug_bounty,
          last_audit_date: c.last_audit_date,
          last_audit_firm: c.last_audit_firm,
          unique_auditor_count: c.unique_auditor_count,
          url: c.url,
          twitter: c.twitter,
          github: c.github as string[] | null,
          chains: entry ? Array.from(entry.chains) : [],
          smart_contract_language: entry && entry.langs.size > 0 ? Array.from(entry.langs)[0] : null,
          protocol_slugs: entry ? entry.slugs : [],
        };
      });

      rows.sort((a, b) => {
        const aBucket = a.last_audit_date == null ? 0 : monthsAgo(a.last_audit_date)! >= 12 ? 1 : 2;
        const bBucket = b.last_audit_date == null ? 0 : monthsAgo(b.last_audit_date)! >= 12 ? 1 : 2;
        if (aBucket !== bBucket) return aBucket - bBucket;
        return a.name.localeCompare(b.name);
      });
      return rows.slice(0, 50);
    },
  });

  const candidateSlugs = useMemo(() => (targets.data || []).map((c) => c.slug), [targets.data]);

  const fundingRecent = useQuery({
    queryKey: ["dashboard-recent-funding", candidateSlugs.join(",")],
    enabled: candidateSlugs.length > 0,
    queryFn: async () => {
      const since = new Date();
      since.setMonth(since.getMonth() - 6);
      const { data, error } = await supabase
        .from("funding_rounds")
        .select("company_slug,date")
        .in("company_slug", candidateSlugs)
        .gte("date", since.toISOString().slice(0, 10));
      if (error) throw error;
      const set = new Set<string>();
      (data || []).forEach((r: { company_slug: string | null }) => r.company_slug && set.add(r.company_slug));
      return set;
    },
  });

  const saved = useQuery({
    queryKey: ["saved-target-slugs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_targets")
        .select("company_slug")
        .eq("user_id", user!.id);
      if (error) throw error;
      return new Set((data || []).map((r: { company_slug: string }) => r.company_slug));
    },
  });

  const profile = useQuery({
    queryKey: ["user-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_profiles")
        .select(
          "investors,ideal_target_slugs,existing_client_slugs,hide_existing_clients,focus_categories,specialties",
        )
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return data as {
        investors: string[] | null;
        ideal_target_slugs: string[] | null;
        existing_client_slugs: string[] | null;
        hide_existing_clients: boolean | null;
        focus_categories: string[] | null;
        specialties: string[] | null;
      } | null;
    },
  });

  const investors = profile.data?.investors ?? [];
  const idealSlugs = profile.data?.ideal_target_slugs ?? [];
  const existingClients = useMemo(
    () => new Set(profile.data?.existing_client_slugs ?? []),
    [profile.data?.existing_client_slugs],
  );
  const hideClients = profile.data?.hide_existing_clients ?? true;

  // Pull ICP context from ideal targets (categories/chains/languages) + user's focus/specialties tokens.
  const idealMeta = useQuery({
    queryKey: ["ideal-targets-meta", idealSlugs.join(",")],
    enabled: idealSlugs.length > 0,
    queryFn: async () => {
      const { data: cs } = await supabase.from("companies").select("slug,category").in("slug", idealSlugs);
      const { data: ps } = await supabase
        .from("protocols")
        .select("parent_slug,chains,smart_contract_language")
        .in("parent_slug", idealSlugs);
      return {
        categories: (cs || []).map((r: { category: string | null }) => r.category).filter(Boolean) as string[],
        chains: (ps || []).flatMap((r: { chains: string[] | null }) => r.chains || []),
        langs: (ps || [])
          .map((r: { smart_contract_language: string | null }) => r.smart_contract_language)
          .filter(Boolean) as string[],
      };
    },
  });

  const icpContext = useMemo<IcpContext>(() => {
    const focus = (profile.data?.focus_categories ?? []).map((c) => c.toLowerCase());
    const specs = (profile.data?.specialties ?? []).map((s) => s.toLowerCase());
    return {
      categorySet: new Set([...focus, ...(idealMeta.data?.categories || []).map((c) => c.toLowerCase())]),
      langSet: new Set([...specs, ...(idealMeta.data?.langs || []).map((c) => c.toLowerCase())]),
      chainSet: new Set([...specs, ...(idealMeta.data?.chains || []).map((c) => c.toLowerCase())]),
    };
  }, [profile.data?.focus_categories, profile.data?.specialties, idealMeta.data]);

  const warmSlugs = useQuery({
    queryKey: ["warm-lead-slugs", investors.join("|")],
    enabled: investors.length > 0,
    queryFn: async () => {
      // OR-ilike across the three investor columns for each investor name.
      const orParts = investors
        .flatMap((inv) => {
          const safe = inv.replace(/[%,()]/g, " ").trim();
          if (!safe) return [];
          return [
            `lead_investors.ilike.%${safe}%`,
            `other_investors.ilike.%${safe}%`,
            `all_investors.ilike.%${safe}%`,
          ];
        })
        .join(",");
      if (!orParts) return new Set<string>();
      const { data, error } = await supabase
        .from("funding_rounds")
        .select("company_slug")
        .not("company_slug", "is", null)
        .or(orParts)
        .limit(5000);
      if (error) throw error;
      return new Set((data || []).map((r: { company_slug: string }) => r.company_slug));
    },
  });

  async function toggleSave(c: TargetCompany) {
    if (!user) {
      toast.error("You must be signed in to save targets.");
      return;
    }
    const already = saved.data?.has(c.slug);
    try {
      if (already) {
        const { error } = await supabase
          .from("saved_targets")
          .delete()
          .eq("user_id", user.id)
          .eq("company_slug", c.slug);
        if (error) throw error;
        toast.success(`Removed ${c.name} from saved targets`);
      } else {
        const { error } = await supabase.from("saved_targets").insert({
          user_id: user.id,
          company_slug: c.slug,
          company_name: c.name,
          company_logo: c.logo,
        });
        if (error) throw error;
        toast.success(`Saved ${c.name}`);
      }
      qc.invalidateQueries({ queryKey: ["saved-target-slugs"] });
      qc.invalidateQueries({ queryKey: ["saved-targets"] });
      qc.invalidateQueries({ queryKey: ["dashboard-saved"] });
    } catch (e) {
      console.error("[saved_targets toggle]", e);
      toast.error(`Save failed: ${errMsg(e)}`);
    }
  }

  function onGenerate() {
    setRevealed(false);
    setGenerating(true);
    targets.refetch();
    window.setTimeout(() => {
      setGenerating(false);
      setRevealed(true);
    }, 2500);
  }

  const showRadar = generating || (targets.isLoading && !revealed);
  const rawRows = targets.data || [];
  const allRows = useMemo(() => {
    if (!hideClients) return rawRows;
    return rawRows.filter((c) => !existingClients.has(c.slug));
  }, [rawRows, hideClients, existingClients]);
  const rows =
    view === "saved"
      ? allRows.filter((c) => saved.data?.has(c.slug))
      : view === "warm"
        ? allRows.filter((c) => warmSlugs.data?.has(c.slug))
        : allRows;

  return (
    <div className="as-card flex flex-col h-full overflow-hidden" style={{ background: "#0F1420", borderColor: "rgba(255,255,255,0.08)" }}>
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Radar className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-white">Active Targets</h3>
          <span className="text-xs font-mono text-muted-foreground">{rows.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-white/[0.04] rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setView("all")}
              className={`text-[11px] px-2.5 py-1 rounded ${
                view === "all" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-white"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setView("warm")}
              disabled={investors.length === 0}
              title={investors.length === 0 ? "Add investors in Profile to enable warm leads" : undefined}
              className={`text-[11px] px-2.5 py-1 rounded inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed ${
                view === "warm" ? "bg-amber-500/15 text-amber-300" : "text-muted-foreground hover:text-white"
              }`}
            >
              <Flame className="w-3 h-3" /> Warm
            </button>
            <button
              type="button"
              onClick={() => setView("saved")}
              className={`text-[11px] px-2.5 py-1 rounded ${
                view === "saved" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-white"
              }`}
            >
              Saved
            </button>
          </div>
          <button
            onClick={onGenerate}
            className="as-btn as-btn-primary text-xs py-1.5 px-3"
          >
            Generate
          </button>
        </div>
      </div>

      <div className="px-4 py-2 border-b border-white/[0.06] flex flex-wrap gap-2">
        <FilterSelect
          value={filters.language}
          onChange={(v) => setFilters((f) => ({ ...f, language: v }))}
          options={[
            { label: "All Languages", value: "" },
            ...(languages.data || []).map((l) => ({ label: l, value: l })),
          ]}
        />
        <FilterSelect
          value={filters.chain}
          onChange={(v) => setFilters((f) => ({ ...f, chain: v }))}
          options={[
            { label: "All Chains", value: "" },
            ...(chains.data || []).map((c) => ({ label: c, value: c })),
          ]}
        />
        <FilterSelect
          value={filters.minTvl}
          onChange={(v) => setFilters((f) => ({ ...f, minTvl: Number(v) }))}
          options={TVL_OPTIONS}
        />
        <FilterSelect
          value={filters.auditStatus}
          onChange={(v) => setFilters((f) => ({ ...f, auditStatus: v as DashboardFilters["auditStatus"] }))}
          options={[
            { label: "Audit: Any", value: "any" },
            { label: "Never audited", value: "never" },
            { label: "Stale (>12mo)", value: "stale" },
            { label: "Recent (<6mo)", value: "recent" },
          ]}
        />
        <FilterSelect
          value={filters.bugBounty}
          onChange={(v) => setFilters((f) => ({ ...f, bugBounty: v as DashboardFilters["bugBounty"] }))}
          options={[
            { label: "Bounty: Any", value: "any" },
            { label: "Has bounty", value: "yes" },
            { label: "No bounty", value: "no" },
          ]}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {showRadar ? (
          <RadarAnimation />
        ) : targets.isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 bg-white/[0.03] rounded animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {view === "saved"
              ? "No saved targets yet — click the bookmark icon on any target to save it."
              : view === "warm"
                ? investors.length === 0
                  ? "Add investors in Profile to see warm leads."
                  : "No warm leads match these filters — your investors haven't backed any companies in the current target set."
                : "No targets match these filters"}
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {rows.map((c) => (
              <TargetRow
                key={c.slug}
                c={c}
                selected={selectedSlug === c.slug}
                onSelect={() => onSelect(c.slug)}
                onSave={() => toggleSave(c)}
                isSaved={saved.data?.has(c.slug) ?? false}
                minTvl={filters.minTvl}
                recentFunding={fundingRecent.data?.has(c.slug) ?? false}
                isWarm={warmSlugs.data?.has(c.slug) ?? false}
                icpHit={isIcpHit(c, icpContext, c.category)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TargetRow({
  c,
  selected,
  onSelect,
  onSave,
  isSaved,
  minTvl,
  recentFunding,
  isWarm,
  icpHit,
}: {
  c: TargetCompany;
  selected: boolean;
  onSelect: () => void;
  onSave: () => void;
  isSaved: boolean;
  minTvl: number;
  recentFunding: boolean;
  isWarm: boolean;
  icpHit: boolean;
}) {
  const tvl = useTvlSum(c.protocol_slugs);

  // Apply TVL filter client-side after live TVL fetch.
  const meetsMinTvl = minTvl === 0 || (tvl.data != null && tvl.data >= minTvl);
  if (!meetsMinTvl && !tvl.isLoading && tvl.data != null) return null;

  const score = scoreCompany(c, tvl.data ?? null, recentFunding, isWarm, icpHit);

  return (
    <li
      onClick={onSelect}
      className={`px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-white/[0.03] transition-colors ${
        selected ? "bg-primary/10 border-l-2 border-primary" : "border-l-2 border-transparent"
      }`}
    >
      <CompanyLogo logo={c.logo} url={c.url} name={c.name} className="w-7 h-7 rounded-md shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium text-white truncate">{c.name}</span>
          {c.smart_contract_language && <LangBadge language={c.smart_contract_language} />}
          {isWarm && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30"
              title="Shares an investor with your firm"
            >
              <Flame className="w-2.5 h-2.5" /> Warm
            </span>
          )}
          {icpHit && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/15 text-primary border border-primary/30"
              title="Matches your ICP (category, chain, or language)"
            >
              ICP fit
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono mt-0.5">
          {tvl.isLoading ? (
            <span className="inline-block w-12 h-3 bg-white/10 rounded animate-pulse" />
          ) : tvl.data != null ? (
            <span className="text-white">{formatTvl(tvl.data)}</span>
          ) : (
            <span className="text-muted-foreground">No TVL</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <ScoreBar score={score} />
        <button
          type="button"
          aria-label={isSaved ? "Remove from targets" : "Save as target"}
          title={isSaved ? "Remove from targets" : "Save as target"}
          onClick={(e) => {
            e.stopPropagation();
            onSave();
          }}
          className={`p-1 rounded-md transition-colors ${
            isSaved
              ? "text-primary bg-primary/10"
              : "text-muted-foreground hover:text-primary hover:bg-white/[0.04]"
          }`}
        >
          <Target className="w-4 h-4" />
        </button>
      </div>
    </li>
  );
}
