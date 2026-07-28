import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search, Banknote, ExternalLink, ArrowUpRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { EntityCard, type CardFact } from "@/components/EntityCard";
import { ViewToggle, type ViewMode, loadViewMode, saveViewMode } from "@/components/ViewToggle";
import { SearchableSelect, type Option } from "@/components/SearchableSelect";

const PAGE_SIZE = 30;
const STORAGE_KEY = "funding-rounds";

type SortMode = "latest" | "earliest" | "largest" | "smallest";

const SORT_OPTIONS: Option[] = [
  { value: "latest", label: "Latest first" },
  { value: "earliest", label: "Earliest first" },
  { value: "largest", label: "Largest raise" },
  { value: "smallest", label: "Smallest raise" },
];

export default function FundingRoundsBrowse() {
  const [q, setQ] = useState("");
  const [roundTypes, setRoundTypes] = useState<string[]>([]);
  const [sort, setSort] = useState<SortMode>("latest");
  const [page, setPage] = useState(0);
  const [view, setView] = useState<ViewMode>(() => loadViewMode(STORAGE_KEY, "grid"));
  const setViewPersist = (v: ViewMode) => { setView(v); saveViewMode(STORAGE_KEY, v); };

  // Full round-type list with counts (dropdown)
  const roundTypesQ = useQuery({
    queryKey: ["funding-round-types"],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Option[]> => {
      const { data } = await supabase.from("funding_rounds").select("round_type").not("round_type", "is", null).limit(50000);
      const tally = new Map<string, number>();
      for (const r of (data ?? []) as any[]) {
        const t = (r.round_type || "").trim();
        if (!t) continue;
        tally.set(t, (tally.get(t) ?? 0) + 1);
      }
      return Array.from(tally.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([v, c]) => ({ value: v, label: v, count: c }));
    },
  });

  // Global fund name → logo map (~5,729 rows, ~50KB, cache 30min)
  const fundLogoMapQ = useQuery({
    queryKey: ["funding-fund-logo-map"],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("funds").select("slug,name,logo").not("logo", "is", null).limit(20000);
      const byName = new Map<string, { slug: string; name: string; logo: string }>();
      for (const f of (data ?? []) as any[]) {
        if (!f.name || !f.logo) continue;
        const key = normalizeFundName(f.name);
        if (key) byName.set(key, f);
      }
      return byName;
    },
  });

  const rowsQ = useQuery({
    queryKey: ["funding-browse", q, roundTypes, sort, page],
    keepPreviousData: true,
    queryFn: async () => {
      let query = supabase
        .from("funding_rounds")
        .select("id,company_slug,company_name,round_type,amount_usd,date,lead_investors,other_investors,all_investors,announcement_url", { count: "exact" });
      if (q.trim().length >= 2) query = query.ilike("company_name", `%${q.trim()}%`);
      if (roundTypes.length > 0) query = query.in("round_type", roundTypes);
      const ascDate = sort === "earliest";
      const ascAmt = sort === "smallest";
      if (sort === "latest" || sort === "earliest") {
        query = query.order("date", { ascending: ascDate, nullsFirst: false });
      } else {
        query = query.order("amount_usd", { ascending: ascAmt, nullsFirst: false });
      }
      query = query.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as any[], count: count ?? 0 };
    },
  });

  // Batch-fetch logos for visible companies
  const visibleCompanySlugs = useMemo(() => {
    return Array.from(new Set(((rowsQ.data?.rows ?? []) as any[]).map((r) => r.company_slug).filter(Boolean)));
  }, [rowsQ.data?.rows]);
  const companyLogosQ = useQuery({
    queryKey: ["funding-company-logos", visibleCompanySlugs.join(",")],
    enabled: visibleCompanySlugs.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("slug,logo,url").in("slug", visibleCompanySlugs);
      const map: Record<string, { logo: string | null; url: string | null }> = {};
      for (const c of (data ?? []) as any[]) map[c.slug] = { logo: c.logo, url: c.url };
      return map;
    },
  });

  const clearFilters = () => { setQ(""); setRoundTypes([]); setSort("latest"); setPage(0); };
  const hasFilters = q.trim().length > 0 || roundTypes.length > 0 || sort !== "latest";

  return (
    <div className="max-w-[1280px] mx-auto space-y-4">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary">Funding rounds</div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight mt-0.5">
            {rowsQ.data?.count?.toLocaleString() ?? "—"} rounds tracked
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setViewPersist} />
        </div>
      </header>

      <div className="as-card p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-60">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              className="as-input pl-7 py-1.5 text-[12px] w-full"
              placeholder="Search by company…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0); }}
            />
          </div>

          <SearchableSelect
            multi
            values={roundTypes}
            onMultiChange={(vs) => { setRoundTypes(vs); setPage(0); }}
            options={roundTypesQ.data ?? []}
            loading={roundTypesQ.isLoading}
            placeholder="All round types"
          />

          <SearchableSelect
            value={sort}
            onChange={(v) => { setSort((v ?? "latest") as SortMode); setPage(0); }}
            options={SORT_OPTIONS}
            placeholder="Sort"
          />

          {hasFilters && (
            <button onClick={clearFilters} className="text-[11px] px-2 py-1.5 rounded-md border border-white/[0.08] hover:bg-white/[0.04] ml-auto">
              Clear filters
            </button>
          )}
        </div>
      </div>

      {rowsQ.isLoading && <div className="as-card p-6 text-center text-sm text-muted-foreground">Loading…</div>}

      {view === "grid" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(rowsQ.data?.rows ?? []).map((r) => {
            const facts: CardFact[] = [];
            if (r.amount_usd) facts.push({ label: "Amount", value: formatMoney(Number(r.amount_usd)), tone: "good" });
            if (r.round_type) facts.push({ label: "Round", value: r.round_type, tone: "primary" });
            if (r.date) facts.push({ label: "Date", value: prettyDate(r.date) });
            const allInvestors = combineInvestors(r);
            const leads = parseInvestors(r.lead_investors).slice(0, 3);
            const logo = companyLogosQ.data?.[r.company_slug]?.logo ?? null;
            const investorMatches = matchInvestors(allInvestors, fundLogoMapQ.data);
            return (
              <div key={r.id} className="flex flex-col">
                <EntityCard
                  size="md"
                  href={`/protocol/${r.company_slug}`}
                  logoUrl={logo}
                  icon={<Banknote className="w-5 h-5" />}
                  title={r.company_name || r.company_slug}
                  subtitle={leads.length > 0 ? `Led by ${leads.join(", ")}` : r.round_type ?? undefined}
                  facts={facts}
                  rightMeta={r.announcement_url ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.open(normalizeUrl(r.announcement_url), "_blank", "noopener,noreferrer");
                      }}
                      className="inline-flex items-center gap-1 hover:text-primary text-[10.5px] cursor-pointer"
                    >
                      announcement <ExternalLink className="w-2.5 h-2.5" />
                    </button>
                  ) : null}
                />
                {/* Investor logo strip */}
                {(investorMatches.matched.length > 0 || investorMatches.unmatched.length > 0) && (
                  <div className="-mt-1 ml-2 mr-2 rounded-b-md border border-t-0 border-white/[0.04] bg-white/[0.015] px-3 py-1.5 flex items-center gap-1.5 overflow-hidden">
                    <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground/70 shrink-0">Investors</span>
                    {investorMatches.matched.slice(0, 10).map((m) => (
                      <Link
                        key={m.slug}
                        to={`/funds/${m.slug}`}
                        title={m.name}
                        className="shrink-0 w-5 h-5 rounded-sm overflow-hidden bg-white/[0.04] flex items-center justify-center hover:ring-1 hover:ring-primary/50 transition"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <img src={m.logo} alt={m.name} className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      </Link>
                    ))}
                    {investorMatches.unmatched.length > 0 && (
                      <span className="text-[10px] text-muted-foreground truncate">
                        {investorMatches.matched.length > 0 ? "+ " : ""}{investorMatches.unmatched.slice(0, 3).join(", ")}{investorMatches.unmatched.length > 3 ? ` +${investorMatches.unmatched.length - 3}` : ""}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {view === "list" && (
        <div className="as-card overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Round</th>
                <th className="px-3 py-2 font-medium text-right">Amount</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Investors</th>
                <th className="px-3 py-2 font-medium w-7"></th>
              </tr>
            </thead>
            <tbody>
              {(rowsQ.data?.rows ?? []).map((r) => {
                const leads = parseInvestors(r.lead_investors).slice(0, 2).join(", ");
                const investorMatches = matchInvestors(combineInvestors(r), fundLogoMapQ.data);
                return (
                  <tr key={r.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                    <td className="px-3 py-2">
                      <Link to={`/protocol/${r.company_slug}`} className="text-foreground hover:text-primary font-medium">
                        {r.company_name || r.company_slug}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.round_type ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-300">{r.amount_usd ? formatMoney(Number(r.amount_usd)) : "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">{r.date ? prettyDate(r.date) : "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground truncate max-w-[300px]">
                      <div className="inline-flex items-center gap-1">
                        {investorMatches.matched.slice(0, 5).map((m) => (
                          <Link key={m.slug} to={`/funds/${m.slug}`} title={m.name} onClick={(e) => e.stopPropagation()} className="w-4 h-4 rounded-sm overflow-hidden bg-white/[0.04] shrink-0">
                            <img src={m.logo} alt={m.name} className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          </Link>
                        ))}
                        <span className="truncate">{leads || "—"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground/60"><ArrowUpRight className="w-3 h-3" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rowsQ.data && rowsQ.data.count > PAGE_SIZE && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="px-3 py-1.5 rounded-md border border-white/[0.06] disabled:opacity-40 hover:bg-white/[0.03]">← Prev</button>
          <span className="font-mono tabular-nums">Page {page + 1} of {Math.ceil(rowsQ.data.count / PAGE_SIZE).toLocaleString()}</span>
          <button type="button" disabled={(page + 1) * PAGE_SIZE >= rowsQ.data.count} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-md border border-white/[0.06] disabled:opacity-40 hover:bg-white/[0.03]">Next →</button>
        </div>
      )}
    </div>
  );
}

function formatMoney(n: number): string {
  if (!n) return "$0";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function parseInvestors(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean).map((x) => String(x).trim()).filter(Boolean);
  return String(raw)
    .split(/[,;]|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function combineInvestors(row: any): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const field of ["lead_investors", "other_investors", "all_investors"]) {
    for (const name of parseInvestors(row[field])) {
      const k = normalizeFundName(name);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(name);
    }
  }
  return out;
}

function normalizeFundName(s: string): string {
  return String(s).toLowerCase().replace(/\b(capital|ventures|partners|fund|labs|llc|inc|llp|group)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function matchInvestors(names: string[], map?: Map<string, { slug: string; name: string; logo: string }>) {
  const matched: { slug: string; name: string; logo: string }[] = [];
  const unmatched: string[] = [];
  if (!map || map.size === 0) return { matched, unmatched: names };
  const seenSlugs = new Set<string>();
  for (const raw of names) {
    const key = normalizeFundName(raw);
    if (!key) continue;
    const hit = map.get(key);
    if (hit && !seenSlugs.has(hit.slug)) {
      seenSlugs.add(hit.slug);
      matched.push(hit);
    } else if (!hit) {
      unmatched.push(raw);
    }
  }
  return { matched, unmatched };
}

function normalizeUrl(u: string): string {
  if (!u) return "#";
  const trimmed = u.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function prettyDate(s: string): string {
  if (!s) return "";
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  const d = new Date(s + (s.length === 10 ? "T00:00:00Z" : ""));
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
