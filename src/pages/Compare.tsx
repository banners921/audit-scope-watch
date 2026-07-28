import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, Link } from "react-router-dom";
import { GitCompare, X, Plus, Search, TrendingUp, TrendingDown, Minus, Skull, Bug, ShieldCheck, Briefcase, Coins, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";

const MAX_COMPARE = 6;

function compactUsd(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n === 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function daysAgo(d: string | null | undefined): string {
  if (!d) return "—";
  const ms = Date.now() - new Date(d).getTime();
  const days = Math.floor(ms / 86400000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

type ProtocolSnapshot = {
  slug: string;
  name: string;
  category: string | null;
  url: string | null;
  logo: string | null;
  has_been_hacked: boolean;
  has_bug_bounty: boolean;
  last_audit_date: string | null;
  last_audit_firm: string | null;
  audit_count: number | null;
  unique_auditor_count: number | null;
  total_raised_usd: number | null;

  composite_score: number | null;
  band: string | null;
  sub_audit: number | null;
  sub_onchain: number | null;
  sub_activity: number | null;
  sub_team: number | null;
  sub_funding: number | null;
  coverage_pct: number | null;

  tvl: number | null;
  tvl_7d_delta_pct: number | null;
  tvl_30d_delta_pct: number | null;

  findings_critical: number;
  findings_high: number;
  findings_medium: number;

  contract_count: number;
  proxy_count: number;
  chains: string[];

  hiring_open: number;
  sc_engineers: number;

  hack_count: number;
  hack_total_usd: number;

  recent_anomaly_z: number | null;
};

export default function Compare() {
  const [params, setParams] = useSearchParams();
  const initialSlugs = (params.get("slugs") || "").split(",").map(s => s.trim()).filter(Boolean);
  const [slugs, setSlugs] = useState<string[]>(initialSlugs);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (slugs.length > 0) setParams({ slugs: slugs.join(",") }, { replace: true });
    else setParams({}, { replace: true });
  }, [slugs, setParams]);

  // Searchable universe
  const universeQ = useQuery({
    queryKey: ["compare-universe"],
    queryFn: async () => {
      const { data } = await supabase
        .from("companies")
        .select("slug,name,category,logo,url")
        .order("name");
      return (data ?? []) as Array<{ slug: string; name: string; category: string | null; logo: string | null; url: string | null }>;
    },
  });

  // Filter universe by query
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return (universeQ.data ?? [])
      .filter((c) => !slugs.includes(c.slug) && c.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [universeQ.data, query, slugs]);

  // Per-slug deep fetch
  const dataQ = useQuery({
    queryKey: ["compare-data", slugs.join(",")],
    enabled: slugs.length > 0,
    queryFn: async (): Promise<ProtocolSnapshot[]> => {
      const [comp, risk, audits, findings, contracts, tvl, hiring, hacks, anom] = await Promise.all([
        supabase.from("companies").select("slug,name,category,url,logo,has_been_hacked,has_bug_bounty,last_audit_date,last_audit_firm,audit_count,unique_auditor_count,total_raised_usd").in("slug", slugs),
        supabase.from("protocol_risk_scores").select("company_slug,composite_score,band,sub_audit,sub_onchain,sub_activity,sub_team,sub_funding,coverage_pct").in("company_slug", slugs),
        supabase.from("audit_history").select("company_slug,audit_firm,audit_date,findings_critical,findings_high,findings_medium").in("company_slug", slugs),
        supabase.from("audit_history").select("company_slug,findings_critical,findings_high,findings_medium").in("company_slug", slugs).eq("findings_extraction_status", "extracted"),
        supabase.from("chain_addresses").select("company_slug,chain,proxy_pattern").in("company_slug", slugs),
        supabase.from("protocol_metrics").select("company_slug,tvl,date").in("company_slug", slugs).not("tvl", "is", null).order("date", { ascending: false }).limit(3000),
        supabase.from("hiring_aggregates").select("company_slug,role_count,smart_contract_count").in("company_slug", slugs),
        supabase.from("hacks").select("company_slug,amount_usd").in("company_slug", slugs),
        supabase.from("metric_anomalies").select("company_slug,z_score,date").in("company_slug", slugs).order("date", { ascending: false }).limit(500),
      ]);

      const compMap = new Map<string, any>();
      for (const c of (comp.data ?? []) as any[]) compMap.set(c.slug, c);
      const riskMap = new Map<string, any>();
      for (const r of (risk.data ?? []) as any[]) riskMap.set(r.company_slug, r);

      // Findings aggregated
      const findMap = new Map<string, { critical: number; high: number; medium: number }>();
      for (const f of (findings.data ?? []) as any[]) {
        const e = findMap.get(f.company_slug) ?? { critical: 0, high: 0, medium: 0 };
        e.critical += f.findings_critical || 0;
        e.high += f.findings_high || 0;
        e.medium += f.findings_medium || 0;
        findMap.set(f.company_slug, e);
      }

      // Contracts aggregated
      const contractMap = new Map<string, { total: number; proxy: number; chains: Set<string> }>();
      for (const c of (contracts.data ?? []) as any[]) {
        const e = contractMap.get(c.company_slug) ?? { total: 0, proxy: 0, chains: new Set<string>() };
        e.total++;
        if (c.proxy_pattern && c.proxy_pattern !== "non_proxy") e.proxy++;
        if (c.chain) e.chains.add(c.chain);
        contractMap.set(c.company_slug, e);
      }

      // TVL by slug + history
      const tvlBySlug = new Map<string, Array<{ tvl: number; date: string }>>();
      for (const r of (tvl.data ?? []) as any[]) {
        const arr = tvlBySlug.get(r.company_slug) ?? [];
        arr.push({ tvl: Number(r.tvl), date: r.date });
        tvlBySlug.set(r.company_slug, arr);
      }

      // Hiring most recent per slug
      const hiringMap = new Map<string, { role_count: number; sc: number }>();
      for (const h of (hiring.data ?? []) as any[]) {
        const prev = hiringMap.get(h.company_slug);
        if (!prev || (h.role_count || 0) > prev.role_count) {
          hiringMap.set(h.company_slug, { role_count: h.role_count || 0, sc: h.smart_contract_count || 0 });
        }
      }

      // Hacks aggregated
      const hackMap = new Map<string, { count: number; total_usd: number }>();
      for (const h of (hacks.data ?? []) as any[]) {
        const e = hackMap.get(h.company_slug) ?? { count: 0, total_usd: 0 };
        e.count++;
        e.total_usd += Number(h.amount_usd || 0);
        hackMap.set(h.company_slug, e);
      }

      // Most recent anomaly z
      const anomMap = new Map<string, number>();
      for (const a of (anom.data ?? []) as any[]) {
        if (!anomMap.has(a.company_slug)) anomMap.set(a.company_slug, Math.abs(Number(a.z_score) || 0));
      }

      // Compose snapshots
      return slugs.map((slug): ProtocolSnapshot => {
        const c = compMap.get(slug) || {};
        const r = riskMap.get(slug);
        const f = findMap.get(slug) ?? { critical: 0, high: 0, medium: 0 };
        const co = contractMap.get(slug) ?? { total: 0, proxy: 0, chains: new Set<string>() };
        const tvls = tvlBySlug.get(slug) ?? [];
        const latest = tvls[0]?.tvl ?? null;
        const sevenAgo = tvls.find((t) => {
          const days = (Date.now() - new Date(t.date).getTime()) / 86400000;
          return days >= 6 && days <= 9;
        });
        const thirtyAgo = tvls.find((t) => {
          const days = (Date.now() - new Date(t.date).getTime()) / 86400000;
          return days >= 28 && days <= 35;
        });
        const tvl7d = latest && sevenAgo ? ((latest - sevenAgo.tvl) / sevenAgo.tvl) * 100 : null;
        const tvl30d = latest && thirtyAgo ? ((latest - thirtyAgo.tvl) / thirtyAgo.tvl) * 100 : null;
        const hireR = hiringMap.get(slug);
        const hk = hackMap.get(slug) ?? { count: 0, total_usd: 0 };

        return {
          slug,
          name: c.name || slug,
          category: c.category ?? null,
          url: c.url ?? null,
          logo: c.logo ?? null,
          has_been_hacked: !!c.has_been_hacked,
          has_bug_bounty: !!c.has_bug_bounty,
          last_audit_date: c.last_audit_date ?? null,
          last_audit_firm: c.last_audit_firm ?? null,
          audit_count: c.audit_count ?? null,
          unique_auditor_count: c.unique_auditor_count ?? null,
          total_raised_usd: c.total_raised_usd ?? null,
          composite_score: r?.composite_score ?? null,
          band: r?.band ?? null,
          sub_audit: r?.sub_audit ?? null,
          sub_onchain: r?.sub_onchain ?? null,
          sub_activity: r?.sub_activity ?? null,
          sub_team: r?.sub_team ?? null,
          sub_funding: r?.sub_funding ?? null,
          coverage_pct: r?.coverage_pct ?? null,
          tvl: latest,
          tvl_7d_delta_pct: tvl7d,
          tvl_30d_delta_pct: tvl30d,
          findings_critical: f.critical, findings_high: f.high, findings_medium: f.medium,
          contract_count: co.total, proxy_count: co.proxy, chains: Array.from(co.chains).slice(0, 6),
          hiring_open: hireR?.role_count ?? 0, sc_engineers: hireR?.sc ?? 0,
          hack_count: hk.count, hack_total_usd: hk.total_usd,
          recent_anomaly_z: anomMap.get(slug) ?? null,
        };
      });
    },
  });

  const snapshots = dataQ.data ?? [];

  // Sector medians for "rank vs sector" context
  const sectorMediansQ = useQuery({
    queryKey: ["compare-sector-medians", snapshots.map(s => s.category).join(",")],
    enabled: snapshots.length > 0,
    queryFn: async () => {
      const cats = Array.from(new Set(snapshots.map(s => s.category).filter(Boolean))) as string[];
      if (cats.length === 0) return new Map<string, { score: number; n: number }>();
      // Pull all scored protocols in those categories
      const [companies, scores] = await Promise.all([
        supabase.from("companies").select("slug,category").in("category", cats),
        supabase.from("protocol_risk_scores").select("company_slug,composite_score"),
      ]);
      const slugToCat = new Map<string, string>();
      for (const c of (companies.data ?? []) as any[]) slugToCat.set(c.slug, c.category);
      const buckets = new Map<string, number[]>();
      for (const s of (scores.data ?? []) as any[]) {
        const cat = slugToCat.get(s.company_slug);
        if (!cat) continue;
        const arr = buckets.get(cat) ?? [];
        arr.push(s.composite_score);
        buckets.set(cat, arr);
      }
      const m = new Map<string, { score: number; n: number }>();
      for (const [cat, arr] of buckets) {
        arr.sort((a, b) => a - b);
        const median = arr[Math.floor(arr.length / 2)] ?? 0;
        m.set(cat, { score: median, n: arr.length });
      }
      return m;
    },
  });

  const sectorMedians = sectorMediansQ.data ?? new Map();

  const addSlug = (slug: string) => {
    if (slugs.length >= MAX_COMPARE) return;
    if (slugs.includes(slug)) return;
    setSlugs([...slugs, slug]);
    setQuery("");
  };

  const removeSlug = (slug: string) => setSlugs(slugs.filter(s => s !== slug));

  // Best/worst across rows for conditional formatting
  const cellTone = (key: keyof ProtocolSnapshot, value: any, lowerIsBetter: boolean): string => {
    if (value == null || snapshots.length < 2) return "";
    const vals = snapshots.map((s) => s[key]).filter((v): v is number => typeof v === "number");
    if (vals.length < 2) return "";
    const best = lowerIsBetter ? Math.min(...vals) : Math.max(...vals);
    const worst = lowerIsBetter ? Math.max(...vals) : Math.min(...vals);
    if (value === best && best !== worst) return "text-emerald-300";
    if (value === worst && best !== worst) return "text-rose-300";
    return "";
  };

  return (
    <div className="space-y-5 max-w-[1800px]">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <GitCompare className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight">Compare protocols</h1>
            <p className="text-[11px] text-muted-foreground mt-1">
              Pick 2&ndash;{MAX_COMPARE} protocols to see them side-by-side on 25+ dimensions. Best/worst highlighted per row.
            </p>
          </div>
        </div>
        {slugs.length > 0 && (
          <button
            onClick={() => setSlugs([])}
            className="text-xs text-muted-foreground hover:text-white px-2.5 py-1.5 rounded border border-white/[0.08] hover:bg-white/[0.03]"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Slug pills + search */}
      <div className="as-card p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {slugs.map((slug) => {
            const snap = snapshots.find(s => s.slug === slug);
            return (
              <div key={slug} className="inline-flex items-center gap-2 px-2 py-1.5 rounded-md bg-primary/10 border border-primary/30 text-xs">
                <BrandLogo name={snap?.name || slug} url={snap?.url} logo={snap?.logo} className="w-5 h-5 rounded" />
                <span className="text-white font-medium">{snap?.name || slug}</span>
                <button onClick={() => removeSlug(slug)} className="text-muted-foreground hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
          {slugs.length < MAX_COMPARE && (
            <div className="relative flex-1 min-w-[280px]">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={slugs.length === 0 ? "Search 2+ protocols to compare…" : "Add another…"}
                className="as-input text-xs pl-7 w-full"
              />
              {searchResults.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 as-card p-1 max-h-[280px] overflow-y-auto">
                  {searchResults.map((r) => (
                    <button
                      key={r.slug}
                      onClick={() => addSlug(r.slug)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-white/[0.04] rounded text-left"
                    >
                      <BrandLogo name={r.name} url={r.url} logo={r.logo} className="w-5 h-5 rounded shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-white truncate">{r.name}</div>
                        {r.category && <div className="text-[10px] text-muted-foreground">{r.category}</div>}
                      </div>
                      <Plus className="w-3 h-3 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {snapshots.length === 0 ? (
        <div className="as-card p-12 text-center">
          <GitCompare className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
          <h3 className="text-base font-semibold text-white">Pick at least 2 protocols to compare</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            Side-by-side analysis across security posture, audit cadence, on-chain footprint, hiring momentum, sector rank.
          </p>
        </div>
      ) : (
        <div className="as-card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-white/[0.02] border-b border-white/[0.06]">
                <tr>
                  <th className="px-3 py-3 text-left text-[10px] uppercase tracking-[0.08em] font-medium text-muted-foreground sticky left-0 bg-[#111] z-10">Metric</th>
                  {snapshots.map((s) => (
                    <th key={s.slug} className="px-3 py-3 min-w-[180px] text-left">
                      <Link to={`/protocol/${s.slug}`} className="flex items-center gap-2 hover:text-primary">
                        <BrandLogo name={s.name} url={s.url} logo={s.logo} className="w-7 h-7 rounded" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-white truncate">{s.name}</div>
                          {s.category && <div className="text-[10px] text-muted-foreground">{s.category}</div>}
                        </div>
                        <ExternalLink className="w-3 h-3 text-muted-foreground" />
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <SectionRow label="Risk profile" />
                <Row label="Composite risk" snapshots={snapshots} render={(s) => (
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`text-lg font-bold tabular-nums ${cellTone("composite_score", s.composite_score, true)}`}>{s.composite_score ?? "—"}</span>
                    {s.band && <Band band={s.band} />}
                  </span>
                )} />
                <Row label="Sector median" snapshots={snapshots} render={(s) => {
                  const med = s.category ? sectorMedians.get(s.category) : null;
                  if (!med || s.composite_score == null) return <span className="text-muted-foreground">—</span>;
                  const delta = s.composite_score - med.score;
                  return (
                    <span className="text-[11px]">
                      <span className="text-muted-foreground">median {med.score}</span>{" "}
                      <span className={delta > 5 ? "text-rose-300" : delta < -5 ? "text-emerald-300" : "text-muted-foreground"}>
                        ({delta > 0 ? "+" : ""}{delta})
                      </span>
                    </span>
                  );
                }} />
                <Row label="Coverage" snapshots={snapshots} render={(s) => <span className="text-muted-foreground">{s.coverage_pct ?? 0}%</span>} />

                <SectionRow label="Sub-scores (lower is better)" />
                <Row label="Audit" snapshots={snapshots} render={(s) => <SubScore v={s.sub_audit} />} />
                <Row label="On-chain" snapshots={snapshots} render={(s) => <SubScore v={s.sub_onchain} />} />
                <Row label="Activity" snapshots={snapshots} render={(s) => <SubScore v={s.sub_activity} />} />
                <Row label="Team" snapshots={snapshots} render={(s) => <SubScore v={s.sub_team} />} />
                <Row label="Funding" snapshots={snapshots} render={(s) => <SubScore v={s.sub_funding} />} />

                <SectionRow label="Audit posture" />
                <Row label="Last audit" snapshots={snapshots} render={(s) => (
                  <div>
                    <div className="text-white/85">{s.last_audit_firm || "—"}</div>
                    <div className="text-[10px] text-muted-foreground">{s.last_audit_date ? `${s.last_audit_date} · ${daysAgo(s.last_audit_date)} ago` : "no record"}</div>
                  </div>
                )} />
                <Row label="Total audits" snapshots={snapshots} render={(s) => <span className="tabular-nums">{s.audit_count ?? "—"}</span>} />
                <Row label="Unique auditors" snapshots={snapshots} render={(s) => <span className="tabular-nums">{s.unique_auditor_count ?? "—"}</span>} />
                <Row label="Critical findings" snapshots={snapshots} render={(s) => (
                  <span className={`tabular-nums font-bold ${s.findings_critical > 0 ? "text-rose-300" : "text-emerald-300"}`}>
                    {s.findings_critical}
                  </span>
                )} />
                <Row label="High findings" snapshots={snapshots} render={(s) => (
                  <span className={`tabular-nums ${s.findings_high > 0 ? "text-orange-300" : "text-muted-foreground"}`}>
                    {s.findings_high}
                  </span>
                )} />
                <Row label="Bug bounty" snapshots={snapshots} render={(s) => (
                  s.has_bug_bounty ? <span className="inline-flex items-center gap-1 text-emerald-300"><Bug className="w-3 h-3" /> Yes</span> : <span className="text-muted-foreground">No</span>
                )} />

                <SectionRow label="On-chain footprint" />
                <Row label="Contracts mapped" snapshots={snapshots} render={(s) => <span className="tabular-nums">{s.contract_count}</span>} />
                <Row label="Proxies" snapshots={snapshots} render={(s) => (
                  <span className="tabular-nums">{s.proxy_count > 0 ? `${s.proxy_count}/${s.contract_count}` : "0"}</span>
                )} />
                <Row label="Chains" snapshots={snapshots} render={(s) => (
                  <div className="flex flex-wrap gap-1">
                    {s.chains.length === 0 ? <span className="text-muted-foreground">—</span> :
                      s.chains.map(c => <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-muted-foreground">{c}</span>)
                    }
                  </div>
                )} />
                <Row label="Recent anomaly" snapshots={snapshots} render={(s) => (
                  s.recent_anomaly_z != null ? (
                    <span className={s.recent_anomaly_z >= 3 ? "text-rose-300 font-bold" : s.recent_anomaly_z >= 2 ? "text-amber-300" : "text-muted-foreground"}>
                      {s.recent_anomaly_z.toFixed(1)}σ
                    </span>
                  ) : <span className="text-muted-foreground">—</span>
                )} />

                <SectionRow label="Liquidity & momentum" />
                <Row label="TVL (current)" snapshots={snapshots} render={(s) => (
                  <span className={`tabular-nums font-bold ${cellTone("tvl", s.tvl, false)}`}>{compactUsd(s.tvl)}</span>
                )} />
                <Row label="TVL 7d" snapshots={snapshots} render={(s) => <DeltaPct v={s.tvl_7d_delta_pct} />} />
                <Row label="TVL 30d" snapshots={snapshots} render={(s) => <DeltaPct v={s.tvl_30d_delta_pct} />} />

                <SectionRow label="Team & funding" />
                <Row label="Open roles" snapshots={snapshots} render={(s) => <span className="tabular-nums">{s.hiring_open || "—"}</span>} />
                <Row label="SC engineers hiring" snapshots={snapshots} render={(s) => (
                  s.sc_engineers > 0 ? <span className="tabular-nums text-primary"><Briefcase className="inline w-3 h-3 mr-0.5" />{s.sc_engineers}</span> : <span className="text-muted-foreground">0</span>
                )} />
                <Row label="Total raised" snapshots={snapshots} render={(s) => <span className="tabular-nums">{compactUsd(s.total_raised_usd)}</span>} />

                <SectionRow label="History" />
                <Row label="Past hacks" snapshots={snapshots} render={(s) => (
                  s.hack_count > 0 ? (
                    <span className="text-rose-300 inline-flex items-center gap-1">
                      <Skull className="w-3 h-3" /> {s.hack_count} · {compactUsd(s.hack_total_usd)}
                    </span>
                  ) : <span className="text-emerald-300/80">Clean</span>
                )} />
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, snapshots, render }: { label: string; snapshots: ProtocolSnapshot[]; render: (s: ProtocolSnapshot) => React.ReactNode }) {
  return (
    <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
      <td className="px-3 py-2.5 text-[11px] text-muted-foreground sticky left-0 bg-[#111] z-10 font-medium">{label}</td>
      {snapshots.map((s) => (
        <td key={s.slug} className="px-3 py-2.5">{render(s)}</td>
      ))}
    </tr>
  );
}

function SectionRow({ label }: { label: string }) {
  return (
    <tr className="bg-white/[0.025]">
      <td className="px-3 py-2 text-[10px] uppercase tracking-[0.1em] font-bold text-primary/80 sticky left-0 bg-[#161616] z-10" colSpan={99}>{label}</td>
    </tr>
  );
}

function SubScore({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  const cls = v >= 60 ? "text-rose-300" : v >= 40 ? "text-amber-300" : v >= 20 ? "text-yellow-200/80" : "text-emerald-300";
  return (
    <div className="inline-flex items-center gap-2">
      <div className="w-16 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div className={`h-full ${v >= 60 ? "bg-rose-400" : v >= 40 ? "bg-amber-400" : v >= 20 ? "bg-yellow-400" : "bg-emerald-400"}`} style={{ width: `${Math.min(100, v)}%` }} />
      </div>
      <span className={`text-[11px] font-bold tabular-nums ${cls}`}>{v}</span>
    </div>
  );
}

function Band({ band }: { band: string }) {
  const cls: Record<string, string> = {
    critical: "bg-rose-500/20 text-rose-200 border-rose-500/40",
    high: "bg-orange-500/20 text-orange-200 border-orange-500/40",
    medium: "bg-amber-500/15 text-amber-200 border-amber-500/30",
    low: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
  };
  return <span className={`inline-block text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${cls[band] || cls.medium}`}>{band}</span>;
}

function DeltaPct({ v }: { v: number | null }) {
  if (v == null || !isFinite(v)) return <span className="text-muted-foreground">—</span>;
  const up = v >= 0;
  const big = Math.abs(v) > 20;
  const cls = up ? (big ? "text-emerald-200 font-bold" : "text-emerald-300") : (big ? "text-rose-200 font-bold" : "text-rose-300");
  const Icon = up ? TrendingUp : v < -0.5 ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${cls}`}>
      <Icon className="w-3 h-3" />
      {v > 0 ? "+" : ""}{v.toFixed(1)}%
    </span>
  );
}
