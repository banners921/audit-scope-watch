import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Github, Search, ShieldCheck, FileCode, Boxes, ArrowRight, AlertTriangle, Layers, Bug, FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";
import { AuditTypeBadge } from "@/components/AuditTypeBadge";

type RepoRow = {
  id: string;
  audit_firm: string | null;
  audit_date: string | null;
  audit_type: string | null;
  protocol_name: string | null;
  company_slug: string;
  report_url: string | null;
  audited_repo_url: string;
  audited_commit_hash: string | null;
  commit_hash_status: "valid" | "invalid" | "error" | null;
  repo_url_status: "valid" | "invalid" | "error" | null;
  org_url_status: "valid" | "invalid" | "error" | null;
  audited_files: string[] | null;
  audited_chains: string[] | null;
  smart_contract_language: string | null;
  findings_critical: number | null;
  findings_high: number | null;
  findings_medium: number | null;
  findings_low: number | null;
  ai_summary: string | null;
};

type Sort = "recent" | "firm" | "files" | "findings";

function tightAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400000);
  if (d < 1) return "today";
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function shortRepo(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?(github\.com|gitlab\.com|bitbucket\.org)\//, "").replace(/\/$/, "").slice(0, 60);
}

function normLang(s: string | null): string | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  if (!t) return null;
  // Canonicalize common variants
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

