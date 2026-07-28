import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import {
  Building2, ExternalLink, Github, Globe, ArrowLeft, ShieldCheck, Award,
  Bug, AlertTriangle, FileText,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { CompanyGithubActivity } from "@/components/CompanyGithubActivity";

type Company = {
  slug: string; name: string; description: string | null; category: string | null;
  url: string | null; twitter: string | null; github: string[] | null; logo: string | null;
  audit_count: number | null; unique_auditor_count: number | null; last_audit_date: string | null;
  has_bug_bounty: boolean | null; has_been_hacked: boolean | null;
};
type Audit = {
  id: string; audit_firm: string | null; audit_date: string | null; audit_type: string | null;
  report_url: string | null;
  findings_critical: number | null; findings_high: number | null;
  findings_medium: number | null; findings_low: number | null;
};
type Finding = { id: string; severity: string; title: string | null; status: string | null };

const SEV_ORDER = ["critical", "high", "medium", "low"] as const;
const SEV_COLOR: Record<string, string> = {
  critical: "text-rose-300 bg-rose-500/10 border-rose-500/25",
  high: "text-orange-300 bg-orange-500/10 border-orange-500/25",
  medium: "text-amber-300 bg-amber-500/10 border-amber-500/25",
  low: "text-sky-300 bg-sky-500/10 border-sky-500/25",
};

export default function ProtocolDossier() {
  const { slug = "" } = useParams();

  const companyQ = useQuery({
    queryKey: ["dossier-company", slug],
    queryFn: async () => {
      const { data } = await supabase.from("companies")
        .select("slug,name,description,category,url,twitter,github,logo,audit_count,unique_auditor_count,last_audit_date,has_bug_bounty,has_been_hacked")
        .eq("slug", slug).maybeSingle();
      return data as Company | null;
    },
  });

  const auditsQ = useQuery({
    queryKey: ["dossier-audits", slug],
    queryFn: async () => {
      const { data } = await supabase.from("audit_history")
        .select("id,audit_firm,audit_date,audit_type,report_url,findings_critical,findings_high,findings_medium,findings_low")
        .eq("company_slug", slug)
        .order("audit_date", { ascending: false, nullsFirst: false })
        .limit(100);
      return (data ?? []) as Audit[];
    },
  });

  const findingsQ = useQuery({
    queryKey: ["dossier-findings", slug],
    queryFn: async () => {
      const { data } = await supabase.from("audit_findings_detail")
        .select("id,severity,title,status")
        .eq("company_slug", slug)
        .limit(500);
      return (data ?? []) as Finding[];
    },
  });

  const hacksQ = useQuery({
    queryKey: ["dossier-hacks", slug],
    queryFn: async () => {
      const { count } = await supabase.from("hacks")
        .select("id", { count: "exact", head: true })
        .eq("company_slug", slug);
      return count ?? 0;
    },
  });

  const c = companyQ.data;
  const audits = auditsQ.data ?? [];
  const findings = findingsQ.data ?? [];

  if (companyQ.isLoading) return <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>;
  if (!c) return (
    <div className="max-w-[900px] mx-auto p-10 text-center">
      <div className="text-sm text-muted-foreground">Company not found.</div>
      <Link to="/companies" className="text-primary text-sm hover:underline mt-2 inline-block">← Back to companies</Link>
    </div>
  );

  const auditors = Array.from(new Set(audits.map((a) => a.audit_firm).filter(Boolean))) as string[];
  const sevTotals = SEV_ORDER.reduce((acc, s) => {
    acc[s] = findings.filter((f) => f.severity === s).length;
    return acc;
  }, {} as Record<string, number>);
  const totalFindings = SEV_ORDER.reduce((n, s) => n + sevTotals[s], 0);
  const notable = findings
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .slice(0, 8);

  const firstSentence = c.description?.split(/(?<=[.!?])\s/)[0]?.slice(0, 220);
  const summary = firstSentence
    || `${c.name}${c.category ? ` is a ${c.category} project` : ""}${audits.length ? `, audited ${audits.length} time${audits.length === 1 ? "" : "s"} by ${auditors.length} firm${auditors.length === 1 ? "" : "s"}` : ""}.`;
  const hackCount = hacksQ.data ?? 0;

  // Smart, simple insight line derived from audit history
  const dated = audits.map((a) => a.audit_date).filter(Boolean).map((d) => new Date(d as string).getTime()).sort((a, b) => a - b);
  const insight: string[] = [];
  if (dated.length >= 2) {
    const cadence = Math.round((dated[dated.length - 1] - dated[0]) / 86400000 / (dated.length - 1));
    if (cadence > 0) insight.push(`Audited about every ${cadence >= 60 ? `${Math.round(cadence / 30)} months` : `${cadence} days`}`);
  }
  if (auditors.length >= 3) insight.push(`rotates between ${auditors.length} firms`);
  else if (auditors.length === 2) insight.push(`uses 2 firms (${auditors.join(", ")})`);
  else if (auditors.length === 1) insight.push(`sticks with ${auditors[0]}`);
  if (dated.length) {
    const lastDays = Math.round((Date.now() - dated[dated.length - 1]) / 86400000);
    insight.push(`last audit ${lastDays <= 0 ? "today" : `${lastDays}d ago`}`);
  }

  return (
    <div className="max-w-[900px] mx-auto space-y-5">
      <Link to="/companies" className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> Companies
      </Link>

      {/* Header */}
      <div className="as-card p-6">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-xl bg-white/[0.04] flex items-center justify-center overflow-hidden shrink-0">
            {c.logo ? <img src={c.logo} alt="" className="w-full h-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
              : <Building2 className="w-6 h-6 text-muted-foreground" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold text-foreground tracking-tight">{c.name}</h1>
              {c.category && <span className="text-[11px] px-2 py-0.5 rounded border border-primary/25 bg-primary/[0.08] text-primary">{c.category}</span>}
              {c.has_bug_bounty && <span className="text-[11px] px-2 py-0.5 rounded border border-white/10 text-muted-foreground inline-flex items-center gap-1"><Bug className="w-3 h-3" />Bug bounty</span>}
              {(hackCount > 0 || c.has_been_hacked) && <span className="text-[11px] px-2 py-0.5 rounded border border-amber-500/25 bg-amber-500/10 text-amber-300 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{hackCount > 0 ? `${hackCount} hack${hackCount === 1 ? "" : "s"} in history` : "Prior incident"}</span>}
            </div>
            <p className="text-[13.5px] text-muted-foreground mt-2 leading-relaxed">{summary}</p>
            {insight.length > 0 && (
              <p className="text-[12px] text-primary/80 mt-1.5">{insight.join(" · ")}</p>
            )}
            <div className="flex items-center gap-3 mt-3 text-[12px]">
              {c.url && <a href={safeUrl(c.url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary"><Globe className="w-3.5 h-3.5" />Website</a>}
              {c.twitter && <a href={`https://x.com/${c.twitter.replace(/^@/, "")}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary"><ExternalLink className="w-3.5 h-3.5" />X</a>}
              {c.github?.[0] && <a href={ghUrl(c.github[0])} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary"><Github className="w-3.5 h-3.5" />GitHub</a>}
            </div>
          </div>
        </div>
        {/* stat row */}
        <div className="grid grid-cols-3 gap-3 mt-5 pt-4 border-t border-white/[0.06]">
          <Stat label="Audits" value={audits.length} />
          <Stat label="Auditors" value={auditors.length} />
          <Stat label="Findings" value={totalFindings} />
        </div>
      </div>

      {/* Auditors */}
      {auditors.length > 0 && (
        <Section icon={<Award className="w-4 h-4" />} title="Auditors used">
          <div className="flex flex-wrap gap-2">
            {auditors.map((firm) => (
              <Link key={firm} to={`/auditors/${encodeURIComponent(firm)}`}
                className="text-[12.5px] px-3 py-1.5 rounded-lg border border-white/[0.08] hover:border-primary/40 hover:text-primary transition-colors inline-flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-primary/70" />{firm}
              </Link>
            ))}
          </div>
        </Section>
      )}

      {/* Past findings */}
      {totalFindings > 0 && (
        <Section icon={<AlertTriangle className="w-4 h-4" />} title="Past findings">
          <div className="flex flex-wrap gap-2 mb-3">
            {SEV_ORDER.map((s) => sevTotals[s] > 0 && (
              <span key={s} className={`text-[11.5px] px-2.5 py-1 rounded-md border capitalize ${SEV_COLOR[s]}`}>
                {sevTotals[s]} {s}
              </span>
            ))}
          </div>
          {notable.length > 0 && (
            <ul className="space-y-1.5">
              {notable.map((f) => (
                <li key={f.id} className="flex items-start gap-2 text-[12.5px]">
                  <span className={`mt-0.5 text-[10px] px-1.5 py-0.5 rounded border capitalize shrink-0 ${SEV_COLOR[f.severity]}`}>{f.severity}</span>
                  <span className="text-foreground/90">{f.title || "Untitled finding"}</span>
                  {f.status && <span className="text-muted-foreground text-[11px]">· {f.status}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {/* GitHub activity (live) */}
      {c.github && c.github.length > 0 && (
        <Section icon={<Github className="w-4 h-4" />} title="GitHub activity">
          <CompanyGithubActivity githubUrls={c.github} />
        </Section>
      )}

      {/* Audits list */}
      {audits.length > 0 && (
        <Section icon={<FileText className="w-4 h-4" />} title="Audit history">
          <div className="space-y-1.5">
            {audits.map((a) => (
              <div key={a.id} className="flex items-center gap-3 py-2 px-3 rounded-lg border border-white/[0.05] hover:bg-white/[0.02] text-[12.5px]">
                <div className="flex-1 min-w-0">
                  <div className="text-foreground font-medium truncate">{a.audit_firm || "Unknown firm"}</div>
                  <div className="text-[11px] text-muted-foreground">{a.audit_date || "date unknown"}{a.audit_type ? ` · ${a.audit_type}` : ""}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(["critical", "high", "medium", "low"] as const).map((s) => {
                    const key = `findings_${s}` as keyof Audit;
                    const v = a[key] as number | null;
                    return v ? <span key={s} className={`text-[10px] px-1.5 py-0.5 rounded border ${SEV_COLOR[s]}`}>{v}{s[0].toUpperCase()}</span> : null;
                  })}
                </div>
                {a.report_url && (
                  <a href={a.report_url} target="_blank" rel="noreferrer" className="text-primary hover:text-primary/80 shrink-0" title="Open report">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="as-card p-5">
      <div className="flex items-center gap-2 mb-3 text-primary">
        {icon}<h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums text-foreground">{value.toLocaleString()}</div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function safeUrl(u: string) { return u.startsWith("http") ? u : `https://${u}`; }
function ghUrl(g: string) { return g.startsWith("http") ? g : `https://github.com/${g}`; }
