import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search, ShieldCheck, FileCode, Bug, Boxes, FileText, ExternalLink, AlertTriangle, List } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";
import { AuditTypeBadge, auditTypeMeta } from "@/components/AuditTypeBadge";

type Finding = {
  id: string;
  audit_id: string;
  company_slug: string;
  severity: string | null;
  title: string;
  summary: string | null;
  status: string | null;
  // joined
  audit_firm: string | null;
  audit_date: string | null;
  audit_type: string | null;
  report_url: string | null;
  smart_contract_language: string | null;
  audited_chains: string[] | null;
  data_source: string | null;
  company_name: string;
  company_logo: string | null;
  company_url: string | null;
};

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  high: "bg-rose-500/10 text-rose-300/90 border-rose-500/30",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  low: "bg-sky-500/10 text-sky-300/90 border-sky-500/30",
  informational: "bg-white/[0.05] text-white/70 border-white/10",
  gas: "bg-emerald-500/10 text-emerald-300/80 border-emerald-500/30",
};
function sevStyle(s: string | null): string {
  return SEVERITY_STYLE[(s || "").toLowerCase()] || "bg-white/[0.05] text-white/70 border-white/10";
}

const STATUS_STYLE: Record<string, string> = {
  open: "bg-rose-500/15 text-rose-300 border-rose-500/40",
  acknowledged: "bg-amber-500/10 text-amber-300/80 border-amber-500/30",
  fixed: "bg-emerald-500/10 text-emerald-300/80 border-emerald-500/30",
  wontfix: "bg-white/[0.05] text-white/60 border-white/10",
};
function statusStyle(s: string | null): string {
  return STATUS_STYLE[(s || "").toLowerCase()] || "bg-white/[0.04] text-white/50 border-white/10";
}

type Row = {
  id: string;
  audit_firm: string | null;
  audit_date: string | null;
  audit_type: string | null;
  protocol_name: string | null;
  company_slug: string;
  report_url: string | null;
  audited_repo_url: string | null;
  audited_commit_hash: string | null;
  smart_contract_language: string | null;
  audited_chains: string[] | null;
  findings_critical: number | null;
  findings_high: number | null;
  findings_medium: number | null;
  findings_low: number | null;
  ai_summary: string | null;
  data_source: string | null;
  // joined
  company_name: string;
  company_logo: string | null;
  company_url: string | null;
};

// Some audit_history rows come from finding-index sources (no full PDF) — we
// surface them as "Finding only" and never expose the upstream URL.
const FINDING_ONLY_SOURCES = new Set(["solodit_ingest"]);
function isFindingOnly(dataSource: string | null | undefined): boolean {
  return !!dataSource && FINDING_ONLY_SOURCES.has(dataSource);
}

function normLang(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (t.startsWith("solidity")) return "Solidity";
  if (t === "vyper") return "Vyper";
  if (t.startsWith("rust")) return "Rust";
  if (t === "move") return "Move";
  if (t === "cairo") return "Cairo";
  if (t === "go") return "Go";
  if (t === "func" || t === "tact") return "FunC";
  if (t === "teal") return "TEAL";
  if (t === "noir") return "Noir";
  return s.trim().replace(/\b\w/g, c => c.toUpperCase());
}
function normChain(s: string): string {
  const t = s.trim().toLowerCase();
  if (t === "binance smart chain" || t === "bsc" || t === "bnb chain") return "bsc";
  if (t === "polygon" || t === "matic") return "polygon";
  if (t === "evm") return "evm";
  return t;
}

const AUDIT_TYPES = [
  "smart_contract_audit",
  "contest",
  "fix_review",
  "proof_of_reserves",
  "governance_review",
  "pentest",
  "design_review",
  "token_audit",
  "letter_of_attestation",
];

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function compactYear(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return String(dt.getUTCFullYear());
}

