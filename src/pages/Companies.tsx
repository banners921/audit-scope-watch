import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Search, ArrowRight, Building2, ShieldCheck, Skull, Bug, Users, List, LayoutGrid, Banknote, ChevronDown, FileCode, Boxes, FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";
import { SaveTargetButton } from "@/components/SaveTargetButton";
import { canonicalCategory, categoryTextColor } from "@/lib/categories";
import { CategoryChip, CategoryMultiSelect, CategoryFilterStrip } from "@/components/CategoryChip";

function compactUsd(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n === 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtFundingDate(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}, ${dt.getUTCFullYear()}`;
}

function normalizeInvestorName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function parseInvestorList(v: string | string[] | null | undefined): string[] {
  if (!v) return [];
  let list: string[] = [];
  if (Array.isArray(v)) list = v;
  else if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      if (Array.isArray(p)) list = p;
      else list = v.split(/[;,]/);
    } catch { list = v.split(/[;,]/); }
  }
  return list.map(s => String(s).trim()).filter(Boolean);
}

function InvestorAvatars({ names, fundsMap, max = 5 }: { names: string[]; fundsMap: Map<string, { logo: string | null; slug: string }>; max?: number }) {
  if (names.length === 0) return <span className="text-muted-foreground/70 text-[10px]">No investors disclosed</span>;
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((n) => {
        const f = fundsMap.get(normalizeInvestorName(n));
        const initial = n.trim()[0]?.toUpperCase() || "?";
        if (f?.logo) {
          return (
            <img
              key={n}
              src={f.logo}
              alt={n}
              title={n}
              className="w-6 h-6 rounded-full border border-white/15 bg-white object-cover shrink-0"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          );
        }
        return (
          <div key={n} title={n} className="w-6 h-6 rounded-full border border-white/15 bg-white/[0.06] flex items-center justify-center text-[10px] font-semibold text-white/80 shrink-0">
            {initial}
          </div>
        );
      })}
      {extra > 0 && (
        <div title={names.slice(max).join(", ")} className="w-6 h-6 rounded-full border border-white/15 bg-white/[0.06] flex items-center justify-center text-[9px] font-semibold text-white/70 shrink-0">
          +{extra}
        </div>
      )}
    </div>
  );
}

// Round-type → consistent color theme. Buckets normalize variants (Pre-Seed, pre_seed, etc).
function roundTypeStyle(rt: string | null | undefined): { bg: string; text: string; border: string; ring: string } {
  const k = (rt || "").toLowerCase().replace(/[-_\s]+/g, "");
  if (/(preseed|pre)/.test(k)) return { bg: "bg-fuchsia-500/10", text: "text-fuchsia-300", border: "border-fuchsia-500/30", ring: "ring-fuchsia-400/60" };
  if (/^seed$/.test(k) || /seedround|seedstage/.test(k)) return { bg: "bg-emerald-500/10", text: "text-emerald-300", border: "border-emerald-500/30", ring: "ring-emerald-400/60" };
  if (/seriesa\b|^a$|^a1$|^a2$|^a3$/.test(k)) return { bg: "bg-sky-500/10", text: "text-sky-300", border: "border-sky-500/30", ring: "ring-sky-400/60" };
  if (/seriesb\b|^b$|^b1$|^b2$/.test(k)) return { bg: "bg-blue-500/10", text: "text-blue-300", border: "border-blue-500/30", ring: "ring-blue-400/60" };
  if (/seriesc\b|^c$|^c1$/.test(k)) return { bg: "bg-indigo-500/10", text: "text-indigo-300", border: "border-indigo-500/30", ring: "ring-indigo-400/60" };
  if (/seriesd|seriese|seriesf|seriesg|growth|latestage/.test(k)) return { bg: "bg-violet-500/10", text: "text-violet-300", border: "border-violet-500/30", ring: "ring-violet-400/60" };
  if (/strategic|partnership/.test(k)) return { bg: "bg-amber-500/10", text: "text-amber-300", border: "border-amber-500/30", ring: "ring-amber-400/60" };
  if (/bridge|extension|sideround/.test(k)) return { bg: "bg-orange-500/10", text: "text-orange-300", border: "border-orange-500/30", ring: "ring-orange-400/60" };
  if (/token|sale|ico|ido|ieo|publicsale|privatesale/.test(k)) return { bg: "bg-cyan-500/10", text: "text-cyan-300", border: "border-cyan-500/30", ring: "ring-cyan-400/60" };
  if (/grant|treasury/.test(k)) return { bg: "bg-teal-500/10", text: "text-teal-300", border: "border-teal-500/30", ring: "ring-teal-400/60" };
  if (/debt|convertible|safe|note/.test(k)) return { bg: "bg-yellow-500/10", text: "text-yellow-300", border: "border-yellow-500/30", ring: "ring-yellow-400/60" };
  if (/acquisition|acquired|mna/.test(k)) return { bg: "bg-rose-500/10", text: "text-rose-300", border: "border-rose-500/30", ring: "ring-rose-400/60" };
  if (/angel|friendsfamily/.test(k)) return { bg: "bg-pink-500/10", text: "text-pink-300", border: "border-pink-500/30", ring: "ring-pink-400/60" };
  return { bg: "bg-white/[0.05]", text: "text-white/80", border: "border-white/10", ring: "ring-white/30" };
}

type Row = {
  slug: string;
  name: string;
  category: string | null;
  url: string | null;
  logo: string | null;
  audit_count: number | null;
  unique_auditor_count: number | null;
  total_raised_usd: number | null;
  has_been_hacked: boolean;
  has_bug_bounty: boolean;
  last_audit_date: string | null;
};

type AuditorRow = {
  firm: string;
  audits: number;
  clients: number;
  latest: string | null;
  earliest: string | null;
  avg_findings: number | null;
  avg_high: number | null;
  categories: string[];
  description: string | null;
  homepage_url: string | null;
  logo_url: string | null;
  social_x: string | null;
  social_github: string | null;
  verified: boolean;
};

type Tab = "companies" | "auditors" | "funding";
type View = "list" | "grid";

type Props = { forceTab?: Tab };

type FundingRow = {
  id: string;
  company_slug: string;
  company_name: string | null;
  round_type: string | null;
  amount_usd: number | null;
  date: string | null;
  lead_investors: string[] | string | null;
  other_investors: string[] | string | null;
  all_investors: string[] | string | null;
  category: string | null;
  company_logo: string | null;
  company_url: string | null;
};

export default function Companies({ forceTab }: Props = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = forceTab ?? (searchParams.get("tab") === "auditors" ? "auditors" : searchParams.get("tab") === "funding" ? "funding" : "companies");
  const [tab, setTab] = useState<Tab>(tabParam);
  useEffect(() => {
    if (forceTab) {
      setTab(forceTab);
      return;
    }
    const p = searchParams.get("tab");
    const next: Tab = p === "auditors" ? "auditors" : p === "funding" ? "funding" : "companies";
    setTab(next);
  }, [searchParams, forceTab]);
  const [view, setView] = useState<View>("grid");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"name" | "audits" | "raised" | "recent_audit">("name");
  const [auditorSort, setAuditorSort] = useState<"clients" | "audits" | "recent" | "name">("clients");
  const [fundingMinAmt, setFundingMinAmt] = useState<number>(0);
  const [fundingRoundTypes, setFundingRoundTypes] = useState<Set<string>>(new Set());
  const toggleRoundType = (rt: string | null) => {
    const key = (rt || "").trim();
    if (!key) return;
    setFundingRoundTypes(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  // Multi-select category filter (shared across Companies + Funding tabs)
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const toggleCategory = (cat: string | null) => {
    const key = (cat || "").trim();
    if (!key) return;
    setCategoryFilter(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const [renderLimit, setRenderLimit] = useState<number>(500);
  useEffect(() => { setRenderLimit(500); }, [tab, q, categoryFilter]);

  const companiesQ = useQuery({
    queryKey: ["companies-browse"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const all: Row[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabase
          .from("companies")
          .select("slug,name,category,url,logo,audit_count,unique_auditor_count,total_raised_usd,has_been_hacked,has_bug_bounty,last_audit_date")
          .is("parent_slug", null)
          .order("name", { ascending: true })
          .range(from, from + 999);
        if (!data || data.length === 0) break;
        all.push(...(data as Row[]));
        if (data.length < 1000) break;
        from += 1000;
        if (all.length > 8000) break;
      }
      return all;
    },
  });

  const auditorsQ = useQuery({
    queryKey: ["auditors-browse-v2"],
    enabled: tab === "auditors",
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const [stats, meta] = await Promise.all([
        supabase.from("audit_firm_stats").select("firm,total_audits,audited_protocols,avg_findings,avg_high_severity,latest_audit_date,first_audit_date,categories"),
        supabase.from("audit_firm_meta").select("firm_name,description,homepage_url,logo_url,social_x,social_github,verified"),
      ]);
      const metaMap = new Map<string, any>();
      for (const m of (meta.data ?? []) as any[]) metaMap.set(m.firm_name, m);
      return ((stats.data ?? []) as any[]).map(s => ({
        firm: s.firm,
        audits: s.total_audits ?? 0,
        clients: s.audited_protocols ?? 0,
        latest: s.latest_audit_date,
        earliest: s.first_audit_date,
        avg_findings: s.avg_findings ? Number(s.avg_findings) : null,
        avg_high: s.avg_high_severity ? Number(s.avg_high_severity) : null,
        categories: Array.isArray(s.categories) ? s.categories : [],
        description: metaMap.get(s.firm)?.description ?? null,
        homepage_url: metaMap.get(s.firm)?.homepage_url ?? null,
        logo_url: metaMap.get(s.firm)?.logo_url ?? null,
        social_x: metaMap.get(s.firm)?.social_x ?? null,
        social_github: metaMap.get(s.firm)?.social_github ?? null,
        verified: !!metaMap.get(s.firm)?.verified,
      })) as AuditorRow[];
    },
  });

  const fundingQ = useQuery({
    queryKey: ["funding-browse"],
    enabled: tab === "funding",
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("funding_rounds")
        .select("id,company_slug,company_name,round_type,amount_usd,date,lead_investors,other_investors,all_investors,category")
        .not("date", "is", null)
        .order("date", { ascending: false })
        .limit(500);
      const rows = (data ?? []) as any[];
      const slugs = Array.from(new Set(rows.map(r => r.company_slug).filter(Boolean)));
      let logoMap = new Map<string, { logo: string | null; url: string | null }>();
      if (slugs.length > 0) {
        const { data: comps } = await supabase
          .from("companies")
          .select("slug,logo,url")
          .in("slug", slugs);
        for (const c of (comps ?? []) as any[]) logoMap.set(c.slug, { logo: c.logo, url: c.url });
      }
      return rows.map(r => ({
        ...r,
        company_logo: logoMap.get(r.company_slug)?.logo ?? null,
        company_url: logoMap.get(r.company_slug)?.url ?? null,
      })) as FundingRow[];
    },
  });

  const fundsLogoQ = useQuery({
    queryKey: ["funds-logo-map"],
    enabled: tab === "funding",
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from("funds").select("slug,name,logo").not("name", "is", null);
      const map = new Map<string, { slug: string; logo: string | null }>();
      for (const f of (data ?? []) as any[]) {
        if (!f.name) continue;
        map.set(normalizeInvestorName(f.name), { slug: f.slug, logo: f.logo || null });
      }
      return map;
    },
  });
  const fundsMap = fundsLogoQ.data ?? new Map<string, { slug: string; logo: string | null }>();

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const c of companiesQ.data ?? []) { const cc = canonicalCategory(c.category); if (cc) s.add(cc); }
    return Array.from(s).sort();
  }, [companiesQ.data]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let list = (companiesQ.data ?? []).filter((c) => {
      if (ql && !c.name.toLowerCase().includes(ql) && !c.slug.toLowerCase().includes(ql)) return false;
      const ccat = canonicalCategory(c.category) || "";
      if (categoryFilter.size > 0 && !categoryFilter.has(ccat)) return false;
      return true;
    });
    list.sort((a, b) => {
      switch (sort) {
        case "audits": return (b.audit_count ?? 0) - (a.audit_count ?? 0);
        case "raised": return (b.total_raised_usd ?? 0) - (a.total_raised_usd ?? 0);
        case "recent_audit": return (b.last_audit_date || "").localeCompare(a.last_audit_date || "");
        default: return a.name.localeCompare(b.name);
      }
    });
    return list;
  }, [companiesQ.data, q, sort, categoryFilter]);

  const filteredFunding = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let list = (fundingQ.data ?? []).filter(f => {
      if (ql && !(f.company_name || f.company_slug).toLowerCase().includes(ql)) return false;
      if (fundingMinAmt > 0 && (!f.amount_usd || f.amount_usd < fundingMinAmt)) return false;
      if (fundingRoundTypes.size > 0 && !fundingRoundTypes.has((f.round_type || "").trim())) return false;
      const fcat = canonicalCategory(f.category) || "";
      if (categoryFilter.size > 0 && !categoryFilter.has(fcat)) return false;
      return true;
    });
    return list;
  }, [fundingQ.data, q, fundingMinAmt, fundingRoundTypes, categoryFilter]);

  const fundingCategories = useMemo(() => {
    const s = new Set<string>();
    for (const f of (fundingQ.data ?? [])) { const cc = canonicalCategory(f.category); if (cc) s.add(cc); }
    return Array.from(s).sort();
  }, [fundingQ.data]);

  const filteredAuditors = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let list = (auditorsQ.data ?? []).filter(a => !ql || a.firm.toLowerCase().includes(ql));
    list.sort((a, b) => {
      switch (auditorSort) {
        case "audits": return b.audits - a.audits;
        case "recent": return (b.latest || "").localeCompare(a.latest || "");
        case "name": return a.firm.localeCompare(b.firm);
        default: return b.clients - a.clients;
      }
    });
    return list;
  }, [auditorsQ.data, q, auditorSort]);

  return (
    <div className="space-y-5 max-w-[1600px]">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {tab === "companies" ? <Building2 className="w-5 h-5 text-primary" /> : tab === "auditors" ? <ShieldCheck className="w-5 h-5 text-primary" /> : <Banknote className="w-5 h-5 text-primary" />}
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight">
              {tab === "companies" ? "Companies" : tab === "auditors" ? "Audit firms" : "Funding rounds"}
            </h1>
            <p className="text-[11px] text-muted-foreground mt-1">
              {tab === "companies"
                ? "Every protocol we track. Click any row for the full dossier."
                : tab === "auditors"
                  ? "Every audit firm we track. Click to see their portfolio of audited clients."
                  : "Recent funding rounds across the universe. Click a company for the dossier."}
            </p>
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {tab === "companies"
            ? `${filtered.length.toLocaleString()} of ${(companiesQ.data ?? []).length.toLocaleString()}`
            : tab === "auditors"
              ? `${filteredAuditors.length.toLocaleString()} of ${(auditorsQ.data ?? []).length.toLocaleString()} firms`
              : `${filteredFunding.length.toLocaleString()} of ${(fundingQ.data ?? []).length.toLocaleString()} rounds`}
        </div>
      </div>

      {/* Inner sub-tabs (audit-firms only): Firms vs Audited Repos vs Bug Bounties vs Smart Contracts */}
      {tab === "auditors" && (
        <div className="inline-flex rounded-md bg-white/[0.03] border border-white/[0.06] p-0.5 text-[11px]">
          <span className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 bg-primary/15 text-primary font-medium"><ShieldCheck className="w-3 h-3" /> Firms</span>
          <Link to="/audited-repos" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><FileCode className="w-3 h-3" /> Repos</Link>
          <Link to="/audit-reports" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><FileText className="w-3 h-3" /> Reports</Link>
          <Link to="/bug-bounties" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><Bug className="w-3 h-3" /> Bug Bounties</Link>
          <Link to="/smart-contracts" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><Boxes className="w-3 h-3" /> Smart Contracts</Link>
        </div>
      )}

      {/* View toggle only (list/grid). Tab navigation handled via sidebar drawer. */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-md bg-white/[0.03] border border-white/[0.06] p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setView("list")}
            className={`px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 transition-colors ${view === "list" ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-white"}`}
            title="List view"
          >
            <List className="w-3 h-3" /> List
          </button>
          <button
            type="button"
            onClick={() => setView("grid")}
            className={`px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 transition-colors ${view === "grid" ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-white"}`}
            title="Grid view"
          >
            <LayoutGrid className="w-3 h-3" /> Grid
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="as-card p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[240px] max-w-[360px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tab === "companies" ? "Search companies…" : "Search firms…"}
              className="as-input text-xs pl-8 w-full"
            />
          </div>
          {tab === "companies" ? (
            <>
              <CategoryMultiSelect universe={categories} selected={categoryFilter} onToggle={toggleCategory} onClear={() => setCategoryFilter(new Set())} />
              <select value={sort} onChange={(e) => setSort(e.target.value as any)} className="as-input text-xs">
                <option value="name">Sort: name (A–Z)</option>
                <option value="audits">Sort: most audited</option>
                <option value="raised">Sort: most raised</option>
                <option value="recent_audit">Sort: recently audited</option>
              </select>
            </>
          ) : tab === "funding" ? (
            <>
              <CategoryMultiSelect universe={fundingCategories} selected={categoryFilter} onToggle={toggleCategory} onClear={() => setCategoryFilter(new Set())} />
              <select value={fundingMinAmt} onChange={(e) => setFundingMinAmt(Number(e.target.value))} className="as-input text-xs">
                <option value="0">Any amount</option>
                <option value="1000000">$1M+</option>
                <option value="5000000">$5M+</option>
                <option value="10000000">$10M+</option>
                <option value="50000000">$50M+</option>
                <option value="100000000">$100M+</option>
              </select>
            </>
          ) : (
            <select value={auditorSort} onChange={(e) => setAuditorSort(e.target.value as any)} className="as-input text-xs">
              <option value="clients">Sort: most clients</option>
              <option value="audits">Sort: most audits</option>
              <option value="recent">Sort: most recent</option>
              <option value="name">Sort: name (A–Z)</option>
            </select>
          )}
        </div>
      </div>

      <CategoryFilterStrip selected={categoryFilter} onToggle={toggleCategory} onClear={() => setCategoryFilter(new Set())} />

      {/* Table */}
      {tab === "companies" ? (
        view === "list" ? (
        <div className="as-card p-0 overflow-hidden">
          {companiesQ.isLoading ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">Loading companies…</div>
          ) : (
            <div className="overflow-x-auto max-h-[700px]">
              <table className="w-full text-xs">
                <thead className="bg-white/[0.02] border-b border-white/[0.04] sticky top-0 z-10">
                  <tr className="text-left text-[10px] uppercase tracking-[0.08em] font-medium text-muted-foreground">
                    <SortableTH label="Protocol" active={sort === "name"} onClick={() => setSort("name")} className="px-3 py-2.5" />
                    <th className="px-3 py-2.5">Category</th>
                    <SortableTH label="Audits" active={sort === "audits"} onClick={() => setSort("audits")} className="px-2 py-2.5 text-right" align="right" />
                    <th className="px-2 py-2.5 text-right">Firms</th>
                    <SortableTH label="Last audit" active={sort === "recent_audit"} onClick={() => setSort("recent_audit")} className="px-2 py-2.5" />
                    <SortableTH label="Raised" active={sort === "raised"} onClick={() => setSort("raised")} className="px-2 py-2.5 text-right" align="right" />
                    <th className="px-2 py-2.5 text-center">Flags</th>
                    <th className="px-2 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filtered.slice(0, renderLimit).map((c) => (
                    <tr key={c.slug} className="hover:bg-white/[0.02]">
                      <td className="px-3 py-2.5">
                        <Link to={`/protocol/${c.slug}`} className="flex items-center gap-2 hover:text-primary">
                          <BrandLogo name={c.name} url={c.url} logo={c.logo} className="w-7 h-7 rounded shrink-0" />
                          <span className="text-sm text-white truncate max-w-[200px]">{c.name}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-[11px]"><CategoryChip cat={c.category} selected={categoryFilter} onToggle={toggleCategory} /></td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{c.audit_count ?? "—"}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{c.unique_auditor_count ?? "—"}</td>
                      <td className="px-2 py-2.5 text-[11px] text-muted-foreground tabular-nums">{c.last_audit_date || "—"}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{compactUsd(c.total_raised_usd)}</td>
                      <td className="px-2 py-2.5 text-center">
                        <div className="inline-flex items-center gap-1">
                          {c.has_been_hacked && <Skull className="w-3.5 h-3.5 text-rose-400" />}
                          {c.has_bug_bounty && <Bug className="w-3.5 h-3.5 text-emerald-400" />}
                          {!c.has_been_hacked && !c.has_bug_bounty && <span className="text-muted-foreground/40">—</span>}
                        </div>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-1">
                          <SaveTargetButton slug={c.slug} name={c.name} logo={c.logo} />
                          <Link to={`/protocol/${c.slug}`} className="text-muted-foreground hover:text-primary inline-flex items-center"><ArrowRight className="w-3 h-3" /></Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length > renderLimit && (
                <div className="px-4 py-3 text-xs text-muted-foreground text-center flex items-center justify-center gap-3">
                  <span>Showing {renderLimit.toLocaleString()} of {filtered.length.toLocaleString()}.</span>
                  <button onClick={() => setRenderLimit(l => l + 500)} className="text-primary hover:underline">Load 500 more</button>
                  <button onClick={() => setRenderLimit(filtered.length)} className="text-primary hover:underline">Show all</button>
                </div>
              )}
            </div>
          )}
        </div>
        ) : (
        // COMPANIES GRID
        <div>
          {companiesQ.isLoading ? (
            <div className="as-card p-8 text-center text-xs text-muted-foreground">Loading companies…</div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {filtered.slice(0, renderLimit).map((c) => (
                  <Link key={c.slug} to={`/protocol/${c.slug}`} className="as-card p-3 hover:border-primary/40 hover:bg-white/[0.025] transition-colors flex flex-col gap-2 group relative">
                    <div className="absolute top-2 right-2 z-10"><SaveTargetButton slug={c.slug} name={c.name} logo={c.logo} /></div>
                    <div className="flex items-start gap-2 pr-7">
                      <BrandLogo name={c.name} url={c.url} logo={c.logo} className="w-10 h-10 rounded-md shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-white truncate group-hover:text-primary">{c.name}</div>
                        <div className="text-[10px] truncate"><CategoryChip cat={c.category} selected={categoryFilter} onToggle={toggleCategory} stopProp /></div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      {c.has_bug_bounty && <ShieldCheck className="w-3 h-3 text-emerald-300" aria-label="Active bug bounty" />}
                      {c.has_been_hacked && <Skull className="w-3 h-3 text-rose-400" aria-label="Past hack on record" />}
                      <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">{c.audit_count ?? 0} audit{c.audit_count === 1 ? "" : "s"}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-white/[0.04]">
                      <span className="tabular-nums">{c.last_audit_date || "no audit"}</span>
                      <span className="tabular-nums text-white/80">{compactUsd(c.total_raised_usd)}</span>
                    </div>
                  </Link>
                ))}
              </div>
              {filtered.length > 300 && (
                <div className="px-4 py-3 text-xs text-muted-foreground text-center">Showing {renderLimit.toLocaleString()} of {filtered.length.toLocaleString()}</div>
              )}
            </>
          )}
        </div>
        )
      ) : tab === "funding" ? (
        fundingQ.isLoading ? (
          <div className="as-card p-4 text-center text-xs text-muted-foreground">Loading funding rounds…</div>
        ) : (
          <div className="space-y-3">
            {fundingRoundTypes.size > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Filtered by:</span>
                {Array.from(fundingRoundTypes).map((rt) => {
                  const s = roundTypeStyle(rt);
                  return (
                    <button key={rt} type="button" onClick={() => toggleRoundType(rt)} className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${s.bg} ${s.text} ${s.border} hover:brightness-125 inline-flex items-center gap-1`}>
                      {rt} <span aria-hidden>×</span>
                    </button>
                  );
                })}
                <button type="button" onClick={() => setFundingRoundTypes(new Set())} className="text-[10px] text-muted-foreground hover:text-white ml-1 underline">Clear all</button>
              </div>
            )}
        {view === "grid" ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {filteredFunding.slice(0, renderLimit).map((r) => (
                <Link key={r.id} to={`/protocol/${r.company_slug}`} className="as-card p-3.5 hover:border-primary/40 hover:bg-white/[0.025] transition-colors flex flex-col gap-2 group relative">
                  <div className="absolute top-2 right-2 z-10"><SaveTargetButton slug={r.company_slug} name={r.company_name || r.company_slug} /></div>
                  <div className="flex items-start gap-2.5 pr-7">
                    <BrandLogo name={r.company_name || r.company_slug} url={r.company_url} logo={r.company_logo} className="w-10 h-10 rounded-md shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-white truncate group-hover:text-primary">{r.company_name || r.company_slug}</div>
                      <div className="text-[10px] truncate"><CategoryChip cat={r.category} selected={categoryFilter} onToggle={toggleCategory} stopProp /></div>
                    </div>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 mt-0.5">
                    <span className="text-xl font-bold text-emerald-300 tabular-nums">{compactUsd(r.amount_usd)}</span>
                    {(() => {
                      const rt = (r.round_type || "").trim();
                      const s = roundTypeStyle(rt);
                      const selected = rt && fundingRoundTypes.has(rt);
                      return (
                        <button
                          type="button"
                          disabled={!rt}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleRoundType(rt); }}
                          className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors ${s.bg} ${s.text} ${s.border} ${selected ? `ring-2 ${s.ring}` : ""} ${rt ? "hover:brightness-125 cursor-pointer" : "opacity-60 cursor-default"}`}
                          title={rt ? (selected ? `Remove ${rt} filter` : `Filter by ${rt}`) : ""}
                        >
                          {rt || "round"}
                        </button>
                      );
                    })()}
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">{fmtFundingDate(r.date)}</div>
                  <div className="border-t border-white/[0.04] pt-2 mt-auto">
                    <InvestorAvatars
                      names={[...parseInvestorList(r.lead_investors), ...parseInvestorList(r.other_investors)].filter((n, i, arr) => arr.indexOf(n) === i)}
                      fundsMap={fundsMap}
                      max={5}
                    />
                  </div>
                </Link>
              ))}
            </div>
            {filteredFunding.length > renderLimit && (
              <div className="px-4 py-3 text-xs text-muted-foreground text-center flex items-center justify-center gap-3">
                <span>Showing {renderLimit.toLocaleString()} of {filteredFunding.length.toLocaleString()}.</span>
                <button onClick={() => setRenderLimit(l => l + 500)} className="text-primary hover:underline">Load 500 more</button>
              </div>
            )}
          </>
        ) : (
          <div className="as-card p-0 overflow-hidden">
            <div className="overflow-x-auto max-h-[700px]">
              <table className="w-full text-xs">
                <thead className="bg-white/[0.02] border-b border-white/[0.04] sticky top-0 z-10">
                  <tr className="text-left text-[10px] uppercase tracking-[0.08em] font-medium text-muted-foreground">
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">Company</th>
                    <th className="px-3 py-2.5">Round</th>
                    <th className="px-2 py-2.5 text-right">Amount</th>
                    <th className="px-3 py-2.5">Sector</th>
                    <th className="px-3 py-2.5">Investors</th>
                    <th className="px-2 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredFunding.slice(0, renderLimit).map((r) => (
                    <tr key={r.id} className="hover:bg-white/[0.02]">
                      <td className="px-3 py-2.5 text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">{fmtFundingDate(r.date)}</td>
                      <td className="px-3 py-2.5">
                        <Link to={`/protocol/${r.company_slug}`} className="flex items-center gap-2 hover:text-primary">
                          <BrandLogo name={r.company_name || r.company_slug} url={r.company_url} logo={r.company_logo} className="w-6 h-6 rounded shrink-0" />
                          <span className="text-sm text-white truncate max-w-[180px]">{r.company_name || r.company_slug}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        {(() => {
                          const rt = (r.round_type || "").trim();
                          if (!rt) return <span className="text-muted-foreground">—</span>;
                          const s = roundTypeStyle(rt);
                          const selected = fundingRoundTypes.has(rt);
                          return (
                            <button type="button" onClick={(e) => { e.stopPropagation(); toggleRoundType(rt); }} className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors ${s.bg} ${s.text} ${s.border} ${selected ? `ring-2 ${s.ring}` : ""} hover:brightness-125`} title={selected ? `Remove ${rt} filter` : `Filter by ${rt}`}>
                              {rt}
                            </button>
                          );
                        })()}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-emerald-300 font-medium">{compactUsd(r.amount_usd)}</td>
                      <td className="px-3 py-2.5 text-[10px]"><CategoryChip cat={r.category} selected={categoryFilter} onToggle={toggleCategory} /></td>
                      <td className="px-3 py-2.5">
                        <InvestorAvatars
                          names={[...parseInvestorList(r.lead_investors), ...parseInvestorList(r.other_investors)].filter((n, i, arr) => arr.indexOf(n) === i)}
                          fundsMap={fundsMap}
                          max={6}
                        />
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-1">
                          <SaveTargetButton slug={r.company_slug} name={r.company_name || r.company_slug} />
                          <Link to={`/protocol/${r.company_slug}`} className="text-muted-foreground hover:text-primary inline-flex items-center"><ArrowRight className="w-3 h-3" /></Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredFunding.length > 300 && (
                <div className="px-4 py-3 text-xs text-muted-foreground text-center">Showing {renderLimit.toLocaleString()} of {filteredFunding.length.toLocaleString()}</div>
              )}
            </div>
          </div>
        )}
          </div>
        )
      ) : (
        view === "list" ? (
        <div className="as-card p-0 overflow-hidden">
          {auditorsQ.isLoading ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">Loading auditors…</div>
          ) : (
            <div className="overflow-x-auto max-h-[700px]">
              <table className="w-full text-xs">
                <thead className="bg-white/[0.02] border-b border-white/[0.04] sticky top-0 z-10">
                  <tr className="text-left text-[10px] uppercase tracking-[0.08em] font-medium text-muted-foreground">
                    <th className="px-3 py-2.5">Audit firm</th>
                    <th className="px-2 py-2.5 text-right">Protocols</th>
                    <th className="px-2 py-2.5 text-right">Audits</th>
                    <th className="px-2 py-2.5 text-right">Avg findings</th>
                    <th className="px-2 py-2.5 text-right">Avg high sev</th>
                    <th className="px-2 py-2.5">Sectors</th>
                    <th className="px-2 py-2.5">Latest</th>
                    <th className="px-2 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredAuditors.slice(0, renderLimit).map((a) => (
                    <tr key={a.firm} className="hover:bg-white/[0.02]">
                      <td className="px-3 py-2.5">
                        <Link to={`/auditors/${encodeURIComponent(a.firm)}`} className="flex items-center gap-2 hover:text-primary">
                          <BrandLogo name={a.firm} url={a.homepage_url} logo={a.logo_url} className="w-7 h-7 rounded shrink-0" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm text-white truncate max-w-[220px]">{a.firm}</span>
                              {a.verified && <span className="text-[8.5px] uppercase font-bold px-1 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">verified</span>}
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-white">{a.clients.toLocaleString()}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{a.audits.toLocaleString()}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-white/85">{a.avg_findings != null ? a.avg_findings.toFixed(1) : "—"}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-white/85">{a.avg_high != null ? a.avg_high.toFixed(1) : "—"}</td>
                      <td className="px-2 py-2.5 text-[10px] text-muted-foreground truncate max-w-[180px]" title={a.categories.join(", ")}>{a.categories.slice(0, 3).join(", ")}{a.categories.length > 3 && ` +${a.categories.length - 3}`}</td>
                      <td className="px-2 py-2.5 text-[11px] text-muted-foreground tabular-nums">{a.latest || "—"}</td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-1">
                          <SaveTargetButton slug={a.firm} name={a.firm} kind="firm" />
                          <Link to={`/auditors/${encodeURIComponent(a.firm)}`} className="text-muted-foreground hover:text-primary inline-flex items-center"><ArrowRight className="w-3 h-3" /></Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredAuditors.length > 300 && (
                <div className="px-4 py-3 text-xs text-muted-foreground text-center">Showing {renderLimit.toLocaleString()} of {filteredAuditors.length.toLocaleString()}</div>
              )}
            </div>
          )}
        </div>
        ) : (
        // AUDITORS GRID
        <div>
          {auditorsQ.isLoading ? (
            <div className="as-card p-8 text-center text-xs text-muted-foreground">Loading auditors…</div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredAuditors.slice(0, renderLimit).map((a) => (
                  <Link key={a.firm} to={`/auditors/${encodeURIComponent(a.firm)}`} className="as-card p-4 hover:border-primary/40 hover:bg-white/[0.025] transition-colors flex flex-col gap-3 group relative">
                    <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
                      {a.verified && (
                        <span className="text-[9.5px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Verified
                        </span>
                      )}
                      <SaveTargetButton slug={a.firm} name={a.firm} kind="firm" />
                    </div>
                    <div className="flex items-start gap-3 pr-20">
                      <BrandLogo name={a.firm} url={a.homepage_url} logo={a.logo_url} className="w-12 h-12 rounded-lg shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-base font-semibold text-white truncate group-hover:text-primary">{a.firm}</div>
                        {(a.homepage_url || a.social_x || a.social_github) && (
                          <div className="flex items-center gap-2 mt-1 text-[11px]" onClick={(e) => e.stopPropagation()}>
                            {a.homepage_url && (
                              <a
                                href={a.homepage_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary/80 hover:text-primary truncate max-w-[180px] inline-flex items-center gap-1"
                                title={a.homepage_url}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {(a.homepage_url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, ""))}
                              </a>
                            )}
                            {a.social_x && (
                              <a
                                href={`https://x.com/${a.social_x.replace(/^@/, "")}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-primary"
                                title={`@${a.social_x.replace(/^@/, "")} on X`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                X
                              </a>
                            )}
                            {a.social_github && (
                              <a
                                href={`https://github.com/${a.social_github}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-primary"
                                title={`${a.social_github} on GitHub`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                GH
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    {a.description && (
                      <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-2">{a.description}</p>
                    )}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] pt-1 border-t border-white/[0.04] mt-auto">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-muted-foreground">Total Audits:</span>
                        <span className="text-white font-bold tabular-nums">{a.audits.toLocaleString()}</span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-muted-foreground">Avg. Findings:</span>
                        <span className="text-white font-bold tabular-nums">{a.avg_findings != null ? a.avg_findings.toFixed(1) : "—"}</span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-muted-foreground">Audited Protocols:</span>
                        <span className="text-white font-bold tabular-nums">{a.clients.toLocaleString()}</span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-muted-foreground">Avg. High Sev:</span>
                        <span className="text-white font-bold tabular-nums">{a.avg_high != null ? a.avg_high.toFixed(1) : "—"}</span>
                      </div>
                    </div>
                    {a.categories.length > 0 && (
                      <div className="flex flex-wrap gap-1 -mt-1">
                        {a.categories.slice(0, 4).map((c) => (
                          <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-white/80 border border-white/[0.06]">{c}</span>
                        ))}
                        {a.categories.length > 4 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.02] text-muted-foreground">+{a.categories.length - 4} more</span>
                        )}
                      </div>
                    )}
                    <div className="text-[10px] text-primary font-medium uppercase tracking-wider pt-2 border-t border-white/[0.04]">
                      View profile →
                    </div>
                  </Link>
                ))}
              </div>
              {filteredAuditors.length > 300 && (
                <div className="px-4 py-3 text-xs text-muted-foreground text-center">Showing {renderLimit.toLocaleString()} of {filteredAuditors.length.toLocaleString()}</div>
              )}
            </>
          )}
        </div>
        )
      )}
    </div>
  );
}


function SortableTH({ label, active, onClick, className = "", align = "left" }: { label: string; active: boolean; onClick: () => void; className?: string; align?: "left" | "right" }) {
  return (
    <th className={className}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 ${align === "right" ? "ml-auto" : ""} ${active ? "text-primary" : "hover:text-white"}`}
      >
        {label}
        {active && <span className="text-[8px]">▼</span>}
      </button>
    </th>
  );
}

