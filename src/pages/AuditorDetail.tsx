import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ShieldCheck, ExternalLink, Users, Calendar, Github, FileCode, Boxes, FileText, Globe } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { CompanyLogo } from "@/components/CompanyLogo";
import { BrandLogo } from "@/components/BrandLogo";
import { LangBadge } from "@/components/LangBadge";
import { AuditTypeBadge } from "@/components/AuditTypeBadge";
import { ViewToggle, type ViewMode } from "@/components/ViewToggle";

const VIEW_KEY = "as_auditor_clients_view";

type RawAudit = {
  id: string;
  audit_firm: string | null;
  audit_date: string | null;
  audit_type: string | null;
  protocol_slug: string | null;
  protocol_name: string | null;
  company_slug: string | null;
  smart_contract_language: string | null;
  report_url: string | null;
  findings_critical: number | null;
  findings_high: number | null;
  findings_medium: number | null;
  findings_low: number | null;
  audited_repo_url: string | null;
  audited_commit_hash: string | null;
  commit_hash_status: "valid" | "invalid" | "error" | null;
  repo_url_status: "valid" | "invalid" | "error" | null;
  org_url_status: "valid" | "invalid" | "error" | null;
  audited_files: string[] | null;
  audited_chains: string[] | null;
};

type ClientAggregate = {
  companySlug: string | null; // resolved parent company if available
  displayName: string;
  logo: string | null;
  category: string | null;
  audits: RawAudit[];
  auditCount: number;
  firstDate: string | null;
  latestDate: string | null;
  languages: string[];
};

