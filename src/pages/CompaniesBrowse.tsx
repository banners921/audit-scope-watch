import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search, Building2, ExternalLink, ArrowUpRight, ShieldCheck, Bug, AlertTriangle, Landmark, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { EntityCard, type CardFact } from "@/components/EntityCard";
import { ViewToggle, type ViewMode, loadViewMode, saveViewMode } from "@/components/ViewToggle";

const PAGE_SIZE = 30;
const STORAGE_KEY = "companies";

type SortMode = "audits" | "recent" | "name";
type Facets = {
  total: number; audited: number; bug_bounty: number; hacked: number; institution: number;
  categories: { category: string; n: number }[];
};

export default function CompaniesBrowse() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [audited, setAudited] = useState(false);
  const [bugBounty, setBugBounty] = useState(false);
  const [hacked, setHacked] = useState(false);
  const [institution, setInstitution] = useState(false);
  const [sort, setSort] = useState<SortMode>("audits");
  const [page, setPage] = useState(0);
  const [view, setView] = useState<ViewMode>(() => loadViewMode(STORAGE_KEY, "grid"));
  const setViewPersist = (v: ViewMode) => { setView(v); saveViewMode(STORAGE_KEY, v); };

  const reset = () => { setQ(""); setCategory(null); setAudited(false); setBugBounty(false); setHacked(false); setInstitution(false); setPage(0); };
  const activeCount = (category ? 1 : 0) + (audited ? 1 : 0) + (bugBounty ? 1 : 0) + (hacked ? 1 : 0) + (institution ? 1 : 0) + (q.trim().length >= 2 ? 1 : 0);

  const facetsQ = useQuery({
    queryKey: ["company-facets"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.rpc("company_facets");
      return data as Facets;
    },
  });
  const f = facetsQ.data;

  const rowsQ = useQuery({
    queryKey: ["companies-browse", q, category, audited, bugBounty, hacked, institution, sort, page],
    keepPreviousData: true,
    queryFn: async () => {
      let query = supabase
        .from("companies")
        .select(
          "slug,name,logo,category,subcategory,description,url,audit_count,unique_auditor_count,last_audit_date,last_audit_firm,has_bug_bounty,has_been_hacked,is_institution",
          { count: "exact" }
        )
        .not("name", "is", null);
      if (q.trim().length >= 2) query = query.ilike("name", `%${q.trim()}%`);
      if (category) query = query.eq("category", category);
      if (audited) query = query.gt("audit_count", 0);
      if (bugBounty) query = query.eq("has_bug_bounty", true);
      if (hacked) query = query.eq("has_been_hacked", true);
      if (institution) query = query.eq("is_institution", true);

      if (sort === "recent") query = query.order("last_audit_date", { ascending: false, nullsFirst: false });
      else if (sort === "name") query = query.order("name", { ascending: true });
      else query = query.order("audit_count", { ascending: false, nullsFirst: false });

      query = query.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as any[], count: count ?? 0 };
    },
  });

  return (
    <div className="max-w-[1280px] mx-auto space-y-4">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary">Companies</div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight mt-0.5">
            {rowsQ.data?.count?.toLocaleString() ?? "—"}
            <span className="text-muted-foreground text-[15px] font-normal ml-2">
              {activeCount > 0 ? "match your filters" : `of ${f ? f.total.toLocaleString() : "—"} tracked`}
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setViewPersist} />
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              className="as-input pl-7 py-1.5 text-[12.5px]"
              placeholder="Search by name…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0); }}
            />
          </div>
        </div>
      </header>

      {/* Quick security filters — the high-signal toggles, with real counts */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Toggle on={audited} onClick={() => { setAudited((v) => !v); setPage(0); }} icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Audited" count={f?.audited} tone="emerald" />
        <Toggle on={bugBounty} onClick={() => { setBugBounty((v) => !v); setPage(0); }} icon={<Bug className="w-3.5 h-3.5" />} label="Bug bounty" count={f?.bug_bounty} />
        <Toggle on={hacked} onClick={() => { setHacked((v) => !v); setPage(0); }} icon={<AlertTriangle className="w-3.5 h-3.5" />} label="Been hacked" count={f?.hacked} tone="rose" />
        <Toggle on={institution} onClick={() => { setInstitution((v) => !v); setPage(0); }} icon={<Landmark className="w-3.5 h-3.5" />} label="Institution" count={f?.institution} />
        <div className="mx-1 h-4 w-px bg-white/[0.08]" />
        <select
          value={sort}
          onChange={(e) => { setSort(e.target.value as SortMode); setPage(0); }}
          className="text-[11.5px] bg-white/[0.03] border border-white/[0.08] rounded-md px-2 py-1.5 text-muted-foreground hover:text-foreground"
        >
          <option value="audits">Sort: Most audited</option>
          <option value="recent">Sort: Recently audited</option>
          <option value="name">Sort: Name A–Z</option>
        </select>
        {activeCount > 0 && (
          <button onClick={reset} className="text-[11px] px-2 py-1.5 rounded-md border border-white/[0.08] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <X className="w-3 h-3" /> Clear ({activeCount})
          </button>
        )}
      </div>

      {/* Category chips with exact counts */}
      {f?.categories && f.categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => { setCategory(null); setPage(0); }}
            className={`text-[11px] px-2 py-1 rounded-md border ${!category ? "border-primary/40 bg-primary/[0.08] text-primary" : "border-white/[0.06] text-muted-foreground hover:text-foreground"}`}
          >
            All sectors
          </button>
          {f.categories.map((c) => (
            <button
              key={c.category}
              onClick={() => { setCategory(category === c.category ? null : c.category); setPage(0); }}
              className={`text-[11px] px-2 py-1 rounded-md border ${category === c.category ? "border-primary/40 bg-primary/[0.08] text-primary" : "border-white/[0.06] text-muted-foreground hover:text-foreground"}`}
            >
              {c.category} <span className="opacity-50 tabular-nums">{c.n}</span>
            </button>
          ))}
        </div>
      )}

      {rowsQ.isLoading && <div className="as-card p-6 text-center text-sm text-muted-foreground">Loading…</div>}
      {!rowsQ.isLoading && (rowsQ.data?.rows.length ?? 0) === 0 && (
        <div className="as-card p-8 text-center text-sm text-muted-foreground">No companies match these filters. <button onClick={reset} className="text-primary hover:underline">Clear filters</button></div>
      )}

      {view === "grid" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(rowsQ.data?.rows ?? []).map((c) => {
            const facts: CardFact[] = [];
            if (c.audit_count) facts.push({ label: "Audits", value: c.audit_count, tone: "good" });
            if (c.unique_auditor_count) facts.push({ label: "Firms used", value: c.unique_auditor_count });
            if (c.last_audit_firm) facts.push({ label: "Last firm", value: c.last_audit_firm });
            if (c.last_audit_date) facts.push({ label: "Last audit", value: c.last_audit_date });
            const badges: { label: string; tone: any }[] = [];
            if (c.category) badges.push({ label: c.category, tone: "primary" });
            if (c.has_bug_bounty) badges.push({ label: "Bug bounty", tone: "muted" });
            if (c.has_been_hacked) badges.push({ label: "Hacked", tone: "danger" });
            return (
              <EntityCard
                key={c.slug}
                size="md"
                href={`/protocol/${c.slug}`}
                logoUrl={c.logo}
                icon={<Building2 className="w-5 h-5" />}
                title={c.name}
                subtitle={c.description?.slice(0, 140)}
                badges={badges}
                facts={facts}
                rightMeta={c.url ? (
                  <a href={safeUrl(c.url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary text-[10.5px]">
                    {c.url.replace(/^https?:\/\//, "").replace(/\/$/, "").slice(0, 28)}<ExternalLink className="w-2.5 h-2.5" />
                  </a>
                ) : null}
              />
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
                <th className="px-3 py-2 font-medium">Sector</th>
                <th className="px-3 py-2 font-medium text-right">Audits</th>
                <th className="px-3 py-2 font-medium">Last audit</th>
                <th className="px-3 py-2 font-medium">Last firm</th>
                <th className="px-3 py-2 font-medium w-7"></th>
              </tr>
            </thead>
            <tbody>
              {(rowsQ.data?.rows ?? []).map((c) => (
                <tr key={c.slug} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                  <td className="px-3 py-2">
                    <Link to={`/protocol/${c.slug}`} className="flex items-center gap-2 group/cell">
                      <div className="w-6 h-6 shrink-0 rounded overflow-hidden bg-white/[0.04] flex items-center justify-center">
                        {c.logo ? (
                          <img src={c.logo} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        ) : (
                          <span className="text-[9px] font-bold opacity-60">{(c.name ?? "?")[0]?.toUpperCase()}</span>
                        )}
                      </div>
                      <span className="text-foreground group-hover/cell:text-primary truncate font-medium">{c.name}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{c.category ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-300">{c.audit_count ?? 0}</td>
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">{c.last_audit_date ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground truncate max-w-[180px]">{c.last_audit_firm ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground/60"><ArrowUpRight className="w-3 h-3" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rowsQ.data && rowsQ.data.count > PAGE_SIZE && (
        <Pager page={page} count={rowsQ.data.count} onChange={setPage} />
      )}
    </div>
  );
}

function Toggle({ on, onClick, icon, label, count, tone }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number; tone?: "emerald" | "rose" }) {
  const activeCls = tone === "emerald"
    ? "border-emerald-400/40 bg-emerald-400/[0.10] text-emerald-300"
    : tone === "rose"
    ? "border-rose-400/40 bg-rose-400/[0.10] text-rose-300"
    : "border-primary/40 bg-primary/[0.10] text-primary";
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 text-[11.5px] px-2.5 py-1.5 rounded-md border transition-colors ${on ? activeCls : "border-white/[0.07] text-muted-foreground hover:text-foreground"}`}
    >
      {icon}{label}
      {count != null && <span className="opacity-50 tabular-nums">{count.toLocaleString()}</span>}
    </button>
  );
}

function Pager({ page, count, onChange }: { page: number; count: number; onChange: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2">
      <button type="button" disabled={page === 0} onClick={() => onChange(Math.max(0, page - 1))} className="px-3 py-1.5 rounded-md border border-white/[0.06] disabled:opacity-40 hover:bg-white/[0.03]">← Prev</button>
      <span className="font-mono tabular-nums">Page {page + 1} of {Math.max(1, Math.ceil(count / PAGE_SIZE)).toLocaleString()}</span>
      <button type="button" disabled={(page + 1) * PAGE_SIZE >= count} onClick={() => onChange(page + 1)} className="px-3 py-1.5 rounded-md border border-white/[0.06] disabled:opacity-40 hover:bg-white/[0.03]">Next →</button>
    </div>
  );
}

function safeUrl(u: string) { return u.startsWith("http") ? u : `https://${u}`; }
