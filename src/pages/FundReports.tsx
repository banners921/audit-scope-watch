import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  FileText, Shield, Users, Layers, ShieldCheck, Coins,
  Calendar, Download, Printer, ArrowRight, Skull, ExternalLink,
  TrendingUp, Building2, Network, BarChart3, Crown, ChevronDown, X,
} from "lucide-react";

/* ============================================================================
 * Report registry
 * ========================================================================= */

type Timeframe = "7d" | "30d" | "90d" | "ytd" | "1y" | "all";
const TIMEFRAMES: { id: Timeframe; label: string }[] = [
  { id: "7d", label: "Last 7d" },
  { id: "30d", label: "Last 30d" },
  { id: "90d", label: "Last 90d" },
  { id: "ytd", label: "YTD" },
  { id: "1y", label: "Last 12 mo" },
  { id: "all", label: "All time" },
];

function tfStart(tf: Timeframe): string {
  const now = new Date();
  if (tf === "7d") return new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  if (tf === "30d") return new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  if (tf === "90d") return new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10);
  if (tf === "ytd") return `${now.getFullYear()}-01-01`;
  if (tf === "1y") return new Date(now.getTime() - 365 * 86400000).toISOString().slice(0, 10);
  return "2018-01-01";
}

type ReportGroup = "portfolio" | "network" | "category" | "fund_profile" | "market";

type ReportDef = {
  id: string;
  group: ReportGroup;
  title: string;
  blurb: string;
  icon: React.ComponentType<any>;
  status: "live" | "template";
  liveHref?: string;
  needs: { fund?: "single" | "multi"; category?: "multi"; targetFund?: boolean };
};

const REPORTS: ReportDef[] = [
  // ---------- PORTFOLIO (your fund) ----------
  { id: "lp",         group: "portfolio", title: "LP Report",                 blurb: "Quarterly memo for limited partners — returns, exposure, key wins/losses, risk highlights.", icon: FileText,    status: "live",     liveHref: "/lp-report", needs: { fund: "single" } },
  { id: "risk",       group: "portfolio", title: "Risk Report",               blurb: "Portfolio-wide risk overview: hack exposure, audit cadence, single-firm coverage, oracle dependencies.", icon: Shield,    status: "template", needs: { fund: "single" } },
  { id: "quarterly",  group: "portfolio", title: "Quarterly Review",          blurb: "This quarter — new positions, follow-ons, exits, funding rounds, audits, incidents, talent.", icon: Calendar,   status: "template", needs: { fund: "single" } },
  { id: "audit",      group: "portfolio", title: "Audit Coverage",            blurb: "Which portcos are due, cadence trend, finding severity over time.",                   icon: ShieldCheck, status: "template", needs: { fund: "single" } },
  { id: "hack",       group: "portfolio", title: "Hack Watch",                blurb: "Every incident in the portfolio: date, amount, root cause, recovery.",                icon: Skull,        status: "template", needs: { fund: "single" } },
  { id: "unlocks",    group: "portfolio", title: "Token Unlock Calendar",     blurb: "Upcoming dilution events across the book — cliff dates, supply %, market cap impact.", icon: Coins,        status: "template", needs: { fund: "single" } },

  // ---------- NETWORK / CO-INVESTORS ----------
  { id: "coinvestor", group: "network",   title: "Co-Investor Analysis",      blurb: "Who's been co-investing alongside you. Frequency, sector overlap, recency.",          icon: Users,       status: "live",     needs: { fund: "multi" } },
  { id: "fund_compare", group: "network", title: "Fund Comparison",           blurb: "Side-by-side metrics for the funds you select: deal count, sectors, recency, overlap.", icon: BarChart3,  status: "live",     needs: { fund: "multi" } },

  // ---------- CATEGORY OVERVIEWS ----------
  { id: "category_overview", group: "category", title: "Category Overview",   blurb: "Pick one or more categories — top companies, funding velocity, audit coverage, hacks.", icon: Layers,      status: "live",     needs: { category: "multi" } },
  { id: "sector",     group: "category", title: "Sector Exposure",            blurb: "Your portfolio concentration by category, chain, and stage. Detect single-bucket risk.", icon: Network,     status: "template", needs: { fund: "single" } },

  // ---------- FUND PROFILES ----------
  { id: "fund_profile", group: "fund_profile", title: "Fund Profile",         blurb: "Deep profile of any single fund — portfolio, sector mix, recent activity, lead/follower split.", icon: Building2, status: "live",     needs: { targetFund: true } },
  { id: "most_active",  group: "fund_profile", title: "Most Active Funds",    blurb: "Top funds by deal count in the selected timeframe. Includes their sector mix and recent rounds.", icon: Crown,    status: "live",     needs: {} },

  // ---------- MARKET-WIDE ----------
  { id: "funding_recap", group: "market", title: "Funding Round Recap",      blurb: "Every round in timeframe (filtered by category). Aggregate volume, top investors, leaderboards.", icon: TrendingUp, status: "live", needs: { category: "multi" } },
];

const GROUP_LABELS: Record<ReportGroup, string> = {
  portfolio:    "Portfolio (Your Fund)",
  network:      "Network & Co-Investors",
  category:     "Category Overviews",
  fund_profile: "Fund Profiles",
  market:       "Market-Wide",
};

const GROUP_ORDER: ReportGroup[] = ["portfolio", "network", "category", "fund_profile", "market"];

/* ============================================================================
 * Page
 * ========================================================================= */