export default function AuditorDetail() {
  const { firm = "" } = useParams();
  const navigate = useNavigate();
  const decoded = useMemo(() => decodeURIComponent(firm), [firm]);

  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "grid";
    return (window.localStorage.getItem(VIEW_KEY) as ViewMode) || "grid";
  });
  useEffect(() => {
    window.localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  const audits = useQuery({
    queryKey: ["auditor-audits", decoded],
    enabled: !!decoded,
    queryFn: async (): Promise<RawAudit[]> => {
      // Case-insensitive equality via ilike on the full string.
      const safe = decoded.replace(/[%,]/g, " ");
      const pageSize = 1000;
      let from = 0;
      const out: RawAudit[] = [];
      while (true) {
        const { data, error } = await supabase
          .from("audit_history")
          .select(
            "id,audit_firm,audit_date,audit_type,protocol_slug,protocol_name,company_slug,smart_contract_language,report_url,findings_critical,findings_high,findings_medium,findings_low,audited_repo_url,audited_commit_hash,commit_hash_status,repo_url_status,org_url_status,audited_files,audited_chains",
          )
          .ilike("audit_firm", safe)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const rows = (data || []) as RawAudit[];
        out.push(...rows);
        if (rows.length < pageSize) break;
        from += pageSize;
      }
      return out;
    },
  });

  const firmMeta = useQuery({
    queryKey: ["auditor-firm-meta", decoded],
    enabled: !!decoded,
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_firm_meta")
        .select("homepage_url,logo_url,social_x,social_github,description,verified")
        .ilike("firm_name", decoded)
        .maybeSingle();
      return data as { homepage_url: string | null; logo_url: string | null; social_x: string | null; social_github: string | null; description: string | null; verified: boolean | null } | null;
    },
  });

  // Resolve display company per audit: prefer company_slug; fall back to protocol parent_slug.
  const protocolSlugsNeedingParent = useMemo(() => {
    const set = new Set<string>();
    for (const a of audits.data || []) {
      if (!a.company_slug && a.protocol_slug) set.add(a.protocol_slug);
    }
    return Array.from(set);
  }, [audits.data]);

  const parents = useQuery({
    queryKey: ["auditor-protocol-parents", protocolSlugsNeedingParent.join(",")],
    enabled: protocolSlugsNeedingParent.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("protocols")
        .select("slug,parent_slug")
        .in("slug", protocolSlugsNeedingParent);
      if (error) throw error;
      const m = new Map<string, string | null>();
      (data || []).forEach((p: { slug: string; parent_slug: string | null }) => m.set(p.slug, p.parent_slug));
      return m;
    },
  });

  function resolveCompanySlug(a: RawAudit): string | null {
    if (a.company_slug) return a.company_slug;
    if (a.protocol_slug) return parents.data?.get(a.protocol_slug) ?? null;
    return null;
  }

  // Aggregate by client key (companySlug or protocol slug fallback)
  const allCompanySlugs = useMemo(() => {
    const s = new Set<string>();
    for (const a of audits.data || []) {
      const cs = resolveCompanySlug(a);
      if (cs) s.add(cs);
    }
    return Array.from(s);
  }, [audits.data, parents.data]);

  const companies = useQuery({
    queryKey: ["auditor-companies", allCompanySlugs.join(",")],
    enabled: allCompanySlugs.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("slug,name,logo,category")
        .in("slug", allCompanySlugs);
      if (error) throw error;
      const m = new Map<string, { slug: string; name: string; logo: string | null; category: string | null }>();
      (data || []).forEach((c: { slug: string; name: string; logo: string | null; category: string | null }) =>
        m.set(c.slug, c),
      );
      return m;
    },
  });

  const clients = useMemo<ClientAggregate[]>(() => {
    const m = new Map<string, ClientAggregate>();
    for (const a of audits.data || []) {
      const cs = resolveCompanySlug(a);
      const key = cs || a.protocol_slug || a.protocol_name || "unknown";
      const comp = cs ? companies.data?.get(cs) : null;
      const entry = m.get(key) || {
        companySlug: cs,
        displayName: comp?.name || a.protocol_name || a.protocol_slug || "Unknown",
        logo: comp?.logo ?? null,
        category: comp?.category ?? null,
        audits: [],
        auditCount: 0,
        firstDate: null,
        latestDate: null,
        languages: [],
      };
      entry.audits.push(a);
      entry.auditCount += 1;
      if (a.audit_date) {
        if (!entry.firstDate || a.audit_date < entry.firstDate) entry.firstDate = a.audit_date;
        if (!entry.latestDate || a.audit_date > entry.latestDate) entry.latestDate = a.audit_date;
      }
      if (a.smart_contract_language) {
        // Normalize to title case (Solidity, Rust, Move, …) and dedup case-insensitively
        const raw = a.smart_contract_language.trim();
        const norm = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
        const exists = entry.languages.some((l) => l.toLowerCase() === norm.toLowerCase());
        if (!exists) entry.languages.push(norm);
      }
      m.set(key, entry);
    }
    return Array.from(m.values()).sort((a, b) => b.auditCount - a.auditCount);
  }, [audits.data, companies.data, parents.data]);

  const totalAudits = audits.data?.length ?? 0;
  const uniqueClients = clients.length;
  const latestAudit = useMemo(() => {
    let d: string | null = null;
    for (const a of audits.data || []) {
      if (a.audit_date && (!d || a.audit_date > d)) d = a.audit_date;
    }
    return d;
  }, [audits.data]);

  return (
    <div className="space-y-5 max-w-[1400px]">
      <button
        onClick={() => navigate(-1)}
        className="text-muted-foreground hover:text-white text-sm flex items-center gap-1.5"
      >
        <ArrowLeft className="w-4 h-4" /> Back to auditors
      </button>

      <div className="as-card p-6">
        <div className="flex items-start gap-4">
          <BrandLogo
            name={decoded}
            url={firmMeta.data?.homepage_url ?? null}
            logo={firmMeta.data?.logo_url ?? null}
            className="w-14 h-14 rounded-xl shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-2xl font-bold text-white capitalize">{decoded}</h2>
              {firmMeta.data?.verified && (
                <span className="text-[9.5px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  Verified
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {totalAudits.toLocaleString()} audits across {uniqueClients} clients
            </p>
            {(firmMeta.data?.homepage_url || firmMeta.data?.social_x || firmMeta.data?.social_github) && (
              <div className="flex items-center gap-3 mt-3 text-[12px]">
                {firmMeta.data?.homepage_url && (
                  <a
                    href={firmMeta.data.homepage_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1.5"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    {firmMeta.data.homepage_url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "")}
                    <ExternalLink className="w-3 h-3 opacity-60" />
                  </a>
                )}
                {firmMeta.data?.social_x && (
                  <a
                    href={`https://x.com/${firmMeta.data.social_x.replace(/^@/, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-white inline-flex items-center gap-1"
                    title={`@${firmMeta.data.social_x.replace(/^@/, "")} on X`}
                  >
                    <span className="font-bold">𝕏</span>
                    <span>@{firmMeta.data.social_x.replace(/^@/, "")}</span>
                  </a>
                )}
                {firmMeta.data?.social_github && (
                  <a
                    href={`https://github.com/${firmMeta.data.social_github}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-white inline-flex items-center gap-1"
                    title={`${firmMeta.data.social_github} on GitHub`}
                  >
                    <Github className="w-3.5 h-3.5" />
                    <span>{firmMeta.data.social_github}</span>
                  </a>
                )}
              </div>
            )}
            {firmMeta.data?.description && (
              <p className="text-[13px] text-muted-foreground/90 leading-relaxed mt-3 max-w-3xl">
                {firmMeta.data.description}
              </p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
          <Stat label="Audits" value={totalAudits} icon={<ShieldCheck className="w-3.5 h-3.5" />} />
          <Stat label="Unique clients" value={uniqueClients} icon={<Users className="w-3.5 h-3.5" />} />
          <Stat
            label="Latest audit"
            value={latestAudit ? format(new Date(latestAudit), "MMM yyyy") : "—"}
            icon={<Calendar className="w-3.5 h-3.5" />}
          />
        </div>
      </div>

      <div className="as-card overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-white">Clients</h3>
          {uniqueClients > 0 && <ViewToggle value={view} onChange={setView} />}
        </div>
        {audits.isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 bg-white/[0.03] rounded animate-pulse" />
            ))}
          </div>
        ) : uniqueClients === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No audits found for this firm.</div>
        ) : view === "grid" ? (
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {clients.map((c) => (
              <ClientCard key={c.companySlug || c.displayName} c={c} />
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {clients.map((c) => (
              <ClientRow key={c.companySlug || c.displayName} c={c} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-bold font-mono text-white">{value}</div>
    </div>
  );
}

function ClientCard({ c }: { c: ClientAggregate }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left p-4 hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex items-start gap-3">
          <CompanyLogo logo={c.logo} url={null} name={c.displayName} className="w-10 h-10 rounded-md shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-white truncate">{c.displayName}</div>
            {c.category && <div className="text-[11px] text-muted-foreground truncate">{c.category}</div>}
          </div>
          <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 shrink-0">
            {c.auditCount} audit{c.auditCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[10px] font-mono text-muted-foreground">
          {c.latestDate && <span>Latest {format(new Date(c.latestDate), "MMM yyyy")}</span>}
          {c.firstDate && c.firstDate !== c.latestDate && <span>· First {format(new Date(c.firstDate), "MMM yyyy")}</span>}
        </div>
        {c.languages.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {c.languages.slice(0, 3).map((l) => (
              <LangBadge key={l} language={l} />
            ))}
          </div>
        )}
      </button>
      {open && <ClientAuditList c={c} />}
    </div>
  );
}

function ClientRow({ c }: { c: ClientAggregate }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-3 py-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 text-left">
        <CompanyLogo logo={c.logo} url={null} name={c.displayName} className="w-8 h-8 rounded-md shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white truncate">{c.displayName}</div>
          <div className="text-[11px] font-mono text-muted-foreground">
            {c.auditCount} audit{c.auditCount === 1 ? "" : "s"}
            {c.latestDate && ` · latest ${format(new Date(c.latestDate), "MMM yyyy")}`}
            {c.firstDate && c.firstDate !== c.latestDate && ` · first ${format(new Date(c.firstDate), "MMM yyyy")}`}
          </div>
        </div>
        <div className="flex flex-wrap gap-1 shrink-0">
          {c.languages.slice(0, 2).map((l) => (
            <LangBadge key={l} language={l} />
          ))}
        </div>
      </button>
      {open && <ClientAuditList c={c} />}
    </li>
  );
}

function ClientAuditList({ c }: { c: ClientAggregate }) {
  // Hide the Findings column if no row has any non-zero parsed findings.
  // 0/0/0/0 here means "we never parsed the report PDF" — showing it implies we know.
  const hasFindings = c.audits.some((a) =>
    ((a.findings_critical ?? 0) + (a.findings_high ?? 0) + (a.findings_medium ?? 0) + (a.findings_low ?? 0)) > 0
  );
  return (
    <div className="bg-white/[0.02] border-t border-white/[0.04] px-3 py-3 space-y-2">
      {c.companySlug && (
        <Link
          to={`/companies/${c.companySlug}`}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          View full company profile <ExternalLink className="w-3 h-3" />
        </Link>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left py-1">Date</th>
              <th className="text-left py-1">Protocol</th>
              <th className="text-left py-1">Repo</th>
              {hasFindings && <th className="text-left py-1">Findings (C/H/M/L)</th>}
              <th className="text-right py-1">Report</th>
            </tr>
          </thead>
          <tbody>
            {c.audits
              .slice()
              .sort((a, b) => (b.audit_date || "").localeCompare(a.audit_date || ""))
              .map((a) => {
                const files = Array.isArray(a.audited_files) ? a.audited_files : [];
                const chains = Array.isArray(a.audited_chains) ? a.audited_chains : [];
                const hasScope = !!a.audited_repo_url || !!a.audited_commit_hash || files.length > 0 || chains.length > 0;
                const colSpan = hasFindings ? 5 : 4;
                // Build a short repo display: owner/repo (commit_hash[:7])
                let repoDisplay: { label: string; href: string; broken?: boolean } | null = null;
                if (a.audited_repo_url) {
                  const m = a.audited_repo_url.match(/github\.com\/([^/]+)\/([^/?#]+)/i);
                  const label = m ? `${m[1]}/${m[2]}` : a.audited_repo_url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
                  // Only clickable when HEAD-verified valid. Org-fallback rescue removed (unreliable).
                  const isBrokenRepo = a.repo_url_status !== "valid";
                  const href = !isBrokenRepo && a.audited_commit_hash && a.commit_hash_status === "valid" && m
                    ? `https://github.com/${m[1]}/${m[2]}/tree/${a.audited_commit_hash}`
                    : a.audited_repo_url;
                  repoDisplay = {
                    label: label.length > 40 ? label.slice(0, 37) + "…" : label,
                    href,
                    broken: isBrokenRepo,
                  };
                }
                return (
                  <Fragment key={a.id}>
                    <tr className="border-t border-white/[0.04]">
                      <td className="py-1.5 text-muted-foreground font-mono">
                        {a.audit_date ? format(new Date(a.audit_date), "MMM d, yyyy") : "—"}
                      </td>
                      <td className="py-1.5 text-white">
                        <span className="inline-flex items-center gap-1.5">
                          <span>{a.protocol_name || a.protocol_slug || "—"}</span>
                          <AuditTypeBadge type={a.audit_type} variant="compact" />
                        </span>
                      </td>
                      <td className="py-1.5">
                        {repoDisplay ? (
                          repoDisplay.broken ? (
                            <span
                              className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/60 font-mono"
                              title="Repo URL from audit no longer resolves on GitHub"
                            >
                              <Github className="w-3 h-3 shrink-0 opacity-50" />
                              <span className="truncate max-w-[260px] line-through decoration-muted-foreground/40">{repoDisplay.label}</span>
                            </span>
                          ) : (
                            <a
                              href={repoDisplay.href}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-primary font-mono"
                            >
                              <Github className="w-3 h-3 shrink-0" />
                              <span className="truncate max-w-[260px]">{repoDisplay.label}</span>
                              {a.audited_commit_hash && <span className="text-[10px] text-muted-foreground/70">@{a.audited_commit_hash.slice(0, 7)}</span>}
                            </a>
                          )
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      {hasFindings && (
                        <td className="py-1.5 font-mono text-muted-foreground">
                          {a.findings_critical ?? 0}/{a.findings_high ?? 0}/{a.findings_medium ?? 0}/{a.findings_low ?? 0}
                        </td>
                      )}
                      <td className="py-1.5 text-right">
                        {a.report_url ? (
                          <a
                            href={a.report_url}
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
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                    {hasScope && (
                      <tr className="border-t border-white/[0.02]">
                        <td colSpan={colSpan} className="py-1.5 pl-3">
                          <div className="flex items-start gap-2 flex-wrap text-[10.5px] text-muted-foreground">
                            <span className="text-muted-foreground/70">↳ scope:</span>
                            {a.audited_repo_url && (
                              <a href={a.audited_repo_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                <Github className="w-3 h-3" />
                                {a.audited_repo_url.replace(/^https?:\/\/(www\.)?(github\.com|gitlab\.com)\//, "").replace(/\/$/, "")}
                              </a>
                            )}
                            {a.audited_commit_hash && (
                              a.commit_hash_status === "valid" && a.audited_repo_url && /github\.com/.test(a.audited_repo_url) ? (
                                <a
                                  href={`${a.audited_repo_url.replace(/\/$/, "")}/tree/${a.audited_commit_hash}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-mono text-primary/80 hover:underline"
                                  title="Verified commit"
                                >
                                  @{a.audited_commit_hash.slice(0, 8)}
                                </a>
                              ) : (
                                <span
                                  className="font-mono text-muted-foreground/85 select-all"
                                  title={a.commit_hash_status === "invalid" ? `Commit not in repo — kept for reference: ${a.audited_commit_hash}` : `Audited at commit ${a.audited_commit_hash}`}
                                >
                                  @{a.audited_commit_hash.slice(0, 8)}
                                </span>
                              )
                            )}
                            {files.length > 0 && (
                              <span className="inline-flex items-center gap-1" title={files.join("\n")}>
                                <FileCode className="w-3 h-3" /> {files.length} file{files.length === 1 ? "" : "s"}
                              </span>
                            )}
                            {chains.length > 0 && (
                              <span className="inline-flex items-center gap-1">
                                <Boxes className="w-3 h-3" /> {chains.slice(0, 4).join(", ")}{chains.length > 4 ? ` +${chains.length - 4}` : ""}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
