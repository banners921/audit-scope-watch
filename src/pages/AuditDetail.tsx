import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, ExternalLink, Github, GitCompare, RefreshCw, ShieldCheck, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";
import { AuditTypeBadge } from "@/components/AuditTypeBadge";

type Audit = {
  id: string;
  protocol_name: string | null;
  company_slug: string | null;
  audit_firm: string | null;
  audit_date: string | null;
  audit_type: string | null;
  report_url: string | null;
  findings_critical: number | null;
  findings_high: number | null;
  findings_medium: number | null;
  findings_low: number | null;
  findings_informational: number | null;
  ai_summary: string | null;
  audited_repo_url: string | null;
  audited_commit_hash: string | null;
  repo_url_status: string | null;
  smart_contract_language: string | null;
  audited_chains: string[] | null;
};

type CodeChanges = {
  owner: string;
  repo: string;
  base_commit: string;
  default_branch: string | null;
  head_sha: string | null;
  compare_status: string | null;
  ahead_by: number | null;
  behind_by: number | null;
  files_changed: number | null;
  additions: number | null;
  deletions: number | null;
  files_truncated: boolean;
  compare_url: string | null;
  error: string | null;
  fetched_at: string;
};

const SEV: { key: keyof Audit; label: string; cls: string }[] = [
  { key: "findings_critical", label: "Critical", cls: "text-rose-300 bg-rose-500/10 border-rose-500/25" },
  { key: "findings_high", label: "High", cls: "text-orange-300 bg-orange-500/10 border-orange-500/25" },
  { key: "findings_medium", label: "Medium", cls: "text-amber-300 bg-amber-500/10 border-amber-500/25" },
  { key: "findings_low", label: "Low", cls: "text-sky-300 bg-sky-500/10 border-sky-500/25" },
  { key: "findings_informational", label: "Info", cls: "text-muted-foreground bg-white/[0.03] border-white/[0.08]" },
];

function shortRepo(u: string) { return u.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/$/, ""); }