export default function AuditReports() {
  const [view, setView] = useState<"reports" | "findings">("reports");
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [firmFilter, setFirmFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [langFilter, setLangFilter] = useState<string>("all");
  const [chainFilter, setChainFilter] = useState<string>("all");
  const [hasReportOnly, setHasReportOnly] = useState(true);
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [renderLimit, setRenderLimit] = useState(300);

  const rowsQ = useQuery({
    queryKey: ["audit-reports"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const PAGE = 1000;
      const all: any[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from("audit_history")
          .select("id,audit_firm,audit_date,audit_type,protocol_name,company_slug,report_url,audited_repo_url,audited_commit_hash,smart_contract_language,audited_chains,findings_critical,findings_high,findings_medium,findings_low,ai_summary,data_source")
          .order("audit_date", { ascending: false, nullsFirst: false })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
        offset += PAGE;
        if (offset > 25000) break;
      }
      const slugs = Array.from(new Set(all.map(r => r.company_slug).filter(Boolean)));
      const companyMap = new Map<string, any>();
      for (let i = 0; i < slugs.length; i += 1000) {
        const chunk = slugs.slice(i, i + 1000);
        const { data: comps } = await supabase
          .from("companies")
          .select("slug,name,logo,url")
          .in("slug", chunk);
        for (const c of (comps ?? []) as any[]) companyMap.set(c.slug, c);
      }
      return all.map(r => {
        const c = companyMap.get(r.company_slug);
        return {
          ...r,
          company_name: c?.name || r.protocol_name || r.company_slug,
          company_logo: c?.logo || null,
          company_url: c?.url || null,
        };
      }) as Row[];
    },
  });

  const findingsQ = useQuery({
    queryKey: ["audit-findings"],
    enabled: view === "findings",
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const PAGE = 1000;
      const all: any[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from("audit_findings_detail")
          .select("id,audit_id,company_slug,severity,title,summary,status")
          .order("created_at", { ascending: false, nullsFirst: false })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
        offset += PAGE;
        if (offset > 50000) break;
      }
      // Join to audit_history for context + companies for logo.
      // PostgREST URI ~8KB cap → chunk .in() at 100 UUIDs per request.
      const auditIds = Array.from(new Set(all.map(f => f.audit_id).filter(Boolean)));
      const auditMap = new Map<string, any>();
      for (let i = 0; i < auditIds.length; i += 100) {
        const chunk = auditIds.slice(i, i + 100);
        const { data: auds } = await supabase
          .from("audit_history")
          .select("id,audit_firm,audit_date,audit_type,report_url,smart_contract_language,audited_chains,data_source")
          .in("id", chunk);
        for (const a of (auds ?? []) as any[]) auditMap.set(a.id, a);
      }
      const slugs = Array.from(new Set(all.map(f => f.company_slug).filter(Boolean)));
      const companyMap = new Map<string, any>();
      for (let i = 0; i < slugs.length; i += 300) {
        const chunk = slugs.slice(i, i + 300);
        const { data: comps } = await supabase
          .from("companies")
          .select("slug,name,logo,url")
          .in("slug", chunk);
        for (const c of (comps ?? []) as any[]) companyMap.set(c.slug, c);
      }
      return all.map(f => {
        const a = auditMap.get(f.audit_id);
        const c = companyMap.get(f.company_slug);
        return {
          ...f,
          audit_firm: a?.audit_firm || null,
          audit_date: a?.audit_date || null,
          audit_type: a?.audit_type || null,
          report_url: a?.report_url || null,
          smart_contract_language: a?.smart_contract_language || null,
          audited_chains: a?.audited_chains || null,
          data_source: a?.data_source || null,
          company_name: c?.name || f.company_slug,
          company_logo: c?.logo || null,
          company_url: c?.url || null,
        };
      }) as Finding[];
    },
  });

  const firms = useMemo(() => {
    const s = new Set<string>();
    for (const r of rowsQ.data ?? []) if (r.audit_firm) s.add(r.audit_firm);
    return Array.from(s).sort();
  }, [rowsQ.data]);

  const years = useMemo(() => {
    const s = new Set<string>();
    for (const r of rowsQ.data ?? []) {
      const y = r.audit_date && r.audit_date.length >= 4 ? r.audit_date.slice(0, 4) : null;
      if (y) s.add(y);
    }
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [rowsQ.data]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (rowsQ.data ?? []).filter(r => {
      if (hasReportOnly && !r.report_url) return false;
      if (typeFilter !== "all" && r.audit_type !== typeFilter) return false;
      if (firmFilter !== "all" && r.audit_firm !== firmFilter) return false;
      if (yearFilter !== "all" && (!r.audit_date || !r.audit_date.startsWith(yearFilter))) return false;
      if (langFilter !== "all" && normLang(r.smart_contract_language) !== langFilter) return false;
      if (chainFilter !== "all") {
        const cs = (r.audited_chains ?? []).map(normChain);
        if (!cs.includes(chainFilter)) return false;
      }
      if (ql) {
        const hay = `${r.company_name} ${r.company_slug} ${r.audit_firm || ""} ${r.protocol_name || ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [rowsQ.data, q, typeFilter, firmFilter, yearFilter, langFilter, chainFilter, hasReportOnly]);

  const filteredFindings = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (findingsQ.data ?? []).filter(f => {
      if (severityFilter !== "all" && (f.severity || "").toLowerCase() !== severityFilter) return false;
      if (statusFilter !== "all") {
        if (statusFilter === "open" && (f.status || "").toLowerCase() !== "open") return false;
        if (statusFilter === "unfixed" && !["open","acknowledged","wontfix"].includes((f.status || "").toLowerCase())) return false;
        if (statusFilter === "fixed" && (f.status || "").toLowerCase() !== "fixed") return false;
      }
      if (typeFilter !== "all" && f.audit_type !== typeFilter) return false;
      if (firmFilter !== "all" && f.audit_firm !== firmFilter) return false;
      if (yearFilter !== "all" && (!f.audit_date || !f.audit_date.startsWith(yearFilter))) return false;
      if (langFilter !== "all" && normLang(f.smart_contract_language) !== langFilter) return false;
      if (chainFilter !== "all") {
        const cs = (f.audited_chains ?? []).map(normChain);
        if (!cs.includes(chainFilter)) return false;
      }
      if (ql) {
        const hay = `${f.title} ${f.summary || ""} ${f.company_name} ${f.audit_firm || ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [findingsQ.data, q, severityFilter, statusFilter, typeFilter, firmFilter, yearFilter, langFilter, chainFilter]);

  // Compute language + chain dropdown options from BOTH datasets, prioritizing whichever view is active
  const langOptions = useMemo(() => {
    const m = new Map<string, number>();
    const src = view === "reports" ? (rowsQ.data ?? []) : (findingsQ.data ?? []);
    for (const r of src as any[]) {
      const n = normLang(r.smart_contract_language);
      if (n) m.set(n, (m.get(n) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rowsQ.data, findingsQ.data, view]);

  const chainOptions = useMemo(() => {
    const m = new Map<string, number>();
    const src = view === "reports" ? (rowsQ.data ?? []) : (findingsQ.data ?? []);
    for (const r of src as any[]) {
      const arr = Array.isArray(r.audited_chains) ? r.audited_chains : [];
      for (const c of arr) { const n = normChain(c); if (n) m.set(n, (m.get(n) ?? 0) + 1); }
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30);
  }, [rowsQ.data, findingsQ.data, view]);

  // Type-distribution counts for the type filter UI
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rowsQ.data ?? []) {
      const t = r.audit_type || "unknown";
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    return m;
  }, [rowsQ.data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-white">{view === "reports" ? "Audit reports" : "Individual findings"}</h1>
        <span className="text-xs text-muted-foreground">
          {view === "reports"
            ? `${rowsQ.data?.length.toLocaleString() || "—"} total · ${firms.length} firms · ${filtered.length.toLocaleString()} matching`
            : `${findingsQ.data?.length.toLocaleString() || "—"} findings catalogued · ${filteredFindings.length.toLocaleString()} matching`}
        </span>
      </div>

      {/* Tab strip — matches the other Audits pages */}
      <div className="inline-flex rounded-md bg-white/[0.03] border border-white/[0.06] p-0.5 text-[11px]">
        <Link to="/audit-firms" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><ShieldCheck className="w-3 h-3" /> Firms</Link>
        <Link to="/audited-repos" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><FileCode className="w-3 h-3" /> Repos</Link>
        <span className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 bg-primary/15 text-primary font-medium"><FileText className="w-3 h-3" /> Reports</span>
        <Link to="/bug-bounties" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><Bug className="w-3 h-3" /> Bug Bounties</Link>
        <Link to="/smart-contracts" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><Boxes className="w-3 h-3" /> Smart Contracts</Link>
      </div>

      {/* Filter strip */}
      <div className="as-card p-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-[400px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search protocol, firm…"
            className="w-full pl-8 pr-3 py-1.5 text-[12px] bg-white/[0.03] border border-white/[0.08] rounded text-white placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40"
          />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="bg-white/[0.04] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white">
          <option value="all">All types ({rowsQ.data?.length.toLocaleString() || 0})</option>
          {AUDIT_TYPES.filter(t => typeCounts.has(t)).map(t => {
            const meta = auditTypeMeta(t);
            return <option key={t} value={t}>{meta.label} ({(typeCounts.get(t) ?? 0).toLocaleString()})</option>;
          })}
        </select>
        <select value={firmFilter} onChange={(e) => setFirmFilter(e.target.value)} className="bg-white/[0.04] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white max-w-[180px]">
          <option value="all">All firms ({firms.length})</option>
          {firms.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="bg-white/[0.04] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white">
          <option value="all">All years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={langFilter} onChange={(e) => setLangFilter(e.target.value)} className="bg-white/[0.04] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white">
          <option value="all">All languages</option>
          {langOptions.map(([l, n]) => <option key={l} value={l}>{l} ({n.toLocaleString()})</option>)}
        </select>
        <select value={chainFilter} onChange={(e) => setChainFilter(e.target.value)} className="bg-white/[0.04] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white">
          <option value="all">All chains</option>
          {chainOptions.map(([c, n]) => <option key={c} value={c}>{c} ({n.toLocaleString()})</option>)}
        </select>
        {view === "reports" && (
          <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={hasReportOnly} onChange={(e) => setHasReportOnly(e.target.checked)} className="accent-primary" />
            Has report link
          </label>
        )}
        {view === "findings" && (
          <>
            <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} className="bg-white/[0.04] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white">
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="informational">Informational</option>
              <option value="gas">Gas</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-white/[0.04] border border-white/10 rounded px-2.5 py-1.5 text-xs text-white">
              <option value="all">All statuses</option>
              <option value="open">Open only</option>
              <option value="unfixed">Open / Acknowledged / Won't fix</option>
              <option value="fixed">Fixed only</option>
            </select>
          </>
        )}
        {(q || typeFilter !== "all" || firmFilter !== "all" || yearFilter !== "all" || langFilter !== "all" || chainFilter !== "all" || !hasReportOnly) && (
          <button
            onClick={() => { setQ(""); setTypeFilter("all"); setFirmFilter("all"); setYearFilter("all"); setLangFilter("all"); setChainFilter("all"); setHasReportOnly(true); }}
            className="text-[11px] text-muted-foreground hover:text-white underline ml-1"
          >Clear all</button>
        )}
      </div>

      {/* View toggle — sits right above the data so the active mode is obvious */}
      <div className="inline-flex rounded-md bg-white/[0.03] border border-white/[0.08] p-0.5 text-[12px]">
        <button
          onClick={() => setView("reports")}
          className={`px-3 py-1.5 rounded inline-flex items-center gap-1.5 ${view === "reports" ? "bg-primary/20 text-primary font-semibold border border-primary/40" : "text-muted-foreground hover:text-white border border-transparent"}`}
        >
          <FileText className="w-3.5 h-3.5" /> Reports view
          <span className="text-[10px] opacity-70 tabular-nums">({rowsQ.data?.length.toLocaleString() || "—"})</span>
        </button>
        <button
          onClick={() => setView("findings")}
          className={`px-3 py-1.5 rounded inline-flex items-center gap-1.5 ${view === "findings" ? "bg-primary/20 text-primary font-semibold border border-primary/40" : "text-muted-foreground hover:text-white border border-transparent"}`}
        >
          <AlertTriangle className="w-3.5 h-3.5" /> Individual findings
          <span className="text-[10px] opacity-70 tabular-nums">({findingsQ.data?.length.toLocaleString() || "34K+"})</span>
        </button>
      </div>

      {/* List */}
      {view === "reports" ? (
      rowsQ.isLoading ? (
        <div className="as-card p-4 text-center text-xs text-muted-foreground">Loading audit reports…</div>
      ) : filtered.length === 0 ? (
        <div className="as-card p-4 text-center text-xs text-muted-foreground">No reports match the current filters.</div>
      ) : (
        <>
          <div className="as-card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-white/[0.02] border-b border-white/[0.04] sticky top-0 z-10">
                  <tr className="text-left text-[10px] uppercase tracking-[0.08em] font-medium text-muted-foreground">
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">Protocol</th>
                    <th className="px-3 py-2.5">Type</th>
                    <th className="px-3 py-2.5">Firm</th>
                    <th className="px-3 py-2.5">Findings (C/H/M/L)</th>
                    <th className="px-3 py-2.5 text-right">Report</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filtered.slice(0, renderLimit).map((r) => {
                    const findings = (r.findings_critical ?? 0) + (r.findings_high ?? 0) + (r.findings_medium ?? 0) + (r.findings_low ?? 0);
                    const findingOnly = isFindingOnly(r.data_source);
                    return (
                      <tr key={r.id} className="hover:bg-white/[0.02]">
                        <td className="px-3 py-2.5 text-[11px] text-muted-foreground tabular-nums whitespace-nowrap" title={r.audit_date || ""}>
                          {fmtDate(r.audit_date)}
                        </td>
                        <td className="px-3 py-2.5">
                          <Link to={`/protocol/${r.company_slug}`} className="flex items-center gap-2 hover:text-primary">
                            <BrandLogo name={r.company_name} url={r.company_url} logo={r.company_logo} className="w-6 h-6 rounded shrink-0" />
                            <span className="text-sm text-white truncate max-w-[200px]">{r.company_name}</span>
                          </Link>
                        </td>
                        <td className="px-3 py-2.5">
                          {findingOnly ? (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300"
                              title="Finding-level data only — no full audit report available"
                            >
                              Finding only
                            </span>
                          ) : (
                            <AuditTypeBadge type={r.audit_type} variant="normal" />
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-[11.5px] text-white/90 truncate max-w-[150px]">{r.audit_firm || "—"}</td>
                        <td className="px-3 py-2.5 text-[11px] font-mono whitespace-nowrap">
                          {findings === 0 ? (
                            <span className="text-muted-foreground/60">0/0/0/0</span>
                          ) : (
                            <span className="space-x-1">
                              <span className={(r.findings_critical ?? 0) > 0 ? "text-rose-300 font-bold" : "text-muted-foreground/60"}>{r.findings_critical ?? 0}</span>
                              <span className="text-muted-foreground/40">/</span>
                              <span className={(r.findings_high ?? 0) > 0 ? "text-rose-300/90 font-bold" : "text-muted-foreground/60"}>{r.findings_high ?? 0}</span>
                              <span className="text-muted-foreground/40">/</span>
                              <span className={(r.findings_medium ?? 0) > 0 ? "text-amber-300" : "text-muted-foreground/60"}>{r.findings_medium ?? 0}</span>
                              <span className="text-muted-foreground/40">/</span>
                              <span className={(r.findings_low ?? 0) > 0 ? "text-sky-300/80" : "text-muted-foreground/60"}>{r.findings_low ?? 0}</span>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {findingOnly ? (
                            <span className="text-[10px] text-muted-foreground/60 italic" title="No full report — finding-level data only">no report</span>
                          ) : r.report_url ? (
                            <a
                              href={r.report_url}
                              target="_blank"
                              rel="noreferrer"
                              title="Open the full audit report"
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:border-primary/50 text-[11px] font-medium whitespace-nowrap"
                            >
                              <FileText className="w-3 h-3" />
                              Report
                              <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                            </a>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {filtered.length > renderLimit && (
            <div className="text-center py-3 text-xs text-muted-foreground">
              Showing {renderLimit.toLocaleString()} of {filtered.length.toLocaleString()}.
              <button onClick={() => setRenderLimit(l => l + 500)} className="text-primary hover:underline ml-2">Load 500 more</button>
            </div>
          )}
        </>
      )
      ) : (
        /* FINDINGS VIEW */
        findingsQ.isLoading ? (
          <div className="as-card p-4 text-center text-xs text-muted-foreground">Loading individual findings… (this can take a few seconds — 34K rows)</div>
        ) : filteredFindings.length === 0 ? (
          <div className="as-card p-4 text-center text-xs text-muted-foreground">No findings match the current filters.</div>
        ) : (
          <>
            <div className="as-card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-white/[0.02] border-b border-white/[0.04] sticky top-0 z-10">
                    <tr className="text-left text-[10px] uppercase tracking-[0.08em] font-medium text-muted-foreground">
                      <th className="px-3 py-2.5">Severity</th>
                      <th className="px-3 py-2.5">Finding</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5">Protocol</th>
                      <th className="px-3 py-2.5">Firm / Date</th>
                      <th className="px-3 py-2.5 text-right">Report</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {filteredFindings.slice(0, renderLimit).map((f) => (
                      <tr key={f.id} className="hover:bg-white/[0.02]">
                        <td className="px-3 py-2.5 align-top">
                          <span className={`inline-flex items-center text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${sevStyle(f.severity)}`}>
                            {f.severity || "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 align-top max-w-[420px]">
                          <div className="text-[12.5px] text-white truncate" title={f.title}>{f.title}</div>
                          {f.summary && <div className="text-[11px] text-muted-foreground/80 line-clamp-2 mt-0.5">{f.summary}</div>}
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          {f.status ? (
                            <span className={`inline-flex items-center text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${statusStyle(f.status)}`}>
                              {f.status}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60 text-[11px]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <Link to={`/protocol/${f.company_slug}`} className="flex items-center gap-2 hover:text-primary">
                            <BrandLogo name={f.company_name} url={f.company_url} logo={f.company_logo} className="w-5 h-5 rounded shrink-0" />
                            <span className="text-[12px] text-white truncate max-w-[160px]">{f.company_name}</span>
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <div className="text-[11.5px] text-white/85 truncate max-w-[140px]">{f.audit_firm || "—"}</div>
                          <div className="text-[10px] text-muted-foreground/80 tabular-nums">{fmtDate(f.audit_date)}</div>
                        </td>
                        <td className="px-3 py-2.5 align-top text-right">
                          {isFindingOnly(f.data_source) ? (
                            <span className="text-[10px] text-muted-foreground/60 italic" title="No full report — finding-level data only">no report</span>
                          ) : f.report_url ? (
                            <a
                              href={f.report_url}
                              target="_blank"
                              rel="noreferrer"
                              title="Open the full audit report"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:border-primary/50 text-[10px] font-medium whitespace-nowrap"
                            >
                              <FileText className="w-3 h-3" />
                              Report
                              <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                            </a>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {filteredFindings.length > renderLimit && (
              <div className="text-center py-3 text-xs text-muted-foreground">
                Showing {renderLimit.toLocaleString()} of {filteredFindings.length.toLocaleString()}.
                <button onClick={() => setRenderLimit(l => l + 500)} className="text-primary hover:underline ml-2">Load 500 more</button>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
