import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Globe, Twitter, Linkedin, Send, Check, X } from "lucide-react";
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

function investorList(v: FundingRound["lead_investors"]): string {
  if (!v) return "";
  if (Array.isArray(v)) return v.filter(Boolean).join(", ");
  return String(v);
}

export default function CompanyDetail() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();

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
                {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary"><Globe className="w-4 h-4" /></a>}
                {tw && <a href={tw} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary"><Twitter className="w-4 h-4" /></a>}
                {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary"><Linkedin className="w-4 h-4" /></a>}
                {c.telegram && <a href={c.telegram} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary"><Send className="w-4 h-4" /></a>}
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
            <div className="space-y-3">
              {funding.data.map((r) => (
                <div key={r.id} className="border-l-2 border-primary/40 pl-3 py-1">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{r.round_type || "Funding round"}</div>
                      <div className="text-xs text-muted-foreground font-mono">{fmtDate(r.date)}</div>
                    </div>
                    <div className="font-mono text-sm text-teal-400">{r.amount_usd ? formatTvl(r.amount_usd) : "—"}</div>
                  </div>
                  {investorList(r.lead_investors) && (
                    <div className="text-xs text-muted-foreground mt-1">{investorList(r.lead_investors)}</div>
                  )}
                </div>
              ))}
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