export default function AuditDetail() {
  const { id = "" } = useParams();

  const auditQ = useQuery({
    queryKey: ["audit-detail", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_history")
        .select("id,protocol_name,company_slug,audit_firm,audit_date,audit_type,report_url,findings_critical,findings_high,findings_medium,findings_low,findings_informational,ai_summary,audited_repo_url,audited_commit_hash,repo_url_status,smart_contract_language,audited_chains")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as Audit | null;
    },
  });
  const a = auditQ.data;

  const companyQ = useQuery({
    queryKey: ["audit-detail-company", a?.company_slug],
    enabled: !!a?.company_slug,
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("slug,name,logo,url").eq("slug", a!.company_slug!).maybeSingle();
      return data as { slug: string; name: string; logo: string | null; url: string | null } | null;
    },
  });

  if (auditQ.isLoading) return <div className="max-w-[960px] mx-auto as-card p-6 text-center text-sm text-muted-foreground">Loading…</div>;
  if (auditQ.error) return <div className="max-w-[960px] mx-auto as-card p-6 text-center text-sm text-red-400">Failed to load audit.</div>;
  if (!a) return <div className="max-w-[960px] mx-auto as-card p-6 text-center text-sm text-muted-foreground">Audit not found.</div>;

  const company = companyQ.data;
  const title = company?.name || a.protocol_name || "Unknown project";
  const anyFindings = SEV.some((s) => (a[s.key] as number | null) != null);
  const summary = a.ai_summary && a.ai_summary !== "NOT_AN_AUDIT_REPORT" ? a.ai_summary : null;

  return (
    <div className="max-w-[960px] mx-auto space-y-4">
      <header className="as-card p-5 flex flex-wrap items-start gap-4">
        <BrandLogo name={title} url={company?.url} logo={company?.logo} className="w-12 h-12 rounded-lg" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary">Audit</div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight mt-0.5">
            {a.company_slug ? <Link to={`/protocol/${a.company_slug}`} className="hover:text-primary">{title}</Link> : title}
          </h1>
          <div className="mt-1 text-[12.5px] text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              audited by{" "}
              {a.audit_firm ? (
                <Link to={`/auditors/${encodeURIComponent(a.audit_firm)}`} className="text-foreground/90 font-medium hover:text-primary">{a.audit_firm}</Link>
              ) : "unknown firm"}
            </span>
            <span>· {a.audit_date || "date unknown"}</span>
            {a.audit_type && <AuditTypeBadge type={a.audit_type} />}
          </div>
        </div>
        {a.report_url && (
          <a href={a.report_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 text-[12px] font-medium">
            <FileText className="w-3.5 h-3.5" /> Report <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </header>

      <section className="as-card p-5 space-y-3">
        <div className="flex items-center gap-2 text-primary"><ShieldCheck className="w-4 h-4" /><h2 className="text-[13px] font-semibold text-foreground">Findings</h2></div>
        {anyFindings ? (
          <div className="flex flex-wrap gap-2">
            {SEV.map((s) => (
              <span key={s.key} className={`text-[12px] px-2 py-1 rounded border font-mono tabular-nums ${s.cls}`}>
                {(a[s.key] as number | null) ?? "—"} {s.label}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-[12.5px] text-muted-foreground">Findings not parsed from this report yet.</div>
        )}
        {summary && <p className="text-[12.5px] text-muted-foreground leading-relaxed border-l-2 border-primary/30 pl-3">{summary}</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
          {a.smart_contract_language && <span>Language: <span className="text-foreground/90">{a.smart_contract_language}</span></span>}
          {a.audited_chains && a.audited_chains.length > 0 && <span>Chains: <span className="text-foreground/90">{a.audited_chains.join(", ")}</span></span>}
          {a.audited_repo_url && a.repo_url_status === "valid" && (
            <a href={a.audited_repo_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline font-mono">
              <Github className="w-3.5 h-3.5" /> {shortRepo(a.audited_repo_url)}
            </a>
          )}
        </div>
      </section>

      <CodeChangesSection auditId={a.id} />
    </div>
  );
}

// Rendered only when audit_code_change_eligible() says so — the same check the
// edge function enforces. Stats load on demand and are cached per audit.
function CodeChangesSection({ auditId }: { auditId: string }) {
  const qc = useQueryClient();
  const eligibleQ = useQuery({
    queryKey: ["audit-code-eligible", auditId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("audit_code_change_eligible", { p_id: auditId });
      if (error) throw error;
      return data === true;
    },
  });
  const cachedQ = useQuery({
    queryKey: ["audit-code-changes", auditId],
    enabled: eligibleQ.data === true,
    queryFn: async () => {
      const { data, error } = await supabase.from("audit_code_changes").select("*").eq("audit_id", auditId).maybeSingle();
      if (error) throw error;
      return data as CodeChanges | null;
    },
  });
  const fetchM = useMutation({
    mutationFn: async (refresh: boolean) => {
      const { data, error } = await supabase.functions.invoke("audit-code-changes", { body: { audit_id: auditId, refresh } });
      if (error) throw error;
      return data as CodeChanges;
    },
    onSuccess: (row) => qc.setQueryData(["audit-code-changes", auditId], row),
  });

  if (eligibleQ.data !== true) return null;
  const c = cachedQ.data;
  const short = (s: string | null) => (s ? s.slice(0, 7) : "—");

  return (
    <section className="as-card p-5 space-y-3">
      <div className="flex items-center gap-2 text-primary">
        <GitCompare className="w-4 h-4" />
        <h2 className="text-[13px] font-semibold text-foreground flex-1">View code changes since this audit</h2>
        {c && (
          <button
            type="button"
            disabled={fetchM.isPending}
            onClick={() => fetchM.mutate(true)}
            className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            title="Re-fetch from GitHub (at most every 10 minutes)"
          >
            <RefreshCw className={`w-3 h-3 ${fetchM.isPending ? "animate-spin" : ""}`} /> Refresh
          </button>
        )}
      </div>

      {cachedQ.isLoading && <div className="text-[12.5px] text-muted-foreground">Loading…</div>}

      {!cachedQ.isLoading && !c && (
        <div className="flex items-center gap-3 text-[12.5px] text-muted-foreground">
          <span>Compare the audited commit with the repo's current default branch on GitHub.</span>
          <button
            type="button"
            disabled={fetchM.isPending}
            onClick={() => fetchM.mutate(false)}
            className="ml-auto shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 text-[12px] font-medium disabled:opacity-50"
          >
            <GitCompare className="w-3.5 h-3.5" /> {fetchM.isPending ? "Fetching…" : "Fetch diff stats"}
          </button>
        </div>
      )}

      {fetchM.error && <div className="text-[12px] text-red-400">Couldn't fetch: {(fetchM.error as Error).message}</div>}

      {c && (
        <div className="space-y-2.5 text-[12.5px]">
          <div className="text-muted-foreground font-mono text-[12px] flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{c.owner}/{c.repo}</span>
            <span>· audited commit <span className="text-foreground/90">{short(c.base_commit)}</span></span>
            <span>
              → <span className="text-foreground/90">{c.default_branch ?? "default branch"}</span> HEAD at fetch time
              {c.head_sha && <> (<span className="text-foreground/90">{short(c.head_sha)}</span>)</>}
            </span>
          </div>

          {c.error ? (
            <div className="flex items-start gap-2 text-amber-300"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {c.error}</div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 font-mono tabular-nums">
                <span className="px-2 py-1 rounded border border-white/[0.08] bg-white/[0.03]">
                  {c.files_changed?.toLocaleString()}{c.files_truncated ? "+" : ""} files changed
                </span>
                <span className="px-2 py-1 rounded border border-emerald-500/25 bg-emerald-500/10 text-emerald-300">+{c.additions?.toLocaleString()}{c.files_truncated ? "+" : ""}</span>
                <span className="px-2 py-1 rounded border border-rose-500/25 bg-rose-500/10 text-rose-300">−{c.deletions?.toLocaleString()}{c.files_truncated ? "+" : ""}</span>
                {c.ahead_by != null && (
                  <span className="px-2 py-1 rounded border border-white/[0.08] bg-white/[0.03] text-muted-foreground">{c.ahead_by.toLocaleString()} commits</span>
                )}
              </div>
              {c.files_truncated && (
                <div className="text-[11.5px] text-muted-foreground">GitHub lists at most 300 files per comparison; counts cover those files only, so the true totals are higher.</div>
              )}
              {c.compare_status === "diverged" && (
                <div className="text-[11.5px] text-muted-foreground">The audited commit isn't on {c.default_branch}; GitHub compares from the point where the two histories meet.</div>
              )}
              {c.compare_status === "identical" && (
                <div className="text-[11.5px] text-muted-foreground">{c.default_branch} HEAD is the audited commit — no changes since.</div>
              )}
            </>
          )}

          <div className="flex items-center gap-3 text-[11.5px] text-muted-foreground">
            {c.compare_url && (
              <a href={c.compare_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                Open comparison on GitHub <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <span className="ml-auto">fetched {new Date(c.fetched_at).toLocaleString()}</span>
          </div>
        </div>
      )}
    </section>
  );
}