export default function AuditedRepos() {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [firmFilter, setFirmFilter] = useState<string>("");
  const [langFilter, setLangFilter] = useState<string>("");
  const [chainFilter, setChainFilter] = useState<string>("");
  const [renderLimit, setRenderLimit] = useState(300);
  // Default: only show repos we've HEAD-verified as reachable. Toggle to include unverified/broken.
  const [verifiedOnly, setVerifiedOnly] = useState(true);

  const reposQ = useQuery({
    queryKey: ["audited-repos"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const all: RepoRow[] = [];
      const PAGE = 1000;
      for (let from = 0; from < 50000; from += PAGE) {
        const { data, error } = await supabase
          .from("audit_history")
          .select("id,audit_firm,audit_date,audit_type,protocol_name,company_slug,report_url,audited_repo_url,audited_commit_hash,commit_hash_status,repo_url_status,org_url_status,audited_files,audited_chains,smart_contract_language,findings_critical,findings_high,findings_medium,findings_low,ai_summary")
          .not("audited_repo_url", "is", null)
          .order("audit_date", { ascending: false, nullsFirst: false })
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        all.push(...(data as RepoRow[]));
        if (data.length < PAGE) break;
      }
      return all;
    },
  });

  const firms = useMemo(() => {
    const s = new Set<string>();
    for (const r of reposQ.data ?? []) if (r.audit_firm) s.add(r.audit_firm);
    return Array.from(s).sort();
  }, [reposQ.data]);

  const langs = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of reposQ.data ?? []) {
      const n = normLang(r.smart_contract_language);
      if (n) m.set(n, (m.get(n) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [reposQ.data]);

  const chains = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of reposQ.data ?? []) {
      const arr = Array.isArray(r.audited_chains) ? r.audited_chains : [];
      for (const c of arr) { const n = normChain(c); if (n) m.set(n, (m.get(n) ?? 0) + 1); }
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30);
  }, [reposQ.data]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let list = (reposQ.data ?? []).filter(r => {
      // Default to verified-only: every link the user can click is HEAD-200 against GitHub.
      if (verifiedOnly && r.repo_url_status !== "valid") return false;
      if (firmFilter && r.audit_firm !== firmFilter) return false;
      if (langFilter && normLang(r.smart_contract_language) !== langFilter) return false;
      if (chainFilter) {
        const chainArr = Array.isArray(r.audited_chains) ? r.audited_chains.map(normChain) : [];
        if (!chainArr.includes(chainFilter)) return false;
      }
      if (ql) {
        const hay = `${r.protocol_name || ""} ${r.company_slug} ${r.audit_firm || ""} ${r.audited_repo_url}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      switch (sort) {
        case "firm": return (a.audit_firm || "").localeCompare(b.audit_firm || "");
        case "files": return (b.audited_files?.length ?? 0) - (a.audited_files?.length ?? 0);
        case "findings": return (
          ((b.findings_critical ?? 0) * 4 + (b.findings_high ?? 0) * 2 + (b.findings_medium ?? 0))
          - ((a.findings_critical ?? 0) * 4 + (a.findings_high ?? 0) * 2 + (a.findings_medium ?? 0))
        );
        default: return (b.audit_date || "").localeCompare(a.audit_date || "");
      }
    });
    return list;
  }, [reposQ.data, q, sort, firmFilter, langFilter, chainFilter]);

  return (
    <div className="space-y-5 max-w-[1600px]">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FileCode className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight">Repos</h1>
            <p className="text-[11px] text-muted-foreground mt-1">
              Every audited codebase we've captured — repo + commit + file scope.
            </p>
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {filtered.length.toLocaleString()} of {(reposQ.data ?? []).length.toLocaleString()} repos
        </div>
      </div>

      {/* Inner tab toggle */}
      <div className="inline-flex rounded-md bg-white/[0.03] border border-white/[0.06] p-0.5 text-[11px]">
        <Link to="/audit-firms" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><ShieldCheck className="w-3 h-3" /> Firms</Link>
        <span className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 bg-primary/15 text-primary font-medium"><FileCode className="w-3 h-3" /> Repos</span>
        <Link to="/audit-reports" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><FileText className="w-3 h-3" /> Reports</Link>
        <Link to="/bug-bounties" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><Bug className="w-3 h-3" /> Bug Bounties</Link>
        <Link to="/smart-contracts" className="px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><Boxes className="w-3 h-3" /> Smart Contracts</Link>
      </div>

      <div className="as-card p-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-[400px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search repo, protocol, firm…" className="w-full pl-8 pr-3 py-1.5 text-[12px] bg-white/[0.03] border border-white/[0.08] rounded text-white placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40" />
        </div>
        <select value={firmFilter} onChange={(e) => setFirmFilter(e.target.value)} className="bg-white/[0.03] border border-white/[0.08] rounded px-2 py-1.5 text-[12px] text-white max-w-[180px]">
          <option value="">All firms ({firms.length})</option>
          {firms.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={langFilter} onChange={(e) => setLangFilter(e.target.value)} className="bg-white/[0.03] border border-white/[0.08] rounded px-2 py-1.5 text-[12px] text-white">
          <option value="">All languages</option>
          {langs.map(([l, n]) => <option key={l} value={l}>{l} ({n.toLocaleString()})</option>)}
        </select>
        <select value={chainFilter} onChange={(e) => setChainFilter(e.target.value)} className="bg-white/[0.03] border border-white/[0.08] rounded px-2 py-1.5 text-[12px] text-white">
          <option value="">All chains</option>
          {chains.map(([c, n]) => <option key={c} value={c}>{c} ({n.toLocaleString()})</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="bg-white/[0.03] border border-white/[0.08] rounded px-2 py-1.5 text-[12px] text-white">
          <option value="recent">Sort: most recent</option>
          <option value="firm">Sort: by firm</option>
          <option value="files">Sort: most files</option>
          <option value="findings">Sort: heaviest findings</option>
        </select>
        {(q || firmFilter || langFilter || chainFilter) && (
          <button onClick={() => { setQ(""); setFirmFilter(""); setLangFilter(""); setChainFilter(""); }} className="text-[11px] text-muted-foreground hover:text-white underline">Clear all</button>
        )}
        <label className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none" title="Default: only show repos we've live-verified as reachable on GitHub (HTTP 200). Uncheck to include unverified or broken URLs.">
          <input
            type="checkbox"
            checked={verifiedOnly}
            onChange={(e) => setVerifiedOnly(e.target.checked)}
            className="accent-primary"
          />
          Verified repos only
        </label>
      </div>

      {reposQ.isLoading ? (
        <div className="as-card p-8 text-center text-xs text-muted-foreground">Loading audited repos…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.slice(0, renderLimit).map((r) => {
              const files = Array.isArray(r.audited_files) ? r.audited_files : [];
              const chains = Array.isArray(r.audited_chains) ? r.audited_chains : [];
              const c = Number(r.findings_critical ?? 0), h = Number(r.findings_high ?? 0), m = Number(r.findings_medium ?? 0), l = Number(r.findings_low ?? 0);
              const totalFindings = c + h + m + l;
              return (
                <div key={r.id} className="as-card p-3.5 flex flex-col gap-2.5">
                  {/* Header: firm + date */}
                  <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
                    <ShieldCheck className="w-3 h-3 text-primary" />
                    {r.audit_firm ? (
                      <Link to={`/auditors/${encodeURIComponent(r.audit_firm)}`} className="text-white/85 font-medium hover:text-primary">{r.audit_firm}</Link>
                    ) : <span>—</span>}
                    <span className="ml-auto tabular-nums">{r.audit_date || tightAgo(r.audit_date)}</span>
                  </div>

                  {/* Repo — only clickable when HEAD-verified as 200. Broken/unverified rows show struck-through.
                       Default page filter hides everything that isn't verified, so this only renders when a user
                       deliberately toggles "show all" off. */}
                  {r.repo_url_status === "valid" ? (
                    <a href={r.audited_repo_url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-2 text-primary hover:underline">
                      <Github className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span className="text-[12.5px] font-mono leading-tight break-all">{shortRepo(r.audited_repo_url)}</span>
                    </a>
                  ) : (
                    <div className="inline-flex items-start gap-2 text-muted-foreground/70" title={r.repo_url_status === "invalid" ? "Repo URL from audit no longer resolves (renamed, moved, deleted, or misextracted)" : "Repo URL pending verification"}>
                      <Github className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-50" />
                      <span className="text-[12.5px] font-mono leading-tight break-all line-through decoration-muted-foreground/40">{shortRepo(r.audited_repo_url)}</span>
                    </div>
                  )}
                  {r.audited_commit_hash && (
                    r.commit_hash_status === "valid" && r.audited_repo_url.includes("github.com") ? (
                      <a
                        href={`${r.audited_repo_url.replace(/\/$/, "")}/tree/${r.audited_commit_hash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10.5px] font-mono text-muted-foreground hover:text-primary -mt-1"
                        title={`Verified commit — opens code state at audit time`}
                      >
                        @{r.audited_commit_hash.slice(0, 12)}
                      </a>
                    ) : (
                      <span
                        className="text-[10.5px] font-mono text-muted-foreground/70 -mt-1 select-all"
                        title={r.commit_hash_status === "invalid" ? `Commit not in current repo — hash shown for reference: ${r.audited_commit_hash}` : `Audited at commit ${r.audited_commit_hash}`}
                      >
                        @{r.audited_commit_hash.slice(0, 12)}
                      </span>
                    )
                  )}

                  {/* Protocol */}
                  <div className="flex items-center gap-2 pt-1 border-t border-white/[0.04]">
                    <BrandLogo name={r.protocol_name || r.company_slug} className="w-7 h-7 rounded-md shrink-0" />
                    <Link to={`/protocol/${r.company_slug}`} className="text-[12px] text-white font-medium hover:text-primary truncate flex-1">{r.protocol_name || r.company_slug}</Link>
                    <AuditTypeBadge type={r.audit_type} variant="compact" />

                    <Link to={`/protocol/${r.company_slug}`} className="text-muted-foreground hover:text-primary"><ArrowRight className="w-3 h-3" /></Link>
                  </div>

                  {/* AI summary (when available) */}
                  {r.ai_summary && r.ai_summary !== "NOT_AN_AUDIT_REPORT" && (
                    <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3 italic border-l-2 border-primary/30 pl-2">{r.ai_summary}</p>
                  )}

                  {/* Scope row: files + chains + language */}
                  <div className="flex items-center gap-3 text-[10.5px] text-muted-foreground border-t border-white/[0.04] pt-2 flex-wrap">
                    {files.length > 0 && (
                      <span className="inline-flex items-center gap-1" title={files.join("\n")}>
                        <FileCode className="w-3 h-3" /> <span className="tabular-nums">{files.length}</span> file{files.length === 1 ? "" : "s"}
                      </span>
                    )}
                    {chains.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Boxes className="w-3 h-3" /> {chains.slice(0, 3).join(", ")}{chains.length > 3 ? ` +${chains.length - 3}` : ""}
                      </span>
                    )}
                    {r.smart_contract_language && (
                      <span className="inline-flex items-center gap-1">
                        <Layers className="w-3 h-3" /> {r.smart_contract_language}
                      </span>
                    )}
                  </div>

                  {/* Findings strip */}
                  <div className="flex items-center gap-2 text-[10px] mt-auto pt-2 border-t border-white/[0.04]">
                    {totalFindings === 0 ? (
                      <span className="text-emerald-300">No findings recorded</span>
                    ) : (
                      <>
                        {c > 0 && <span className="text-rose-300 inline-flex items-center gap-0.5"><AlertTriangle className="w-2.5 h-2.5" />{c}C</span>}
                        {h > 0 && <span className="text-orange-300 tabular-nums">{h}H</span>}
                        {m > 0 && <span className="text-amber-300 tabular-nums">{m}M</span>}
                        {l > 0 && <span className="text-sky-300 tabular-nums">{l}L</span>}
                        <span className="text-muted-foreground/70 ml-auto tabular-nums">{totalFindings} total</span>
                      </>
                    )}
                    {r.report_url && (
                      <a
                        href={r.report_url}
                        target="_blank"
                        rel="noreferrer"
                        title="Open the full audit report"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:border-primary/50 text-[10px] font-medium shrink-0 ml-1"
                      >
                        Report ↗
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {filtered.length > renderLimit && (
            <div className="px-4 py-3 text-xs text-muted-foreground text-center flex items-center justify-center gap-3">
              <span>Showing {renderLimit.toLocaleString()} of {filtered.length.toLocaleString()}.</span>
              <button onClick={() => setRenderLimit(l => l + 500)} className="text-primary hover:underline">Load 500 more</button>
              <button onClick={() => setRenderLimit(filtered.length)} className="text-primary hover:underline">Show all</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
