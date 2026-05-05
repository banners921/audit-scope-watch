import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Globe, Linkedin, Github, Check, X, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { supabase, type Protocol } from "@/lib/supabase";
import type { Company, FundingRound } from "@/lib/companies";
import { formatTvl, formatPct, normalizeTwitterUrl } from "@/lib/format";
import { RiskBadge } from "@/components/RiskBadge";
import { CompanyLogo } from "@/components/CompanyLogo";

type AuditReportRow = {
  protocol_slug: string;
  audit_firm: string | null;
  audit_date: string | null;
  report_url: string | null;
  findings_critical: number | null;
  findings_high: number | null;
  findings_medium: number | null;
  finding_count: number | null;
};

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return format(dt, "MMM d, yyyy");
}

function fmtMonthYear(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return format(dt, "MMM yyyy");
}

function fmtAmount(n: number | null | undefined) {
  if (n == null || Number(n) === 0) return "Undisclosed";
  const v = Number(n);
  if (v >= 1e9) return `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function investorList(v: FundingRound["lead_investors"] | null | undefined): string {
  if (!v) return "";
  if (Array.isArray(v)) return v.filter(Boolean).join(", ");
  return String(v);
}

export default function CompanyDetail() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const [expandedRound, setExpandedRound] = useState<string | null>(null);

  const company = useQuery({
    queryKey: ["company", slug],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("*").eq("slug", slug).maybeSingle();
      if (error) throw error;
      return data as Company | null;
    },
  });

  const funding = useQuery({
    queryKey: ["company-funding", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funding_rounds")
        .select("*")
        .eq("company_slug", slug)
        .order("date", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data || []) as FundingRound[];
    },
  });

  const protocols = useQuery({
    queryKey: ["company-protocols", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("protocols")
        .select("*")
        .eq("company_slug", slug)
        .order("tvl_usd", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data || []) as Protocol[];
    },
  });

  const protoSlugs = (protocols.data || []).map((p) => p.slug);

  const audits = useQuery({
    queryKey: ["company-audits", slug, protoSlugs.join(",")],
    enabled: protoSlugs.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_reports")
        .select("*")
        .in("protocol_slug", protoSlugs)
        .order("audit_date", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data || []) as AuditReportRow[];
    },
  });

  if (company.isLoading) return <div className="text-muted-foreground">Loading company…</div>;
  if (!company.data) return <div className="text-muted-foreground">Company not found.</div>;

  const c = company.data;
  const tw = normalizeTwitterUrl(c.twitter);

  // Aggregate signals
  const ps = protocols.data || [];
  const totalTvl = ps.reduce((s, p) => s + (p.tvl_usd ?? 0), 0);
  const maxRisk = ps.reduce<number | null>((m, p) => {
    if (p.security_score == null) return m;
    return m == null || p.security_score > m ? p.security_score : m;
  }, null);
  const mostRecentAudit = ps.reduce<string | null>((m, p) => {
    if (!p.last_audit_date) return m;
    return !m || p.last_audit_date > m ? p.last_audit_date : m;
  }, null);
  const anyHacked = ps.some((p) => p.has_been_hacked);
  const anyBounty = ps.some((p) => p.has_bug_bounty);

  return (
    <div className="space-y-5 max-w-[1400px]">
      <Link to="/companies" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-white">
        <ArrowLeft className="w-3 h-3" /> Back to companies
      </Link>

      {/* HEADER */}
      <div className="as-card p-6">
        <div className="flex flex-col lg:flex-row lg:items-start gap-6">
          <div className="flex items-start gap-4 flex-1 min-w-0">
            <CompanyLogo logo={c.logo} url={c.url} name={c.name} className="w-14 h-14 rounded-xl" />
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-bold text-white truncate">{c.name}</h2>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {c.category && <span className="text-xs px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">{c.category}</span>}
                {c.industry && <span className="text-xs px-2 py-0.5 rounded-md bg-white/5 text-muted-foreground border border-white/10">{c.industry}</span>}
                {c.company_type && <span className="text-xs px-2 py-0.5 rounded-md bg-white/5 text-muted-foreground border border-white/10">{c.company_type}</span>}
              </div>
              {c.description && <p className="text-sm text-muted-foreground mt-3 max-w-3xl">{c.description}</p>}
              <div className="flex items-center gap-3 mt-3">
                {(() => {
                  const gh = (c as unknown as { github?: string | null }).github || null;
                  const icon = "w-4 h-4";
                  const link = "text-muted-foreground hover:text-primary";
                  const XLogo = (
                    <svg viewBox="0 0 24 24" className={icon} fill="currentColor" aria-hidden="true">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  );
                  const Telegram = (
                    <svg viewBox="0 0 24 24" className={icon} fill="currentColor" aria-hidden="true">
                      <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
                    </svg>
                  );
                  const Discord = (
                    <svg viewBox="0 0 24 24" className={icon} fill="currentColor" aria-hidden="true">
                      <path d="M20.317 4.369A19.79 19.79 0 0016.558 3.2a.074.074 0 00-.079.037c-.34.607-.719 1.4-.984 2.022a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.997-2.022.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.369a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.056 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.027c.462-.63.873-1.295 1.226-1.994a.076.076 0 00-.041-.105 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.077-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 01.078.01c.12.099.246.197.372.291a.077.077 0 01-.006.128 12.3 12.3 0 01-1.873.891.077.077 0 00-.04.106c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.84 19.84 0 006.002-3.03.077.077 0 00.032-.055c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 00-.031-.028zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.974 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                    </svg>
                  );
                  return (
                    <>
                      {c.url && <a href={c.url} target="_blank" rel="noreferrer" className={link}><Globe className={icon} /></a>}
                      {tw && <a href={tw} target="_blank" rel="noreferrer" className={link} aria-label="X">{XLogo}</a>}
                      {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer" className={link}><Linkedin className={icon} /></a>}
                      {c.telegram && <a href={c.telegram} target="_blank" rel="noreferrer" className={link} aria-label="Telegram">{Telegram}</a>}
                      {c.discord && <a href={c.discord} target="_blank" rel="noreferrer" className={link} aria-label="Discord">{Discord}</a>}
                      {gh && <a href={gh} target="_blank" rel="noreferrer" className={link}><Github className={icon} /></a>}
                    </>
                  );
                })()}
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground font-mono">
                {(c.location || c.country) && <span>📍 {[c.location, c.country].filter(Boolean).join(", ")}</span>}
                {c.founded_year && <span>Founded {c.founded_year}</span>}
                {c.employee_count && <span>{c.employee_count} employees</span>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SECURITY SIGNALS */}
      <div className="as-card p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Security Signals</h3>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Total TVL</div>
            <div className="font-mono text-lg font-bold text-teal-400 mt-1">{formatTvl(totalTvl)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Highest Risk</div>
            <div className="mt-1"><RiskBadge score={maxRisk} /></div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Most Recent Audit</div>
            <div className="font-mono text-sm text-white mt-1">{mostRecentAudit ? fmtDate(mostRecentAudit) : "—"}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Any Hacked</div>
            <div className="mt-1 text-sm">
              {anyHacked ? <span className="text-destructive font-medium">Yes</span> : <span className="text-success font-medium">No</span>}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Bug Bounty</div>
            <div className="mt-1 text-sm">
              {anyBounty ? <span className="text-success font-medium">Yes</span> : <span className="text-muted-foreground font-medium">No</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* FUNDING */}
        <div className="as-card p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Funding</h3>
          {funding.isLoading ? (
            <div className="h-24 bg-white/[0.03] rounded animate-pulse" />
          ) : funding.data && funding.data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left py-2 pr-3">Date</th>
                    <th className="text-left py-2 pr-3">Round</th>
                    <th className="text-left py-2 pr-3">Amount</th>
                    <th className="text-left py-2 pr-3">Lead Investors</th>
                    <th className="text-left py-2">All Investors</th>
                  </tr>
                </thead>
                <tbody>
                  {funding.data.map((r) => {
                    const all = (r as any).all_investors;
                    return (
                      <tr key={r.id} className="border-t border-white/5">
                        <td className="py-2 pr-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{fmtMonthYear(r.date)}</td>
                        <td className="py-2 pr-3 text-white">{r.round_type || "—"}</td>
                        <td className="py-2 pr-3 font-mono text-teal-400 whitespace-nowrap">{fmtAmount(r.amount_usd)}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{investorList(r.lead_investors) || "—"}</td>
                        <td className="py-2 text-muted-foreground">{investorList(all as any) || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-4">No funding rounds recorded</div>
          )}
        </div>

        {/* DEPLOYMENTS */}
        <div className="as-card p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Deployments</h3>
          {protocols.isLoading ? (
            <div className="h-24 bg-white/[0.03] rounded animate-pulse" />
          ) : ps.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left py-2">Protocol</th>
                    <th className="text-right py-2">TVL</th>
                    <th className="text-right py-2">7d</th>
                    <th className="text-center py-2">Risk</th>
                    <th className="text-left py-2">Last Audit</th>
                    <th className="text-center py-2">Bounty</th>
                  </tr>
                </thead>
                <tbody>
                  {ps.map((p) => (
                    <tr key={p.slug} onClick={() => navigate(`/protocols/${p.slug}`)} className="border-t border-white/[0.04] hover:bg-white/[0.02] cursor-pointer">
                      <td className="py-2 text-white font-medium">{p.name}</td>
                      <td className="py-2 text-right font-mono text-muted-foreground">{(p.tvl_usd ?? 0) > 0 ? formatTvl(p.tvl_usd) : "—"}</td>
                      <td className={`py-2 text-right font-mono ${p.tvl_7d_change == null ? "text-muted-foreground" : p.tvl_7d_change >= 0 ? "text-success" : "text-destructive"}`}>{formatPct(p.tvl_7d_change)}</td>
                      <td className="py-2 text-center"><RiskBadge score={p.security_score} /></td>
                      <td className="py-2 font-mono text-xs text-muted-foreground">{p.last_audit_date || "—"}</td>
                      <td className="py-2 text-center">
                        {p.has_bug_bounty ? <Check className="w-4 h-4 text-success inline" /> : <X className="w-4 h-4 text-destructive inline" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-4">No protocol deployments tracked</div>
          )}
        </div>
      </div>

      {/* AUDIT HISTORY */}
      <div className="as-card p-5">
        <h3 className="text-sm font-semibold text-white mb-3">Audit History</h3>
        {protoSlugs.length === 0 || audits.isLoading ? (
          audits.isLoading ? (
            <div className="h-24 bg-white/[0.03] rounded animate-pulse" />
          ) : (
            <div className="text-sm text-muted-foreground py-4">No audit history found</div>
          )
        ) : audits.data && audits.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left py-2">Protocol</th>
                  <th className="text-left py-2">Firm</th>
                  <th className="text-left py-2">Date</th>
                  <th className="text-left py-2">Findings</th>
                  <th className="text-right py-2">Report</th>
                </tr>
              </thead>
              <tbody>
                {audits.data.map((a, i) => {
                  const cN = a.findings_critical ?? 0;
                  const h = a.findings_high ?? 0;
                  const m = a.findings_medium ?? 0;
                  const pill = "inline-flex items-center px-1.5 py-0.5 rounded font-mono text-[11px] font-semibold border";
                  return (
                    <tr key={i} className="border-t border-white/[0.04]">
                      <td className="py-2 text-white">{a.protocol_slug}</td>
                      <td className="py-2 text-white">{a.audit_firm || "—"}</td>
                      <td className="py-2 font-mono text-xs text-muted-foreground">{a.audit_date || "—"}</td>
                      <td className="py-2">
                        {cN + h + m > 0 ? (
                          <span className="space-x-1">
                            {cN > 0 && <span className={`${pill} bg-destructive/15 text-destructive border-destructive/30`}>{cN}C</span>}
                            {h > 0 && <span className={`${pill} bg-warning/15 text-warning border-warning/30`}>{h}H</span>}
                            {m > 0 && <span className={`${pill} bg-muted text-muted-foreground border-white/10`}>{m}M</span>}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2 text-right">
                        {a.report_url ? (
                          <a href={a.report_url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1 text-xs">
                            View <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground py-4">No audit history found</div>
        )}
      </div>
    </div>
  );
}