export default function FundReports() {
  const [tf, setTf] = useState<Timeframe>("90d");
  const [activeReportId, setActiveReportId] = useState<string>("coinvestor");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Fund selection state (for the user's fund + cross-fund picks)
  const [primaryFundSlug, setPrimaryFundSlug] = useState<string | null>(null);
  const [pickedFunds, setPickedFunds] = useState<string[]>([]); // for "multi" needs
  const [targetFund, setTargetFund] = useState<string | null>(null); // for fund_profile
  const [pickedCategories, setPickedCategories] = useState<string[]>([]);

  // Hydrate primary fund from user profile
  useQuery({
    queryKey: ["fr-user-profile"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from("user_profiles").select("fund_slug").eq("user_id", user.id).maybeSingle();
      if (data?.fund_slug && !primaryFundSlug) {
        setPrimaryFundSlug(data.fund_slug);
        if (pickedFunds.length === 0) setPickedFunds([data.fund_slug]);
      }
      return data;
    },
  });

  const activeDef = useMemo(() => REPORTS.find(r => r.id === activeReportId), [activeReportId]);

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight">Reports</h1>
            <p className="text-[11px] text-muted-foreground mt-1">
              Automated analyst work. Pick a report, set filters — co-investor matrices, fund profiles, category overviews, market recaps. Every "live" report queries real data; no spreadsheets, no manual pulls.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/reports/custom" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1.5 px-2 py-1 rounded hover:bg-primary/[0.06]">
            Custom AI report <ArrowRight className="w-3 h-3" />
          </Link>
          <button className="text-[11px] text-muted-foreground hover:text-white inline-flex items-center gap-1.5 px-2 py-1 rounded hover:bg-white/[0.04]"><Printer className="w-3.5 h-3.5" /> Print</button>
          <button className="text-[11px] text-muted-foreground hover:text-white inline-flex items-center gap-1.5 px-2 py-1 rounded hover:bg-white/[0.04]"><Download className="w-3.5 h-3.5" /> Export PDF</button>
        </div>
      </div>

      {/* Report picker — big dropdown */}
      <div className="as-card p-4 space-y-3">
        <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-muted-foreground">Report type</div>
        <ReportDropdown
          value={activeReportId}
          onChange={(id) => { setActiveReportId(id); setDropdownOpen(false); }}
          open={dropdownOpen}
          setOpen={setDropdownOpen}
        />
        {activeDef && (
          <p className="text-[11.5px] text-muted-foreground leading-relaxed">{activeDef.blurb}</p>
        )}
      </div>

      {/* Filter bar — dynamic per report */}
      <div className="as-card p-4 space-y-3">
        <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-muted-foreground">Filters</div>
        <div className="flex flex-wrap gap-3 items-start">
          <TimeframePicker tf={tf} setTf={setTf} />
          {activeDef?.needs.fund === "single" && (
            <SingleFundPicker
              slug={primaryFundSlug}
              setSlug={setPrimaryFundSlug}
              label="Your fund"
            />
          )}
          {activeDef?.needs.fund === "multi" && (
            <MultiFundPicker
              slugs={pickedFunds}
              setSlugs={setPickedFunds}
              label="Funds in scope"
            />
          )}
          {activeDef?.needs.targetFund && (
            <SingleFundPicker
              slug={targetFund}
              setSlug={setTargetFund}
              label="Fund to profile"
            />
          )}
          {activeDef?.needs.category === "multi" && (
            <MultiCategoryPicker
              picked={pickedCategories}
              setPicked={setPickedCategories}
              label="Categories"
            />
          )}
        </div>
      </div>

      {/* Report body */}
      {activeDef && (
        <div className="as-card p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
            <div className="flex items-center gap-2.5">
              <activeDef.icon className="w-5 h-5 text-primary" />
              <h2 className="text-base font-semibold text-white">{activeDef.title}</h2>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground border border-white/[0.06] rounded px-1.5 py-0.5">{TIMEFRAMES.find(t => t.id === tf)?.label}</span>
              <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full ${activeDef.status === "live" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" : "bg-white/[0.05] text-muted-foreground border border-white/[0.06]"}`}>{activeDef.status}</span>
            </div>
            {activeDef.liveHref && (
              <Link to={activeDef.liveHref} className="text-[11px] text-primary hover:underline inline-flex items-center gap-1.5">
                Open full <ExternalLink className="w-3 h-3" />
              </Link>
            )}
          </div>

          {/* LIVE bodies */}
          {activeDef.id === "lp" && <LpStub liveHref={activeDef.liveHref!} />}
          {activeDef.id === "coinvestor" && <CoInvestorLive tf={tf} fundSlugs={pickedFunds} />}
          {activeDef.id === "fund_compare" && <FundCompareLive tf={tf} fundSlugs={pickedFunds} />}
          {activeDef.id === "category_overview" && <CategoryOverviewLive tf={tf} categories={pickedCategories} />}
          {activeDef.id === "fund_profile" && <FundProfileLive tf={tf} fundSlug={targetFund} />}
          {activeDef.id === "most_active" && <MostActiveFundsLive tf={tf} />}
          {activeDef.id === "funding_recap" && <FundingRecapLive tf={tf} categories={pickedCategories} />}

          {/* TEMPLATE bodies (unchanged) */}
          {activeDef.id === "risk" && <RiskReportTemplate tf={tf} />}
          {activeDef.id === "quarterly" && <QuarterlyTemplate tf={tf} />}
          {activeDef.id === "sector" && <SectorTemplate tf={tf} />}
          {activeDef.id === "hack" && <HackWatchTemplate tf={tf} />}
          {activeDef.id === "audit" && <AuditCoverageTemplate tf={tf} />}
          {activeDef.id === "unlocks" && <UnlocksTemplate tf={tf} />}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * Picker components
 * ========================================================================= */

function ReportDropdown({ value, onChange, open, setOpen }: { value: string; onChange: (id: string) => void; open: boolean; setOpen: (b: boolean) => void }) {
  const current = REPORTS.find(r => r.id === value);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-md border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] hover:border-primary/30 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          {current?.icon && <current.icon className="w-4.5 h-4.5 text-primary" />}
          <div className="text-left">
            <div className="text-[13.5px] font-semibold text-white">{current?.title || "Select report"}</div>
            <div className="text-[10.5px] text-muted-foreground">{current ? GROUP_LABELS[current.group] : "—"}</div>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 left-0 right-0 mt-1 rounded-md border border-white/[0.08] bg-[hsl(var(--background))] shadow-xl overflow-hidden max-h-[480px] overflow-y-auto">
            {GROUP_ORDER.map(g => (
              <div key={g}>
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] font-bold text-muted-foreground bg-white/[0.02] border-b border-white/[0.04]">{GROUP_LABELS[g]}</div>
                {REPORTS.filter(r => r.group === g).map(r => {
                  const Icon = r.icon;
                  const isActive = r.id === value;
                  return (
                    <button
                      key={r.id}
                      onClick={() => onChange(r.id)}
                      className={`w-full text-left flex items-start gap-2.5 px-3 py-2.5 hover:bg-white/[0.03] ${isActive ? "bg-primary/[0.06]" : ""} border-b border-white/[0.04] last:border-b-0`}
                    >
                      <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[12.5px] font-medium ${isActive ? "text-primary" : "text-white"}`}>{r.title}</span>
                          {r.status === "live" && <span className="text-[9px] uppercase tracking-wider text-emerald-300/80">live</span>}
                        </div>
                        <div className="text-[10.5px] text-muted-foreground line-clamp-2">{r.blurb}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TimeframePicker({ tf, setTf }: { tf: Timeframe; setTf: (t: Timeframe) => void }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Timeframe</div>
      <div className="inline-flex rounded-md bg-white/[0.03] border border-white/[0.06] p-0.5">
        {TIMEFRAMES.map(t => (
          <button
            key={t.id}
            onClick={() => setTf(t.id)}
            className={`px-2.5 py-1.5 rounded text-[11px] ${tf === t.id ? "bg-primary/20 text-primary font-medium" : "text-muted-foreground hover:text-white"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SingleFundPicker({ slug, setSlug, label }: { slug: string | null; setSlug: (s: string | null) => void; label: string }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const results = useQuery({
    queryKey: ["fund-search-single", query],
    queryFn: async () => {
      if (query.trim().length < 2) return [];
      const { data } = await supabase.from("funds").select("slug,name,investment_count").ilike("name", `%${query}%`).order("investment_count", { ascending: false, nullsFirst: false }).limit(20);
      return (data ?? []) as Array<{ slug: string; name: string; investment_count: number | null }>;
    },
  });
  const currentName = useQuery({
    queryKey: ["fund-name", slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data } = await supabase.from("funds").select("name").eq("slug", slug!).maybeSingle();
      return data?.name ?? slug;
    },
  });
  return (
    <div className="min-w-[260px]">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{label}</div>
      {slug ? (
        <div className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 pl-2.5 pr-1 py-1.5">
          <span className="text-[12px] text-white">{currentName.data || slug}</span>
          <button onClick={() => setSlug(null)} className="text-muted-foreground hover:text-rose-300"><X className="w-3 h-3" /></button>
        </div>
      ) : (
        <div className="relative">
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Search fund name…"
            className="w-full as-input text-[12px] py-1.5 px-2"
          />
          {open && (results.data?.length ?? 0) > 0 && (
            <div className="absolute left-0 right-0 mt-1 rounded-md border border-white/[0.08] bg-[hsl(var(--background))] shadow-xl max-h-[260px] overflow-y-auto z-30">
              {(results.data ?? []).map(f => (
                <button
                  key={f.slug}
                  onClick={() => { setSlug(f.slug); setQuery(""); setOpen(false); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-white/[0.04] text-[12px] text-white flex items-center justify-between"
                >
                  <span>{f.name}</span>
                  {f.investment_count != null && <span className="text-[10px] text-muted-foreground">{f.investment_count} deals</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MultiFundPicker({ slugs, setSlugs, label }: { slugs: string[]; setSlugs: (s: string[]) => void; label: string }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const results = useQuery({
    queryKey: ["fund-search-multi", query],
    queryFn: async () => {
      if (query.trim().length < 2) return [];
      const { data } = await supabase.from("funds").select("slug,name,investment_count").ilike("name", `%${query}%`).order("investment_count", { ascending: false, nullsFirst: false }).limit(20);
      return (data ?? []) as Array<{ slug: string; name: string; investment_count: number | null }>;
    },
  });
  const names = useQuery({
    queryKey: ["fund-names", slugs.join(",")],
    enabled: slugs.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("funds").select("slug,name").in("slug", slugs);
      const m: Record<string, string> = {};
      for (const r of (data ?? []) as any[]) m[r.slug] = r.name;
      return m;
    },
  });
  return (
    <div className="min-w-[320px] flex-1 max-w-[600px]">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{label} <span className="text-muted-foreground/60">({slugs.length})</span></div>
      <div className="space-y-1.5">
        {slugs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {slugs.map(s => (
              <span key={s} className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 pl-2 pr-1 py-0.5 text-[11.5px] text-white">
                {names.data?.[s] || s}
                <button onClick={() => setSlugs(slugs.filter(x => x !== s))} className="text-muted-foreground hover:text-rose-300"><X className="w-2.5 h-2.5" /></button>
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={slugs.length === 0 ? "Search funds to add…" : "Add another fund…"}
            className="w-full as-input text-[12px] py-1.5 px-2"
          />
          {open && (results.data?.length ?? 0) > 0 && (
            <div className="absolute left-0 right-0 mt-1 rounded-md border border-white/[0.08] bg-[hsl(var(--background))] shadow-xl max-h-[260px] overflow-y-auto z-30">
              {(results.data ?? []).filter(f => !slugs.includes(f.slug)).map(f => (
                <button
                  key={f.slug}
                  onClick={() => { setSlugs([...slugs, f.slug]); setQuery(""); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-white/[0.04] text-[12px] text-white flex items-center justify-between"
                >
                  <span>{f.name}</span>
                  {f.investment_count != null && <span className="text-[10px] text-muted-foreground">{f.investment_count} deals</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MultiCategoryPicker({ picked, setPicked, label }: { picked: string[]; setPicked: (c: string[]) => void; label: string }) {
  const allCats = useQuery({
    queryKey: ["all-categories"],
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("category").not("category", "is", null).limit(2000);
      const set = new Set<string>();
      for (const r of (data ?? []) as any[]) if (r.category) set.add(r.category);
      return Array.from(set).sort();
    },
  });
  return (
    <div className="min-w-[320px] flex-1 max-w-[600px]">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{label} <span className="text-muted-foreground/60">({picked.length})</span></div>
      <div className="flex flex-wrap gap-1.5 max-h-[110px] overflow-y-auto">
        {(allCats.data ?? []).map(c => {
          const on = picked.includes(c);
          return (
            <button
              key={c}
              onClick={() => setPicked(on ? picked.filter(x => x !== c) : [...picked, c])}
              className={`text-[11px] px-2 py-0.5 rounded-md border ${on ? "bg-primary/15 text-primary border-primary/40" : "bg-white/[0.02] text-muted-foreground border-white/[0.06] hover:text-white"}`}
            >
              {c}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================================
 * LIVE report bodies
 * ========================================================================= */

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] text-muted-foreground py-8 text-center border border-dashed border-white/[0.06] rounded">{children}</div>;
}

function LpStub({ liveHref }: { liveHref: string }) {
  return (
    <div className="text-[12.5px] text-muted-foreground space-y-3">
      <p>The LP Report has its own full-page render with real fund data.</p>
      <Link to={liveHref} className="inline-flex items-center gap-1.5 text-primary hover:underline">
        Open LP Report <ArrowRight className="w-3 h-3" />
      </Link>
    </div>
  );
}

/* --- Co-Investor Analysis (real data) --- */

function CoInvestorLive({ tf, fundSlugs }: { tf: Timeframe; fundSlugs: string[] }) {
  const data = useQuery({
    queryKey: ["coinvestor-live", tf, fundSlugs.sort().join(",")],
    enabled: fundSlugs.length > 0,
    queryFn: async () => {
      const since = tfStart(tf);
      const { data: portfolio } = await supabase
        .from("fund_portfolio")
        .select("fund_slug,company_slug,round_date")
        .in("fund_slug", fundSlugs)
        .gte("round_date", since);
      const portfolioBySlug = new Map<string, Set<string>>();
      for (const r of (portfolio ?? []) as any[]) {
        if (!portfolioBySlug.has(r.company_slug)) portfolioBySlug.set(r.company_slug, new Set());
        portfolioBySlug.get(r.company_slug)!.add(r.fund_slug);
      }
      const companySlugs = Array.from(portfolioBySlug.keys());
      if (companySlugs.length === 0) return { coinvestors: [], total_deals: 0, unique_companies: 0 };
      const { data: rounds } = await supabase
        .from("funding_rounds")
        .select("company_slug,all_investors,date,category")
        .in("company_slug", companySlugs);
      const coinvestorCounts = new Map<string, { name: string; shared_deals: number; companies: Set<string>; sectors: Set<string> }>();
      const ourFundNames = new Set(fundSlugs.map(s => s.toLowerCase().replace(/-/g, " ")));
      for (const r of (rounds ?? []) as any[]) {
        const investorStr = r.all_investors || "";
        if (!investorStr) continue;
        const investors = String(investorStr).split(/[,;|]+/).map(s => s.trim()).filter(Boolean);
        for (const inv of investors) {
          const key = inv.toLowerCase();
          if (ourFundNames.has(key)) continue;
          if (!coinvestorCounts.has(key)) coinvestorCounts.set(key, { name: inv, shared_deals: 0, companies: new Set(), sectors: new Set() });
          const e = coinvestorCounts.get(key)!;
          e.shared_deals++;
          e.companies.add(r.company_slug);
          if (r.category) e.sectors.add(r.category);
        }
      }
      const ranked = Array.from(coinvestorCounts.values())
        .map(e => ({ name: e.name, shared_deals: e.shared_deals, companies: e.companies.size, sectors: Array.from(e.sectors).slice(0, 4) }))
        .sort((a, b) => b.companies - a.companies)
        .slice(0, 30);
      return { coinvestors: ranked, total_deals: rounds?.length || 0, unique_companies: companySlugs.length };
    },
  });

  if (fundSlugs.length === 0) return <EmptyState>Pick at least one fund above to see co-investors.</EmptyState>;
  if (data.isLoading) return <EmptyState>Computing co-investor matrix…</EmptyState>;
  const d = data.data;
  if (!d || d.coinvestors.length === 0) return <EmptyState>No co-investors found in this timeframe for the selected funds.</EmptyState>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi label="Unique co-investors" value={String(d.coinvestors.length)} />
        <Kpi label="Companies in scope" value={String(d.unique_companies)} sub="portfolio overlap" />
        <Kpi label="Top co-investor" value={d.coinvestors[0]?.name || "—"} sub={`${d.coinvestors[0]?.companies} shared`} />
        <Kpi label="Funding rounds analyzed" value={String(d.total_deals)} />
      </div>
      <TemplateSection title="Top 30 co-investors" hint={`Across ${fundSlugs.length} selected fund${fundSlugs.length > 1 ? "s" : ""}`}>
        <table className="w-full text-[12px]">
          <thead><tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="text-left py-1.5">Co-Investor</th>
            <th className="text-right">Shared Companies</th>
            <th className="text-right">Round Appearances</th>
            <th className="text-left pl-3">Sectors</th>
          </tr></thead>
          <tbody className="text-white/85">
            {d.coinvestors.map(c => (
              <tr key={c.name} className="border-t border-white/[0.04]">
                <td className="py-1.5 font-medium">{c.name}</td>
                <td className="text-right tabular-nums">{c.companies}</td>
                <td className="text-right tabular-nums text-muted-foreground">{c.shared_deals}</td>
                <td className="pl-3 text-muted-foreground text-[11px]">{c.sectors.join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TemplateSection>
    </div>
  );
}

/* --- Fund Comparison (real data) --- */

function FundCompareLive({ tf, fundSlugs }: { tf: Timeframe; fundSlugs: string[] }) {
  const data = useQuery({
    queryKey: ["fund-compare", tf, fundSlugs.sort().join(",")],
    enabled: fundSlugs.length >= 2,
    queryFn: async () => {
      const since = tfStart(tf);
      const [funds, portfolio] = await Promise.all([
        supabase.from("funds").select("slug,name,investment_count,website").in("slug", fundSlugs),
        supabase.from("fund_portfolio").select("fund_slug,company_slug,category,amount_usd,round_date").in("fund_slug", fundSlugs).gte("round_date", since),
      ]);
      const fundMap = new Map<string, { slug: string; name: string; total_deals: number; categories: Map<string, number>; total_amount: number; recent_companies: Set<string> }>();
      for (const f of (funds.data ?? []) as any[]) {
        fundMap.set(f.slug, { slug: f.slug, name: f.name, total_deals: 0, categories: new Map(), total_amount: 0, recent_companies: new Set() });
      }
      for (const r of (portfolio.data ?? []) as any[]) {
        const e = fundMap.get(r.fund_slug);
        if (!e) continue;
        e.total_deals++;
        e.recent_companies.add(r.company_slug);
        if (r.amount_usd) e.total_amount += Number(r.amount_usd);
        if (r.category) e.categories.set(r.category, (e.categories.get(r.category) || 0) + 1);
      }
      return Array.from(fundMap.values()).map(e => ({
        slug: e.slug,
        name: e.name,
        deals_in_tf: e.total_deals,
        unique_companies: e.recent_companies.size,
        total_amount_usd: e.total_amount,
        top_categories: Array.from(e.categories.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3),
      }));
    },
  });

  if (fundSlugs.length < 2) return <EmptyState>Pick at least 2 funds above to compare.</EmptyState>;
  if (data.isLoading) return <EmptyState>Computing comparison…</EmptyState>;
  const rows = data.data ?? [];

  return (
    <div className="space-y-4">
      <TemplateSection title="Side-by-side metrics">
        <table className="w-full text-[12px]">
          <thead><tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="text-left py-1.5">Fund</th>
            <th className="text-right">Deals (in TF)</th>
            <th className="text-right">Unique Companies</th>
            <th className="text-right">Capital Deployed</th>
            <th className="text-left pl-3">Top Categories</th>
          </tr></thead>
          <tbody className="text-white/85">
            {rows.map(r => (
              <tr key={r.slug} className="border-t border-white/[0.04]">
                <td className="py-1.5 font-medium">
                  <Link to={`/funds/${r.slug}`} className="hover:text-primary">{r.name}</Link>
                </td>
                <td className="text-right tabular-nums">{r.deals_in_tf}</td>
                <td className="text-right tabular-nums">{r.unique_companies}</td>
                <td className="text-right tabular-nums text-muted-foreground">{r.total_amount_usd ? `$${(r.total_amount_usd / 1e6).toFixed(1)}M` : "—"}</td>
                <td className="pl-3 text-muted-foreground text-[11px]">{r.top_categories.map(([c, n]) => `${c} (${n})`).join(" · ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TemplateSection>
    </div>
  );
}

/* --- Category Overview (real data) --- */

function CategoryOverviewLive({ tf, categories }: { tf: Timeframe; categories: string[] }) {
  const data = useQuery({
    queryKey: ["category-overview", tf, categories.sort().join(",")],
    enabled: categories.length > 0,
    queryFn: async () => {
      const since = tfStart(tf);
      const [companies, rounds, hacks, audits] = await Promise.all([
        supabase.from("companies").select("slug,name,category,total_raised_usd,audit_count,last_audit_date,has_been_hacked,logo").in("category", categories).limit(500),
        supabase.from("funding_rounds").select("company_slug,amount_usd,date,round_type,category").in("category", categories).gte("date", since),
        supabase.from("hacks").select("company_slug,name,date,amount_usd").gte("date", since),
        supabase.from("audit_history").select("company_slug,audit_date,audit_firm").gte("audit_date", since),
      ]);
      const cmps = (companies.data ?? []) as any[];
      const rds = (rounds.data ?? []) as any[];
      const hks = (hacks.data ?? []) as any[];
      const ads = (audits.data ?? []) as any[];
      const cmpSlugs = new Set(cmps.map(c => c.slug));
      const totalRaisedTf = rds.reduce((acc, r) => acc + (Number(r.amount_usd) || 0), 0);
      const hacksInScope = hks.filter(h => cmpSlugs.has(h.company_slug));
      const auditsInScope = ads.filter(a => cmpSlugs.has(a.company_slug));
      const topRaised = cmps.slice().sort((a, b) => (b.total_raised_usd || 0) - (a.total_raised_usd || 0)).slice(0, 15);
      return {
        company_count: cmps.length,
        rounds_in_tf: rds.length,
        capital_deployed: totalRaisedTf,
        hacks_in_tf: hacksInScope.length,
        audits_in_tf: auditsInScope.length,
        top_companies: topRaised,
        hacks_list: hacksInScope.slice(0, 8),
      };
    },
  });

  if (categories.length === 0) return <EmptyState>Pick at least one category above to see the overview.</EmptyState>;
  if (data.isLoading) return <EmptyState>Computing category overview…</EmptyState>;
  const d = data.data;
  if (!d) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Kpi label="Companies in scope" value={String(d.company_count)} sub={categories.join(" + ")} />
        <Kpi label="Rounds (TF)" value={String(d.rounds_in_tf)} />
        <Kpi label="Capital deployed" value={`$${(d.capital_deployed / 1e6).toFixed(0)}M`} />
        <Kpi label="Audits completed" value={String(d.audits_in_tf)} tone="good" />
        <Kpi label="Hacks" value={String(d.hacks_in_tf)} tone={d.hacks_in_tf > 0 ? "alert" : "good"} />
      </div>
      <TemplateSection title="Top 15 by total raised">
        <table className="w-full text-[12px]">
          <thead><tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="text-left py-1.5">Company</th>
            <th className="text-left">Category</th>
            <th className="text-right">Total raised</th>
            <th className="text-right">Audits</th>
            <th className="text-left pl-2">Last audit</th>
            <th className="text-right">Hacked?</th>
          </tr></thead>
          <tbody className="text-white/85">
            {d.top_companies.map((c: any) => (
              <tr key={c.slug} className="border-t border-white/[0.04]">
                <td className="py-1.5 font-medium"><Link to={`/protocol/${c.slug}`} className="hover:text-primary">{c.name}</Link></td>
                <td className="text-muted-foreground">{c.category}</td>
                <td className="text-right tabular-nums">{c.total_raised_usd ? `$${(c.total_raised_usd / 1e6).toFixed(1)}M` : "—"}</td>
                <td className="text-right tabular-nums">{c.audit_count || 0}</td>
                <td className="pl-2 text-muted-foreground">{c.last_audit_date || "—"}</td>
                <td className="text-right">{c.has_been_hacked ? <span className="text-rose-300">yes</span> : <span className="text-muted-foreground/60">no</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TemplateSection>
      {d.hacks_list.length > 0 && (
        <TemplateSection title="Hacks in timeframe">
          <table className="w-full text-[12px]">
            <thead><tr className="text-[10px] uppercase tracking-wider text-muted-foreground"><th className="text-left py-1.5">Protocol</th><th className="text-left">Date</th><th className="text-right">Amount</th></tr></thead>
            <tbody className="text-white/85">
              {d.hacks_list.map((h: any, i: number) => (
                <tr key={i} className="border-t border-white/[0.04]">
                  <td className="py-1.5"><Link to={`/protocol/${h.company_slug}`} className="hover:text-primary">{h.name || h.company_slug}</Link></td>
                  <td className="text-muted-foreground">{h.date}</td>
                  <td className="text-right tabular-nums text-rose-300/80">{h.amount_usd ? `$${(h.amount_usd / 1e6).toFixed(1)}M` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TemplateSection>
      )}
    </div>
  );
}

/* --- Fund Profile (real data) --- */

function FundProfileLive({ tf, fundSlug }: { tf: Timeframe; fundSlug: string | null }) {
  const data = useQuery({
    queryKey: ["fund-profile", tf, fundSlug],
    enabled: !!fundSlug,
    queryFn: async () => {
      const since = tfStart(tf);
      const [fund, allPortfolio, tfPortfolio] = await Promise.all([
        supabase.from("funds").select("name,description,website,twitter,linkedin,investment_count,logo").eq("slug", fundSlug!).maybeSingle(),
        supabase.from("fund_portfolio").select("company_slug,company_name,category,round_type,amount_usd,round_date").eq("fund_slug", fundSlug!),
        supabase.from("fund_portfolio").select("company_slug,company_name,category,round_type,amount_usd,round_date").eq("fund_slug", fundSlug!).gte("round_date", since),
      ]);
      const all = (allPortfolio.data ?? []) as any[];
      const tfRows = (tfPortfolio.data ?? []) as any[];
      const cats = new Map<string, number>();
      for (const r of all) if (r.category) cats.set(r.category, (cats.get(r.category) || 0) + 1);
      const categoryMix = Array.from(cats.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
      return {
        fund: fund.data,
        all_deals: all.length,
        tf_deals: tfRows.length,
        tf_capital: tfRows.reduce((acc, r) => acc + (Number(r.amount_usd) || 0), 0),
        category_mix: categoryMix,
        recent: tfRows.sort((a, b) => (b.round_date || "").localeCompare(a.round_date || "")).slice(0, 20),
      };
    },
  });

  if (!fundSlug) return <EmptyState>Pick a fund above to see its profile.</EmptyState>;
  if (data.isLoading) return <EmptyState>Loading fund profile…</EmptyState>;
  const d = data.data;
  if (!d?.fund) return <EmptyState>Fund not found.</EmptyState>;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 pb-3 border-b border-white/[0.04]">
        {d.fund.logo && <img src={d.fund.logo} alt="" className="w-12 h-12 rounded-md border border-white/[0.06] object-cover" />}
        <div className="flex-1">
          <div className="text-base font-semibold text-white">{d.fund.name}</div>
          {d.fund.description && <p className="text-[11.5px] text-muted-foreground mt-1 line-clamp-2">{d.fund.description}</p>}
          <div className="flex gap-3 mt-1.5 text-[11px]">
            {d.fund.website && <a href={d.fund.website} target="_blank" rel="noreferrer" className="text-primary hover:underline">website</a>}
            {d.fund.twitter && <a href={`https://x.com/${d.fund.twitter}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">x</a>}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi label="Total investments" value={String(d.fund.investment_count || d.all_deals)} />
        <Kpi label="Deals in TF" value={String(d.tf_deals)} />
        <Kpi label="Capital in TF" value={`$${(d.tf_capital / 1e6).toFixed(1)}M`} />
        <Kpi label="Categories covered" value={String(d.category_mix.length)} />
      </div>
      <TemplateSection title="Category mix" hint="all-time portfolio">
        <div className="space-y-1.5">
          {d.category_mix.map(([c, n]: [string, number]) => (
            <div key={c} className="flex items-center gap-3 text-[12px]">
              <span className="w-32 text-white">{c}</span>
              <div className="flex-1 h-2 bg-white/[0.04] rounded overflow-hidden">
                <div className="h-full bg-primary/60" style={{ width: `${(n / d.all_deals) * 100}%` }} />
              </div>
              <span className="w-10 text-right tabular-nums text-muted-foreground">{n}</span>
            </div>
          ))}
        </div>
      </TemplateSection>
      <TemplateSection title="Recent deals (in timeframe)">
        <table className="w-full text-[12px]">
          <thead><tr className="text-[10px] uppercase tracking-wider text-muted-foreground"><th className="text-left py-1.5">Company</th><th className="text-left">Category</th><th className="text-left">Round</th><th className="text-right">Amount</th><th className="text-left pl-2">Date</th></tr></thead>
          <tbody className="text-white/85">
            {d.recent.map((r: any, i: number) => (
              <tr key={i} className="border-t border-white/[0.04]">
                <td className="py-1.5"><Link to={`/protocol/${r.company_slug}`} className="hover:text-primary">{r.company_name || r.company_slug}</Link></td>
                <td className="text-muted-foreground">{r.category || "—"}</td>
                <td className="text-muted-foreground">{r.round_type || "—"}</td>
                <td className="text-right tabular-nums">{r.amount_usd ? `$${(r.amount_usd / 1e6).toFixed(1)}M` : "—"}</td>
                <td className="pl-2 text-muted-foreground">{r.round_date || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TemplateSection>
    </div>
  );
}

/* --- Most Active Funds (real data) --- */

function MostActiveFundsLive({ tf }: { tf: Timeframe }) {
  const data = useQuery({
    queryKey: ["most-active-funds", tf],
    queryFn: async () => {
      const since = tfStart(tf);
      const { data: rows } = await supabase
        .from("fund_portfolio")
        .select("fund_slug,company_slug,category,round_date,amount_usd")
        .gte("round_date", since);
      const m = new Map<string, { deals: number; companies: Set<string>; cats: Map<string, number>; amount: number }>();
      for (const r of (rows ?? []) as any[]) {
        if (!m.has(r.fund_slug)) m.set(r.fund_slug, { deals: 0, companies: new Set(), cats: new Map(), amount: 0 });
        const e = m.get(r.fund_slug)!;
        e.deals++;
        e.companies.add(r.company_slug);
        if (r.amount_usd) e.amount += Number(r.amount_usd);
        if (r.category) e.cats.set(r.category, (e.cats.get(r.category) || 0) + 1);
      }
      const top = Array.from(m.entries()).sort((a, b) => b[1].deals - a[1].deals).slice(0, 40);
      const slugs = top.map(t => t[0]);
      const { data: funds } = await supabase.from("funds").select("slug,name,logo").in("slug", slugs);
      const nameMap = new Map<string, { name: string; logo: string | null }>();
      for (const f of (funds ?? []) as any[]) nameMap.set(f.slug, { name: f.name, logo: f.logo });
      return top.map(([slug, e]) => ({
        slug,
        name: nameMap.get(slug)?.name || slug,
        logo: nameMap.get(slug)?.logo,
        deals: e.deals,
        unique_companies: e.companies.size,
        capital: e.amount,
        top_cat: Array.from(e.cats.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "—",
      }));
    },
  });
  if (data.isLoading) return <EmptyState>Computing most active funds…</EmptyState>;
  const rows = data.data ?? [];
  return (
    <TemplateSection title={`Top 40 most active funds — ${TIMEFRAMES.find(t => t.id === tf)?.label}`}>
      <table className="w-full text-[12px]">
        <thead><tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
          <th className="text-left py-1.5">#</th>
          <th className="text-left">Fund</th>
          <th className="text-right">Deals</th>
          <th className="text-right">Companies</th>
          <th className="text-right">Capital</th>
          <th className="text-left pl-2">Top Category</th>
        </tr></thead>
        <tbody className="text-white/85">
          {rows.map((r, i) => (
            <tr key={r.slug} className="border-t border-white/[0.04]">
              <td className="py-1.5 text-muted-foreground tabular-nums">{i + 1}</td>
              <td>
                <Link to={`/funds/${r.slug}`} className="hover:text-primary font-medium">{r.name}</Link>
              </td>
              <td className="text-right tabular-nums">{r.deals}</td>
              <td className="text-right tabular-nums text-muted-foreground">{r.unique_companies}</td>
              <td className="text-right tabular-nums">{r.capital ? `$${(r.capital / 1e6).toFixed(1)}M` : "—"}</td>
              <td className="pl-2 text-muted-foreground">{r.top_cat}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TemplateSection>
  );
}

/* --- Funding Round Recap (real data) --- */

function FundingRecapLive({ tf, categories }: { tf: Timeframe; categories: string[] }) {
  const data = useQuery({
    queryKey: ["funding-recap", tf, categories.sort().join(",")],
    queryFn: async () => {
      const since = tfStart(tf);
      let q = supabase.from("funding_rounds").select("company_slug,company_name,category,amount_usd,date,round_type,lead_investors,all_investors,announcement_url").gte("date", since);
      if (categories.length > 0) q = q.in("category", categories);
      const { data } = await q.order("date", { ascending: false }).limit(500);
      const rows = (data ?? []) as any[];
      const investorCounts = new Map<string, number>();
      for (const r of rows) {
        const all = String(r.all_investors || "").split(/[,;|]+/).map(s => s.trim()).filter(Boolean);
        for (const inv of all) investorCounts.set(inv, (investorCounts.get(inv) || 0) + 1);
      }
      const topInvestors = Array.from(investorCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15);
      const total = rows.reduce((acc, r) => acc + (Number(r.amount_usd) || 0), 0);
      const byCat = new Map<string, { count: number; amount: number }>();
      for (const r of rows) {
        const cat = r.category || "uncategorized";
        if (!byCat.has(cat)) byCat.set(cat, { count: 0, amount: 0 });
        byCat.get(cat)!.count++;
        if (r.amount_usd) byCat.get(cat)!.amount += Number(r.amount_usd);
      }
      return {
        rows,
        total_amount: total,
        top_investors: topInvestors,
        by_category: Array.from(byCat.entries()).sort((a, b) => b[1].amount - a[1].amount).slice(0, 10),
      };
    },
  });
  if (data.isLoading) return <EmptyState>Computing funding recap…</EmptyState>;
  const d = data.data;
  if (!d) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi label="Rounds in TF" value={String(d.rows.length)} sub={categories.length > 0 ? categories.join(" + ") : "all categories"} />
        <Kpi label="Capital raised" value={`$${(d.total_amount / 1e6).toFixed(0)}M`} />
        <Kpi label="Top investor (count)" value={d.top_investors[0]?.[0] || "—"} sub={`${d.top_investors[0]?.[1] || 0} rounds`} />
        <Kpi label="Categories covered" value={String(d.by_category.length)} />
      </div>
      <TemplateSection title="Top 15 investors by round count">
        <table className="w-full text-[12px]">
          <thead><tr className="text-[10px] uppercase tracking-wider text-muted-foreground"><th className="text-left py-1.5">#</th><th className="text-left">Investor</th><th className="text-right">Rounds</th></tr></thead>
          <tbody className="text-white/85">
            {d.top_investors.map(([name, count], i) => (
              <tr key={name} className="border-t border-white/[0.04]">
                <td className="py-1.5 text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="font-medium">{name}</td>
                <td className="text-right tabular-nums">{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TemplateSection>
      <TemplateSection title="By category">
        <table className="w-full text-[12px]">
          <thead><tr className="text-[10px] uppercase tracking-wider text-muted-foreground"><th className="text-left py-1.5">Category</th><th className="text-right">Rounds</th><th className="text-right">Capital</th></tr></thead>
          <tbody className="text-white/85">
            {d.by_category.map(([cat, e]) => (
              <tr key={cat} className="border-t border-white/[0.04]">
                <td className="py-1.5">{cat}</td>
                <td className="text-right tabular-nums">{e.count}</td>
                <td className="text-right tabular-nums">${(e.amount / 1e6).toFixed(1)}M</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TemplateSection>
      <TemplateSection title="Round-by-round (most recent 30)">
        <table className="w-full text-[12px]">
          <thead><tr className="text-[10px] uppercase tracking-wider text-muted-foreground"><th className="text-left py-1.5">Date</th><th className="text-left">Company</th><th className="text-left">Round</th><th className="text-right">Amount</th><th className="text-left pl-2">Lead</th></tr></thead>
          <tbody className="text-white/85">
            {d.rows.slice(0, 30).map((r: any) => (
              <tr key={r.company_slug + r.date} className="border-t border-white/[0.04]">
                <td className="py-1.5 text-muted-foreground tabular-nums">{r.date}</td>
                <td><Link to={`/protocol/${r.company_slug}`} className="hover:text-primary font-medium">{r.company_name}</Link></td>
                <td className="text-muted-foreground">{r.round_type || "—"}</td>
                <td className="text-right tabular-nums">{r.amount_usd ? `$${(r.amount_usd / 1e6).toFixed(1)}M` : "—"}</td>
                <td className="pl-2 text-muted-foreground">{r.lead_investors || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TemplateSection>
    </div>
  );
}

/* ============================================================================
 * Shared helpers
 * ========================================================================= */

function TemplateSection({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <h3 className="text-[12px] font-semibold text-white uppercase tracking-[0.08em]">{title}</h3>
        {hint && <span className="text-[10px] text-muted-foreground">· {hint}</span>}
      </div>
      <div className="rounded border border-white/[0.05] bg-white/[0.015] p-3">{children}</div>
    </div>
  );
}

function Kpi({ label, value, sub, tone = "neutral" }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "alert" | "neutral" }) {
  const cls = tone === "good" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : tone === "alert" ? "text-rose-300" : "text-white";
  return (
    <div className="rounded-md border border-white/[0.05] bg-white/[0.02] p-3">
      <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-base font-bold tabular-nums truncate ${cls}`} title={value}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

/* ============================================================================
 * TEMPLATE bodies (kept as-is — placeholders until real wiring lands)
 * ========================================================================= */

function RiskReportTemplate({ tf }: { tf: Timeframe }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi label="Portfolio risk score" value="6.4 / 10" sub="composite" tone="warn" />
        <Kpi label="Open criticals" value="3" sub="across 2 portcos" tone="alert" />
        <Kpi label="Single-firm coverage" value="11" sub="audited by only 1 firm" tone="warn" />
        <Kpi label="Hack exposure" value="$0" sub="no incidents in period" tone="good" />
      </div>
      <TemplateNote tf={tf}>Will wire real `protocol_risk_scores` + `audit_history` + `hacks` per fund.</TemplateNote>
    </div>
  );
}
function QuarterlyTemplate({ tf }: { tf: Timeframe }) { return <div className="space-y-3"><Kpi label="New positions" value="3" /><TemplateNote tf={tf}>Will pull fund_portfolio + funding_rounds + audit_history + news_items.</TemplateNote></div>; }
function SectorTemplate({ tf }: { tf: Timeframe }) { return <div className="space-y-3"><TemplateNote tf={tf}>Will pull companies.category + audit_history.audited_chains joined with fund_portfolio.</TemplateNote></div>; }
function HackWatchTemplate({ tf }: { tf: Timeframe }) { return <div className="space-y-3"><TemplateNote tf={tf}>Will pull hacks table filtered to fund_portfolio.company_slug.</TemplateNote></div>; }
function AuditCoverageTemplate({ tf }: { tf: Timeframe }) { return <div className="space-y-3"><TemplateNote tf={tf}>Will derive cadence from audit_history.audit_date per company; join GitHub commit deltas.</TemplateNote></div>; }
function UnlocksTemplate({ tf }: { tf: Timeframe }) { return <div className="space-y-3"><TemplateNote tf={tf}>Will source from token_unlocks joined with fund_portfolio.</TemplateNote></div>; }

function TemplateNote({ tf, children }: { tf: Timeframe; children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] text-muted-foreground/80 italic border-t border-white/[0.04] pt-2">
      Template · {TIMEFRAMES.find(t => t.id === tf)?.label} · {children}
    </div>
  );
}
