import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search, ShieldCheck, Sparkles, X, Wand2, Filter as FilterIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { AsyncAutocomplete, type AutocompleteOption } from "@/components/AsyncAutocomplete";
import { CompanyLogo } from "@/components/CompanyLogo";
import { RadarAnimation } from "./RadarAnimation";

// ---------- shared types ----------

type Tab = "search" | "filter" | "suggest";

type CompanyRow = {
  slug: string;
  name: string;
  logo: string | null;
  url: string | null;
  category: string | null;
  last_audit_date: string | null;
  last_audit_firm: string | null;
  audit_count: number | null;
  has_bug_bounty: boolean | null;
  is_institution: boolean | null;
  total_raised_usd: number | null;
};

type Picked = Record<string, { name: string; logo: string | null }>;

// ---------- helpers ----------

function ageDays(d: string | null): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
}

function pillCls(active: boolean): string {
  return active
    ? "bg-primary/15 text-primary border-primary/40"
    : "bg-white/[0.03] text-muted-foreground border-white/10 hover:border-white/25";
}

// ---------- main modal ----------

type Props = { onClose: () => void; onAdded: () => void; defaultTab?: Tab };

export function AddAccountModal({ onClose, onAdded, defaultTab = "search" }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [picked, setPicked] = useState<Picked>({});
  const [saving, setSaving] = useState(false);

  // Load profile once — used by filter (auto-exclude existing clients) + suggest (scorer).
  const profile = useQuery({
    queryKey: ["add-account-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("company_name,icp_summary,investors,existing_client_slugs,hide_existing_clients,focus_categories,specialties,ideal_target_slugs")
        .eq("user_id", user!.id)
        .maybeSingle();
      return (data as {
        company_name: string | null;
        icp_summary: string | null;
        investors: string[] | null;
        existing_client_slugs: string[] | null;
        hide_existing_clients: boolean | null;
        focus_categories: string[] | null;
        specialties: string[] | null;
        ideal_target_slugs: string[] | null;
      } | null) || null;
    },
  });

  // Already-saved targets so we don't suggest them again.
  const saved = useQuery({
    queryKey: ["add-account-saved", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("saved_targets")
        .select("company_slug")
        .eq("user_id", user!.id);
      return new Set((data || []).map((r: { company_slug: string }) => r.company_slug));
    },
  });

  const excludedSlugs = useMemo(() => {
    const out = new Set<string>(saved.data || []);
    if (profile.data?.hide_existing_clients !== false) {
      (profile.data?.existing_client_slugs || []).forEach((s) => out.add(s));
    }
    return out;
  }, [saved.data, profile.data]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function togglePick(c: { slug: string; name: string; logo: string | null }) {
    setPicked((p) => {
      if (p[c.slug]) {
        const next = { ...p };
        delete next[c.slug];
        return next;
      }
      return { ...p, [c.slug]: { name: c.name, logo: c.logo } };
    });
  }

  async function save() {
    if (!user) return;
    const slugs = Object.keys(picked);
    if (slugs.length === 0) return;
    setSaving(true);
    try {
      let added = 0;
      let dupes = 0;
      for (const slug of slugs) {
        const { error } = await supabase.from("saved_targets").insert({
          user_id: user.id,
          company_slug: slug,
          company_name: picked[slug].name,
          company_logo: picked[slug].logo,
        });
        if (!error) added++;
        else if (error.code === "23505") dupes++;
        else throw error;
      }
      toast.success(`Added ${added}${dupes ? ` (${dupes} already tracked)` : ""}`);
      qc.invalidateQueries({ queryKey: ["suggest-targets-ai"] });
      qc.invalidateQueries({ queryKey: ["add-account-saved"] });

      // #115 Auto-refresh signals for newly-saved targets (fire-and-forget background pull).
      if (added > 0) {
        const newSlugs = slugs;
        (async () => {
          try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;
            if (!token) return;
            const base = (import.meta.env.VITE_SUPABASE_URL as string) || "https://qktjbtmcjrwzmtqnszbq.supabase.co";
            const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
            const slugsBody = JSON.stringify({ company_slugs: newSlugs });
            const userBody = JSON.stringify({ only_tracked: true, user_id: user.id });
            await Promise.allSettled([
              fetch(`${base}/functions/v1/collect-hiring-ats`, { method: "POST", headers, body: slugsBody }),
              fetch(`${base}/functions/v1/collect-onchain-events`, { method: "POST", headers, body: slugsBody }),
              fetch(`${base}/functions/v1/collect-defillama`, { method: "POST", headers, body: userBody }),
              fetch(`${base}/functions/v1/collect-github`, { method: "POST", headers, body: userBody }),
            ]);
            qc.invalidateQueries({ queryKey: ["accounts-data"] });
          } catch { /* fire-and-forget; user can hit Refresh signals if anything failed */ }
        })();
      }

      onAdded();
      onClose();
    } catch (e) {
      const o = e as { message?: string };
      toast.error(`Add failed: ${o?.message || "unknown"}`);
    } finally {
      setSaving(false);
    }
  }

  const pickedCount = Object.keys(picked).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-white/10 bg-[#0F1420] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Add accounts</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Build your target list — search, filter, or let us suggest.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-white p-1 rounded hover:bg-white/[0.04]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="px-5 pt-3 border-b border-white/[0.06] flex items-center gap-1">
          <TabPill icon={<Search className="w-3.5 h-3.5" />} label="Search" active={tab === "search"} onClick={() => setTab("search")} />
          <TabPill icon={<FilterIcon className="w-3.5 h-3.5" />} label="Filter" active={tab === "filter"} onClick={() => setTab("filter")} />
          <TabPill icon={<Wand2 className="w-3.5 h-3.5" />} label="Suggest" active={tab === "suggest"} onClick={() => setTab("suggest")} />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {tab === "search" && (
            <SearchTab picked={picked} togglePick={togglePick} excludedSlugs={excludedSlugs} />
          )}
          {tab === "filter" && (
            <FilterTab picked={picked} togglePick={togglePick} excludedSlugs={excludedSlugs} />
          )}
          {tab === "suggest" && (
            <SuggestTab
              picked={picked}
              togglePick={togglePick}
              excludedSlugs={excludedSlugs}
              profile={profile.data}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {pickedCount === 0 ? "Nothing selected yet" : `${pickedCount} selected`}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={saving || pickedCount === 0}
            className="as-btn as-btn-primary text-xs py-2 px-3 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Track {pickedCount || ""}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabPill({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px ${
        active ? "border-primary text-white" : "border-transparent text-muted-foreground hover:text-white"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ============================================================================
// SEARCH TAB
// ============================================================================

function SearchTab({
  picked,
  togglePick,
  excludedSlugs,
}: {
  picked: Picked;
  togglePick: (c: { slug: string; name: string; logo: string | null }) => void;
  excludedSlugs: Set<string>;
}) {
  const fetcher = useCallback(async (q: string): Promise<AutocompleteOption[]> => {
    const { data } = await supabase
      .from("companies")
      .select("slug,name,logo,category")
      .ilike("name", `%${q}%`)
      .limit(20);
    return ((data || []) as Array<{ slug: string; name: string; logo: string | null; category: string | null }>)
      .map((r) => ({ value: r.slug, label: r.name, sublabel: r.category, logo: r.logo }));
  }, []);

  // Mirror picked state into the autocomplete's `values` array.
  const values = Object.keys(picked);

  const onChange = (next: string[]) => {
    // additions
    next.forEach((slug) => {
      if (!picked[slug]) {
        togglePick({ slug, name: slug, logo: null });
      }
    });
    // removals
    Object.keys(picked).forEach((slug) => {
      if (!next.includes(slug)) togglePick({ slug, name: picked[slug].name, logo: picked[slug].logo });
    });
  };

  // After a new pick lands as slug-only, hydrate its display fields.
  useEffect(() => {
    const missing = Object.keys(picked).filter((s) => picked[s].name === s);
    if (missing.length === 0) return;
    let cancelled = false;
    supabase
      .from("companies")
      .select("slug,name,logo")
      .in("slug", missing)
      .then(({ data }) => {
        if (cancelled || !data) return;
        (data as Array<{ slug: string; name: string; logo: string | null }>).forEach((r) => {
          if (picked[r.slug]?.name !== r.name) {
            togglePick({ slug: r.slug, name: r.name, logo: r.logo });
            togglePick({ slug: r.slug, name: r.name, logo: r.logo });
          }
        });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(picked).join(",")]);

  return (
    <div className="p-5 space-y-3">
      <AsyncAutocomplete
        values={values}
        onChange={onChange}
        placeholder="Search companies by name…"
        fetcher={fetcher}
        renderChipLabel={(slug) => picked[slug]?.name || slug}
      />
      {excludedSlugs.size > 0 && (
        <div className="text-[11px] text-muted-foreground">
          {excludedSlugs.size} companies hidden (already saved or marked as existing client).
        </div>
      )}
    </div>
  );
}

// ============================================================================
// FILTER TAB
// ============================================================================

// Curated top-of-funnel categories for audit sales. Canonical-cased to match DB after normalization pass.
const CATEGORY_OPTIONS = [
  "DEX", "Lending", "Bridge", "L1", "L2", "DeFi", "CeFi", "Real World Assets",
  "Stablecoin", "Liquid Staking", "Derivatives", "CDP", "Infrastructure",
  "Gaming", "NFT", "Prediction Market", "Insurance",
];
const LANG_OPTIONS = ["solidity", "rust", "move", "cairo", "cosmwasm", "vyper"];
const AUDIT_AGE_OPTIONS = [
  { label: "Any", value: null as null | number },
  { label: "> 90 days", value: 90 },
  { label: "> 180 days", value: 180 },
  { label: "> 365 days", value: 365 },
  { label: "Never audited", value: -1 },
];
const FUNDING_AGE_OPTIONS = [
  { label: "Any", value: null as null | number },
  { label: "Last 30 days", value: 30 },
  { label: "Last 90 days", value: 90 },
  { label: "Last 180 days", value: 180 },
];

function FilterTab({
  picked,
  togglePick,
  excludedSlugs,
}: {
  picked: Picked;
  togglePick: (c: { slug: string; name: string; logo: string | null }) => void;
  excludedSlugs: Set<string>;
}) {
  const [categories, setCategories] = useState<string[]>([]);
  const [langs, setLangs] = useState<string[]>([]);
  const [auditedByFirm, setAuditedByFirm] = useState<string>("");
  const [auditAge, setAuditAge] = useState<number | null>(null);
  const [fundingAge, setFundingAge] = useState<number | null>(null);
  const [hasBugBounty, setHasBugBounty] = useState<boolean>(false);
  const [orgType, setOrgType] = useState<"any" | "protocols" | "institutions">("any");

  // Distinct audit firms for the dropdown.
  const firms = useQuery({
    queryKey: ["filter-firms"],
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_history")
        .select("audit_firm")
        .not("audit_firm", "is", null)
        .limit(5000);
      const set = new Set<string>();
      (data || []).forEach((r: { audit_firm: string | null }) => r.audit_firm && set.add(r.audit_firm));
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    },
    staleTime: 10 * 60 * 1000,
  });

  // Run the filter query.
  const results = useQuery({
    queryKey: [
      "filter-results",
      categories.join(","),
      langs.join(","),
      auditedByFirm,
      auditAge,
      fundingAge,
      hasBugBounty,
      orgType,
    ],
    queryFn: async () => {
      // Step 1: candidate company_slugs that pass language + audited-by filters (these require joins).
      let candidateSlugs: Set<string> | null = null;

      if (langs.length > 0) {
        const { data: protos } = await supabase
          .from("protocols")
          .select("parent_slug")
          .in("smart_contract_language", langs)
          .limit(5000);
        candidateSlugs = new Set((protos || []).map((r: { parent_slug: string | null }) => r.parent_slug).filter(Boolean) as string[]);
      }

      if (auditedByFirm) {
        const { data: ahs } = await supabase
          .from("audit_history")
          .select("company_slug")
          .eq("audit_firm", auditedByFirm)
          .not("company_slug", "is", null)
          .limit(5000);
        const fromAudits = new Set((ahs || []).map((r: { company_slug: string | null }) => r.company_slug).filter(Boolean) as string[]);
        candidateSlugs = candidateSlugs ? new Set([...candidateSlugs].filter((s) => fromAudits.has(s))) : fromAudits;
      }

      if (fundingAge != null) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - fundingAge);
        const { data: fr } = await supabase
          .from("funding_rounds")
          .select("company_slug")
          .gte("date", cutoff.toISOString().slice(0, 10))
          .not("company_slug", "is", null)
          .limit(5000);
        const fromFunding = new Set((fr || []).map((r: { company_slug: string | null }) => r.company_slug).filter(Boolean) as string[]);
        candidateSlugs = candidateSlugs ? new Set([...candidateSlugs].filter((s) => fromFunding.has(s))) : fromFunding;
      }

      // Step 2: main companies query.
      let q = supabase
        .from("companies")
        .select("slug,name,logo,url,category,last_audit_date,last_audit_firm,audit_count,has_bug_bounty,is_institution,total_raised_usd")
        .order("audit_count", { ascending: false, nullsFirst: false })
        .limit(50);
      if (categories.length > 0) q = q.in("category", categories);
      if (hasBugBounty) q = q.eq("has_bug_bounty", true);
      if (orgType === "institutions") q = q.eq("is_institution", true);
      else if (orgType === "protocols") q = q.or("is_institution.is.null,is_institution.eq.false");

      if (auditAge === -1) {
        // "Never audited"
        q = q.is("last_audit_date", null);
      } else if (auditAge != null) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - auditAge);
        q = q.lt("last_audit_date", cutoff.toISOString().slice(0, 10));
      }

      if (candidateSlugs) {
        if (candidateSlugs.size === 0) return [] as CompanyRow[];
        q = q.in("slug", Array.from(candidateSlugs).slice(0, 1000));
      }

      const { data, error } = await q;
      if (error) throw error;
      return ((data || []) as CompanyRow[]).filter((r) => !excludedSlugs.has(r.slug));
    },
  });

  function toggle(list: string[], v: string, setter: (n: string[]) => void) {
    setter(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  function reset() {
    setCategories([]);
    setLangs([]);
    setAuditedByFirm("");
    setAuditAge(null);
    setFundingAge(null);
    setHasBugBounty(false);
    setOrgType("any");
  }

  const activeFilters =
    categories.length +
    langs.length +
    (auditedByFirm ? 1 : 0) +
    (auditAge != null ? 1 : 0) +
    (fundingAge != null ? 1 : 0) +
    (hasBugBounty ? 1 : 0) +
    (orgType !== "any" ? 1 : 0);

  return (
    <div className="p-5 space-y-4">
      {/* Filter controls */}
      <div className="space-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Category</div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggle(categories, c, setCategories)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border ${pillCls(categories.includes(c))}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Language</div>
          <div className="flex flex-wrap gap-1.5">
            {LANG_OPTIONS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => toggle(langs, l, setLangs)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border ${pillCls(langs.includes(l))}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Audited by</div>
            <select
              value={auditedByFirm}
              onChange={(e) => setAuditedByFirm(e.target.value)}
              className="as-input text-xs py-1.5"
            >
              <option value="">Any firm</option>
              {(firms.data || []).map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Last audit</div>
            <select
              value={auditAge ?? ""}
              onChange={(e) => setAuditAge(e.target.value === "" ? null : Number(e.target.value))}
              className="as-input text-xs py-1.5"
            >
              {AUDIT_AGE_OPTIONS.map((o) => (
                <option key={String(o.value)} value={o.value ?? ""}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Funded</div>
            <select
              value={fundingAge ?? ""}
              onChange={(e) => setFundingAge(e.target.value === "" ? null : Number(e.target.value))}
              className="as-input text-xs py-1.5"
            >
              {FUNDING_AGE_OPTIONS.map((o) => (
                <option key={String(o.value)} value={o.value ?? ""}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-white/[0.04] rounded-md p-0.5">
            {(["any", "protocols", "institutions"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setOrgType(t)}
                className={`text-[11px] px-2.5 py-1 rounded font-medium ${
                  orgType === t ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-white"
                }`}
              >
                {t === "any" ? "Any" : t === "protocols" ? "Protocols only" : "Institutions only"}
              </button>
            ))}
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-white cursor-pointer">
            <input
              type="checkbox"
              checked={hasBugBounty}
              onChange={(e) => setHasBugBounty(e.target.checked)}
              className="rounded border-white/20 bg-white/[0.04]"
            />
            Has active bug bounty
          </label>
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="text-[11px] text-muted-foreground">
            {activeFilters === 0 ? "No filters — showing top by audit count" : `${activeFilters} filter${activeFilters === 1 ? "" : "s"} applied`}
            {(results.data?.length ?? 0) > 0 && <> · {results.data!.length} matches</>}
          </div>
          {activeFilters > 0 && (
            <button type="button" onClick={reset} className="text-[11px] text-muted-foreground hover:text-white">
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="border-t border-white/[0.06] pt-3">
        {results.isLoading ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Searching…
          </div>
        ) : (results.data?.length ?? 0) === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">No matches. Try fewer filters.</div>
        ) : (
          <div className="space-y-1">
            {results.data!.map((c) => (
              <ResultRow key={c.slug} c={c} picked={!!picked[c.slug]} togglePick={togglePick} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// SUGGEST TAB — AI-driven via suggest-targets edge fn
// ============================================================================

type AiPick = {
  slug: string;
  name: string;
  logo: string | null;
  url: string | null;
  category: string | null;
  description: string | null;
  is_institution: boolean;
  has_bug_bounty: boolean;
  audit_count: number;
  last_audit_date: string | null;
  last_audit_firm: string | null;
  tier: "emerging" | "established" | "household";
  signals: string[];
  score: number;
  rationale: string;
  fit_factors: string[];
};

type ProfileSnapshot = {
  company_name?: string | null;
  icp_summary?: string | null;
  investors: string[] | null;
  existing_client_slugs: string[] | null;
  focus_categories: string[] | null;
  specialties: string[] | null;
  ideal_target_slugs: string[] | null;
} | null;

function SuggestTab({
  picked,
  togglePick,
  profile,
}: {
  picked: Picked;
  togglePick: (c: { slug: string; name: string; logo: string | null }) => void;
  excludedSlugs: Set<string>;
  profile: ProfileSnapshot;
}) {
  const [shuffleSeed, setShuffleSeed] = useState(0);
  // Track every slug we've shown this modal session so each shuffle returns genuinely new picks.
  // Cap at 50 to prevent the exclusion list from growing without bound.
  const shownSlugsRef = useRef<string[]>([]);

  const suggestions = useQuery({
    queryKey: ["suggest-targets-ai", shuffleSeed],
    staleTime: 0,            // always re-check on mount (saved targets may have changed)
    gcTime: 0,               // don't cache stale picks across modal sessions
    refetchOnMount: "always",
    retry: false,
    queryFn: async (): Promise<AiPick[]> => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Sign in required");
      const base = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
      const exclude = shownSlugsRef.current.slice(-50);
      const res = await fetch(`${base}/functions/v1/suggest-targets`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ shuffle: shuffleSeed, exclude }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error || `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { picks?: AiPick[] };
      const picks = j.picks || [];
      // Append the new slugs to the session memory so the next shuffle won't repeat them.
      const fresh = picks.map((p) => p.slug);
      shownSlugsRef.current = [...shownSlugsRef.current, ...fresh].slice(-50);
      return picks;
    },
  });

  // Headline copy varies based on what we know about the user
  const heading = profile?.company_name
    ? `Tailored for ${profile.company_name}`
    : profile?.icp_summary
    ? "Tailored to your ICP"
    : "Suggested targets";
  const subheading = profile?.company_name
    ? "Reasoned across investor overlap, fundraises, TVL spikes, hiring momentum, and tech-stack fit."
    : "Add your firm details in Profile so we can sharpen these picks to your ICP.";

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">{heading}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{subheading}</div>
        </div>
        <button
          type="button"
          onClick={() => setShuffleSeed((s) => s + 1)}
          disabled={suggestions.isFetching}
          className="shrink-0 text-xs inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-white/10 bg-white/[0.03] text-muted-foreground hover:text-white hover:border-white/25 disabled:opacity-50"
        >
          {suggestions.isFetching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          Shuffle
        </button>
      </div>

      <div className="border-t border-white/[0.06] pt-3">
        {suggestions.isLoading || suggestions.isFetching ? (
          <RadarAnimation
            messages={[
              "Scanning candidate pool…",
              "Cross-referencing investors…",
              "Weighing audit cadence…",
              "Reasoning about tech fit…",
              "Diversifying across tiers…",
              "Surfacing emerging plays…",
              "Ranking by urgency…",
            ]}
          />
        ) : suggestions.isError ? (
          <div className="py-8 text-center text-xs text-destructive">
            {(suggestions.error as Error)?.message || "Suggest failed"}
          </div>
        ) : (suggestions.data?.length ?? 0) === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            No suggestions yet. {profile?.company_name ? "Try saving an ideal target in Profile." : "Set up your Profile to get started."}
          </div>
        ) : (
          <div className="space-y-1.5">
            {suggestions.data!.map((s) => (
              <AiSuggestionRow key={s.slug} s={s} picked={!!picked[s.slug]} togglePick={togglePick} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Legacy SQL scorer kept inline below as a fallback, but unused.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
// ============================================================================
// Result rows
// ============================================================================

function ResultRow({
  c,
  picked,
  togglePick,
}: {
  c: CompanyRow;
  picked: boolean;
  togglePick: (c: { slug: string; name: string; logo: string | null }) => void;
}) {
  const aAge = ageDays(c.last_audit_date);
  return (
    <button
      type="button"
      onClick={() => togglePick({ slug: c.slug, name: c.name, logo: c.logo })}
      className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-md border transition-colors ${
        picked ? "bg-primary/10 border-primary/40" : "bg-white/[0.02] border-white/[0.06] hover:border-white/15"
      }`}
    >
      <CompanyLogo logo={c.logo} url={c.url} name={c.name} className="w-7 h-7 rounded-md" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-white truncate">{c.name}</div>
        <div className="text-[10px] text-muted-foreground font-mono flex items-center gap-2 flex-wrap mt-0.5">
          {c.category && <span>{c.category}</span>}
          {aAge != null ? (
            <span>· Last audit {aAge}d ago{c.last_audit_firm ? ` · ${c.last_audit_firm}` : ""}</span>
          ) : (
            <span className="text-amber-400/80">· No audit on record</span>
          )}
          {c.has_bug_bounty && (
            <span className="inline-flex items-center gap-0.5 text-emerald-400/80"><ShieldCheck className="w-2.5 h-2.5" /> Bounty</span>
          )}
        </div>
      </div>
      <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center border ${picked ? "bg-primary border-primary text-black" : "border-white/15 text-muted-foreground"}`}>
        {picked ? "✓" : "+"}
      </div>
    </button>
  );
}

const TIER_BADGE: Record<"emerging" | "established" | "household", string> = {
  emerging: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  established: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  household: "bg-violet-500/15 text-violet-300 border-violet-500/30",
};
const FIT_FACTOR_LABELS: Record<string, string> = {
  "warm-investor": "🤝 Warm",
  "recent-funding": "💸 Funded",
  "tvl-spike": "📊 TVL spike",
  "hiring": "👋 Hiring",
  "tech-match": "⚡ Tech fit",
  "category-match": "🎯 ICP",
  "lookalike": "🔁 Lookalike",
  "bug-bounty": "🛡 Bounty",
  "institution": "🏛 Institution",
  "emerging": "🌱 Emerging",
  "momentum": "📈 Momentum",
};

function AiSuggestionRow({
  s,
  picked,
  togglePick,
}: {
  s: AiPick;
  picked: boolean;
  togglePick: (c: { slug: string; name: string; logo: string | null }) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => togglePick({ slug: s.slug, name: s.name, logo: s.logo })}
      className={`w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-md border transition-colors ${
        picked ? "bg-primary/10 border-primary/40" : "bg-white/[0.02] border-white/[0.06] hover:border-white/15"
      }`}
    >
      <CompanyLogo logo={s.logo} url={s.url} name={s.name} className="w-9 h-9 rounded-md shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-sm font-medium text-white truncate">{s.name}</div>
          {s.category && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-muted-foreground border border-white/[0.06]">{s.category}</span>
          )}
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${TIER_BADGE[s.tier]}`}>
            {s.tier}
          </span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">score {s.score}</span>
        </div>
        {s.rationale && (
          <div className="text-[11.5px] text-white/80 mt-1 line-clamp-2 leading-snug">{s.rationale}</div>
        )}
        {s.fit_factors.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {s.fit_factors.map((f) => (
              <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.03] text-muted-foreground border border-white/[0.06]">
                {FIT_FACTOR_LABELS[f] || f}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center border mt-1 ${picked ? "bg-primary border-primary text-black" : "border-white/15 text-muted-foreground"}`}>
        {picked ? "✓" : "+"}
      </div>
    </button>
  );
}
