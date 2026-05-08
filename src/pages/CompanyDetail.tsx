import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Globe, Linkedin, Github, Check, X, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { supabase, type Protocol } from "@/lib/supabase";
import type { Company, FundingRound } from "@/lib/companies";
import { formatTvl, formatPct, normalizeTwitterUrl } from "@/lib/format";
import { RiskBadge } from "@/components/RiskBadge";
import { LangBadge } from "@/components/LangBadge";
import { CompanyLogo } from "@/components/CompanyLogo";
import { CompanyGithubActivity } from "@/components/CompanyGithubActivity";
import { GithubActivityCard } from "@/components/GithubActivityCard";
import { fetchLlamaTvl } from "@/lib/liveData";

type AuditReportRow = {
  protocol_slug: string | null;
  company_slug: string | null;
  protocol_name: string | null;
  audit_firm: string | null;
  audit_date: string | null;
  report_url: string | null;
  findings_critical: number | null;
  findings_high: number | null;
  findings_medium: number | null;
  finding_count: number | null;
  smart_contract_language: string | null;
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

function parseInvestors(v: unknown): string[] {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : String(v).split(/[;,]/);
  return arr.map((s) => String(s).trim()).filter(Boolean);
}

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const ROUND_COLORS: Record<string, string> = {
  seed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  pre_seed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "pre-seed": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  series_a: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  "series a": "bg-sky-500/15 text-sky-300 border-sky-500/30",
  series_b: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  "series b": "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  series_c: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  "series c": "bg-violet-500/15 text-violet-300 border-violet-500/30",
  strategic: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  grant: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  ico: "bg-pink-500/15 text-pink-300 border-pink-500/30",
};

function roundPillColor(t: string | null | undefined): string {
  const k = (t || "").toLowerCase().trim();
  return ROUND_COLORS[k] || "bg-white/5 text-white border-white/10";
}

function InvestorAvatar({ name, logo }: { name: string; logo: string | null | undefined }) {
  const [failed, setFailed] = useState(false);
  const initial = (name?.trim()?.[0] || "?").toUpperCase();
  if (!logo || failed) {
    return (
      <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-sm font-semibold text-muted-foreground">
        {initial}
      </div>
    );
  }
  return (
    <img
      src={logo}
      alt=""
      className="w-10 h-10 rounded-full bg-white/5 border border-white/10 object-contain"
      onError={() => setFailed(true)}
    />
  );
}

function ExpandedInvestors({
  leads,
  others,
  fundLogo,
}: {
  leads: string[];
  others: string[];
  fundLogo: (n: string) => string | null;
}) {
  const all = Array.from(new Set([...leads, ...others]));
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? all : all.slice(0, 4);
  const hiddenCount = all.length - visible.length;
  return (
    <div className="bg-white/[0.04] border-l-2 border-teal-400 px-4 py-4 space-y-3">
      {all.length > 0 && (
        <div className="flex flex-wrap items-start gap-4">
          {visible.map((inv) => (
            <div key={inv} className="flex flex-col items-center gap-1.5 w-20">
              <InvestorAvatar name={inv} logo={fundLogo(inv)} />
              <div className="text-[11px] text-muted-foreground text-center leading-tight line-clamp-2">{inv}</div>
            </div>
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xs font-semibold text-muted-foreground hover:text-white hover:bg-white/10 transition-colors self-start"
            >
              +{hiddenCount}
            </button>
          )}
        </div>
      )}
      {leads.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Led by <span className="text-teal-400 font-medium">{leads.join(", ")}</span>
        </div>
      )}
      {others.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <span className="uppercase tracking-wider">Other Investors:</span>{" "}
          <span className="text-white">{others.join(", ")}</span>
        </div>
      )}
    </div>
  );
}

function CompanyDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 300;
  const display = !isLong || expanded ? text : text.slice(0, 300).trimEnd() + "…";
  return (
    <div className="mt-3 max-w-3xl">
      <p className="text-sm text-muted-foreground whitespace-pre-line">{display}</p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-primary hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
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
        .eq("parent_slug", slug)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as Protocol[];
    },
  });

  const protoSlugs = (protocols.data || []).map((p) => p.slug);

  const liveTvl = useQuery({
    queryKey: ["company-live-tvl", protoSlugs.join(",")],
    enabled: protoSlugs.length > 0,
    queryFn: async () => {
      const vals = await Promise.all(protoSlugs.map((s) => fetchLlamaTvl(s)));
      const valid = vals.filter((v): v is number => v != null);
      return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) : null;
    },
  });

  const protocolGithubUrls = (protocols.data || [])
    .flatMap((p) => (Array.isArray(p.github) ? p.github : []))
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  // Extract first valid org name from any child protocol's github URL
  const firstOrg = (() => {
    for (const u of protocolGithubUrls) {
      try {
        const parsed = new URL(u);
        if (!/github\.com$/i.test(parsed.hostname)) continue;
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (parts[0]) return parts[0];
      } catch { /* ignore */ }
    }
    return null;
  })();
  // eslint-disable-next-line no-console
  console.log("[CompanyDetail] github URLs", slug, protocolGithubUrls, "→ org:", firstOrg);
  const firstGithubUrl = firstOrg ? `https://github.com/${firstOrg}` : null;

  const allInvestorNames = Array.from(
    new Set(
      (funding.data || []).flatMap((r) => [
        ...parseInvestors(r.lead_investors),
        ...parseInvestors((r as any).other_investors),
        ...parseInvestors((r as any).all_investors),
      ]),
    ),
  );

  const fundsLookup = useQuery({
    queryKey: ["fund-logos", allInvestorNames.sort().join("|")],
    enabled: allInvestorNames.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funds")
        .select("name,logo")
        .in("name", allInvestorNames);
      if (error) throw error;
      const map = new Map<string, string | null>();
      (data || []).forEach((f: { name: string; logo: string | null }) => {
        map.set(f.name.toLowerCase(), f.logo);
      });
      return map;
    },
  });

  const fundLogo = (name: string): string | null => {
    const m = fundsLookup.data;
    if (!m) return null;
    return m.get(name.toLowerCase()) ?? null;
  };

  const audits = useQuery({
    queryKey: ["company-audits", slug, protoSlugs.join(",")],
    enabled: !!slug,
    queryFn: async () => {
      const orFilters: string[] = [`company_slug.eq.${slug}`];
      if (protoSlugs.length > 0) {
        orFilters.push(`protocol_slug.in.(${protoSlugs.join(",")})`);
      }
      const { data, error } = await supabase
        .from("audit_history")
        .select("*")
        .or(orFilters.join(","))
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
  const totalTvl = liveTvl.data ?? null;
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
              {c.description && <CompanyDescription text={c.description} />}
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
            <div className="font-mono text-lg font-bold text-teal-400 mt-1">
              {liveTvl.isLoading ? <span className="text-muted-foreground">…</span> : totalTvl != null ? formatTvl(totalTvl) : "—"}
            </div>
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
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* FUNDING */}
        <div className="as-card p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Funding</h3>
          {funding.isLoading ? (
            <div className="h-24 bg-white/[0.03] rounded animate-pulse" />
          ) : funding.data && funding.data.length > 0 ? (
            <div className="space-y-2">
              {funding.data.map((r) => {
                const others = (r as any).other_investors;
                const all = (r as any).all_investors;
                const isOpen = expandedRound === r.id;
                const leadArr = parseInvestors(r.lead_investors);
                const otherArr = parseInvestors(others || all).filter((n) => !leadArr.includes(n));
                return (
                  <div
                    key={r.id}
                    className={`rounded overflow-hidden ${isOpen ? "border-l-2 border-teal-400" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedRound(isOpen ? null : r.id)}
                      className="w-full flex items-center gap-3 px-3 py-3 bg-white/[0.02] hover:bg-white/[0.04] transition-colors text-left"
                    >
                      <span className="font-mono text-xs text-muted-foreground whitespace-nowrap w-20">{fmtMonthYear(r.date)}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${roundPillColor(r.round_type)}`}>
                        {r.round_type || "—"}
                      </span>
                      <span className="flex-1" />
                      <span className="font-mono text-lg font-semibold text-teal-400 whitespace-nowrap">{fmtAmount(r.amount_usd)}</span>
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                    <div
                      className={`grid transition-all duration-300 ease-out ${
                        isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                      }`}
                    >
                      <div className="overflow-hidden">
                        <ExpandedInvestors leads={leadArr} others={otherArr} fundLogo={fundLogo} />
                      </div>
                    </div>
                  </div>
                );
              })}
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
                    <th className="text-left py-2">Category</th>
                    <th className="text-left py-2">Language</th>
                    <th className="text-left py-2">Chains</th>
                    <th className="text-left py-2">Last Audit</th>
                  </tr>
                </thead>
                <tbody>
                  {ps.map((p) => (
                    <tr key={p.slug} onClick={() => navigate(`/protocols/${p.slug}`)} className="border-t border-white/[0.04] hover:bg-white/[0.02] cursor-pointer">
                      <td className="py-2 text-white font-medium">{p.name}</td>
                      <td className="py-2 text-muted-foreground">{p.category || "—"}</td>
                      <td className="py-2"><LangBadge language={p.smart_contract_language} /></td>
                      <td className="py-2 text-muted-foreground text-xs">{(p.chains && p.chains.length > 0) ? p.chains.slice(0, 4).join(", ") + (p.chains.length > 4 ? ` +${p.chains.length - 4}` : "") : "—"}</td>
                      <td className="py-2 font-mono text-xs text-muted-foreground">{p.last_audit_date || "—"}</td>
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

      <CompanyGithubActivity githubUrls={protocolGithubUrls} />

      {firstGithubUrl && (
        <GithubActivityCard githubUrls={[firstGithubUrl]} protocolName={c.name} />
      )}


      {/* AUDIT HISTORY */}
      <div className="as-card p-5">
        <h3 className="text-sm font-semibold text-white mb-3">Audit History</h3>
        {audits.isLoading ? (
          <div className="h-24 bg-white/[0.03] rounded animate-pulse" />
        ) : audits.data && audits.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left py-2">Firm</th>
                  <th className="text-left py-2">Date</th>
                  <th className="text-left py-2">Protocol</th>
                  <th className="text-left py-2">Language</th>
                  <th className="text-right py-2">Report</th>
                </tr>
              </thead>
              <tbody>
                {audits.data.map((a, i) => (
                  <tr key={i} className="border-t border-white/[0.04]">
                    <td className="py-2 font-semibold text-white">{a.audit_firm || "—"}</td>
                    <td className="py-2 font-mono text-xs text-muted-foreground">
                      {a.audit_date ? fmtMonthYear(a.audit_date) : "Date unknown"}
                    </td>
                    <td className="py-2 text-white">{a.protocol_name || a.protocol_slug || "—"}</td>
                    <td className="py-2">
                      {a.smart_contract_language ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-white/[0.05] text-xs text-white border border-white/10">
                          {a.smart_contract_language}
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
                ))}
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
