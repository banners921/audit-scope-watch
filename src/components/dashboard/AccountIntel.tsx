import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Crosshair, ExternalLink, Github, Globe, Loader2, MessageSquare, Search, Sparkles, Target, Users, Linkedin, Mail, Star, Send as TelegramIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { fetchLlamaProtocol } from "@/lib/liveData";
import { formatTvl } from "@/lib/format";
import { CompanyLogo } from "@/components/CompanyLogo";
import { LangBadge } from "@/components/LangBadge";
import { RemindButton } from "@/components/RemindButton";
import { FindPeopleDialog } from "@/components/dashboard/FindPeopleDialog";
import { callAnthropic } from "@/lib/anthropic";
import { useAuth } from "@/hooks/useAuth";

type Props = {
  selectedSlug: string | null;
};

type CompanyRow = {
  slug: string;
  name: string;
  logo: string | null;
  url: string | null;
  github: string[] | null;
  twitter: string | null;
  linkedin: string | null;
  telegram: string | null;
  discord: string | null;
  audit_count: number | null;
  unique_auditor_count: number | null;
  has_bug_bounty: boolean | null;
  last_audit_date: string | null;
  last_audit_firm: string | null;
  is_institution: boolean | null;
};

type ProtoRow = {
  slug: string;
  chains: string[] | null;
  smart_contract_language: string | null;
  github: string[] | null;
};

type BountyRow = {
  platform: string | null;
  max_bounty_usd: number | null;
  program_url: string | null;
};

type FundingRow = {
  amount_usd: number | null;
  round_type: string | null;
  date: string | null;
  lead_investors: string | null;
};

type PersonRow = {
  id: string;
  name: string;
  title: string | null;
  role: string | null;
  email: string | null;
  linkedin: string | null;
  twitter: string | null;
  telegram: string | null;
  github: string | null;
  source: string | null;
  is_decision_maker: boolean | null;
  enriched_at: string | null;
  enrichment_confidence: string | null;
};

function monthsAgo(d: string | null | undefined): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24 * 30));
}

function errMsg(e: unknown): string {
  if (!e) return "Unknown error";
  if (e instanceof Error) return e.message;
  if (typeof e === "object") {
    const o = e as { message?: string; details?: string; hint?: string; code?: string };
    if (o.message) return `${o.message}${o.code ? ` (${o.code})` : ""}${o.details ? ` — ${o.details}` : ""}`;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}

function fmtBounty(n: number | null | undefined): string {
  if (!n) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

export function AccountIntel({ selectedSlug }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [brief, setBrief] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);

  const company = useQuery({
    queryKey: ["dashboard-intel-company", selectedSlug],
    enabled: !!selectedSlug,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("slug,name,logo,url,github,twitter,linkedin,telegram,discord,audit_count,unique_auditor_count,has_bug_bounty,last_audit_date,last_audit_firm,is_institution")
        .eq("slug", selectedSlug!)
        .maybeSingle();
      if (error) throw error;
      return data as CompanyRow | null;
    },
  });

  const protocols = useQuery({
    queryKey: ["dashboard-intel-protos", selectedSlug],
    enabled: !!selectedSlug,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("protocols")
        .select("slug,chains,smart_contract_language,github")
        .eq("parent_slug", selectedSlug!);
      if (error) throw error;
      return (data || []) as ProtoRow[];
    },
  });

  const protoSlugs = (protocols.data || []).map((p) => p.slug);

  const tvl = useQuery({
    queryKey: ["dashboard-intel-tvl", protoSlugs.join(",")],
    enabled: protoSlugs.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const vals = await Promise.all(protoSlugs.map((s) => fetchLlamaProtocol(s)));
      const sums = vals.map((v) => v.tvl).filter((v): v is number => v != null);
      return sums.length > 0 ? sums.reduce((a, b) => a + b, 0) : null;
    },
  });

  const bounty = useQuery({
    queryKey: ["dashboard-intel-bounty", selectedSlug, protoSlugs.join(",")],
    enabled: !!selectedSlug,
    queryFn: async () => {
      // Bug bounties can be company-level OR protocol-level. Match either.
      const orFilters: string[] = [`company_slug.eq.${selectedSlug}`];
      if (protoSlugs.length > 0) orFilters.push(`protocol_slug.in.(${protoSlugs.join(",")})`);
      const { data, error } = await supabase
        .from("bug_bounties")
        .select("platform,max_bounty_usd,program_url")
        .or(orFilters.join(","))
        .order("max_bounty_usd", { ascending: false, nullsFirst: false })
        .limit(1);
      if (error) throw error;
      return ((data && data[0]) as BountyRow | undefined) || null;
    },
  });

  // Derive audit data straight from audit_history — companies.last_audit_date is often stale/null
  // even when audits exist. Match audits attached either to company_slug or to any child protocol.
  const auditHistory = useQuery({
    queryKey: ["dashboard-intel-audits", selectedSlug, protoSlugs.join(",")],
    enabled: !!selectedSlug,
    queryFn: async () => {
      const orFilters: string[] = [`company_slug.eq.${selectedSlug}`];
      if (protoSlugs.length > 0) orFilters.push(`protocol_slug.in.(${protoSlugs.join(",")})`);
      const { data, error } = await supabase
        .from("audit_history")
        .select("audit_firm,audit_date")
        .or(orFilters.join(","));
      if (error) throw error;
      return (data || []) as { audit_firm: string | null; audit_date: string | null }[];
    },
  });

  const derivedLatestAudit = useMemo(() => {
    if (!auditHistory.data || auditHistory.data.length === 0) return null;
    let best: { date: string; firm: string | null } | null = null;
    for (const a of auditHistory.data) {
      if (!a.audit_date) continue;
      if (!best || a.audit_date > best.date) best = { date: a.audit_date, firm: a.audit_firm };
    }
    return best;
  }, [auditHistory.data]);

  const derivedAuditCount = auditHistory.data?.length ?? 0;
  const derivedUniqueFirms = useMemo(() => {
    const set = new Set<string>();
    (auditHistory.data || []).forEach((a) => {
      if (a.audit_firm) set.add(a.audit_firm.toLowerCase().trim());
    });
    return set.size;
  }, [auditHistory.data]);

  const funding = useQuery({
    queryKey: ["dashboard-intel-funding", selectedSlug],
    enabled: !!selectedSlug,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funding_rounds")
        .select("amount_usd,round_type,date,lead_investors")
        .eq("company_slug", selectedSlug!)
        .order("date", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data || []) as FundingRow[];
    },
  });

  const people = useQuery({
    queryKey: ["dashboard-intel-people", selectedSlug],
    enabled: !!selectedSlug,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_people")
        .select("id,name,title,role,email,linkedin,twitter,telegram,github,source,is_decision_maker,enriched_at,enrichment_confidence")
        .eq("company_slug", selectedSlug!)
        .order("is_decision_maker", { ascending: false })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as PersonRow[];
    },
  });

  const saved = useQuery({
    queryKey: ["dashboard-saved", user?.id, selectedSlug],
    enabled: !!user && !!selectedSlug,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_targets")
        .select("id")
        .eq("user_id", user!.id)
        .eq("company_slug", selectedSlug!)
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return !!data;
    },
  });

  const chains = Array.from(new Set((protocols.data || []).flatMap((p) => p.chains || []))).filter(Boolean);
  const language = (protocols.data || []).map((p) => p.smart_contract_language).find(Boolean) || null;
  const githubUrls = Array.from(
    new Set(
      [
        ...((company.data?.github as string[] | null) || []),
        ...((protocols.data || []).flatMap((p) => p.github || [])),
      ].filter(Boolean),
    ),
  );

  async function onSaveTarget() {
    if (!user) {
      toast.error("You must be signed in to save targets.");
      return;
    }
    if (!selectedSlug || !company.data) return;
    try {
      if (saved.data) {
        const { error } = await supabase
          .from("saved_targets")
          .delete()
          .eq("user_id", user.id)
          .eq("company_slug", selectedSlug);
        if (error) throw error;
        toast.success(`Removed ${company.data.name} from saved targets`);
      } else {
        const { error } = await supabase.from("saved_targets").insert({
          user_id: user.id,
          company_slug: selectedSlug,
          company_name: company.data.name,
          company_logo: company.data.logo,
        });
        if (error) throw error;
        toast.success(`Saved ${company.data.name}`);
      }
      qc.invalidateQueries({ queryKey: ["saved-target-slugs"] });
      qc.invalidateQueries({ queryKey: ["saved-targets"] });
      qc.invalidateQueries({ queryKey: ["dashboard-saved"] });
    } catch (e) {
      console.error("[saved_targets toggle]", e);
      toast.error(`Save failed: ${errMsg(e)}`);
    }
  }

  async function onGenerateBrief() {
    if (!company.data) return;
    setBriefError(null);
    setBriefLoading(true);
    setBrief(null);
    try {
      const effectiveAuditDate = derivedLatestAudit?.date ?? company.data.last_audit_date;
      const effectiveAuditFirm = derivedLatestAudit?.firm ?? company.data.last_audit_firm;
      const effectiveAuditCount = derivedAuditCount || (company.data.audit_count ?? 0);
      const effectiveUniqueFirms = derivedUniqueFirms || (company.data.unique_auditor_count ?? 0);
      const m = monthsAgo(effectiveAuditDate);
      const auditLine = effectiveAuditDate
        ? `${effectiveAuditFirm || "unknown firm"} on ${effectiveAuditDate} (${m ?? "?"} months ago)`
        : "never audited";
      const tvlLine = tvl.data != null ? formatTvl(tvl.data) : "unknown";
      const bountyLine = bounty.data
        ? `yes — ${bounty.data.platform || "platform unknown"}, max ${fmtBounty(bounty.data.max_bounty_usd)}`
        : "no bug bounty program";
      const latestFunding = funding.data && funding.data.length > 0 ? funding.data[0] : null;
      const totalRaised = (funding.data || []).reduce((s, r) => s + (Number(r.amount_usd) || 0), 0);
      const fundingLine = latestFunding
        ? `${latestFunding.round_type || "round"} ${fmtBounty(latestFunding.amount_usd)} ${
            latestFunding.lead_investors ? `led by ${latestFunding.lead_investors}` : ""
          } ${latestFunding.date ? `(${latestFunding.date})` : ""}${
            funding.data && funding.data.length > 1 ? ` · ${funding.data.length} rounds, ${fmtBounty(totalRaised)} total` : ""
          }`.trim()
        : "no recorded funding";

      const userMsg = `Generate a sales brief for ${company.data.name}.
Data:
- TVL: ${tvlLine}
- Last audit: ${auditLine}
- Total audits: ${effectiveAuditCount} across ${effectiveUniqueFirms} firms
- Bug bounty: ${bountyLine}
- Chains: ${chains.length > 0 ? chains.join(", ") : "unknown"}
- Language: ${language || "unknown"}
- Recent funding: ${fundingLine}

Write exactly:
1. WHY CALL THEM (2-3 sentences using their actual data)
2. BEST ANGLE (one sentence on the security gap to lead with)
3. OPENING LINE (one cold outreach sentence, hyper specific)

Reference their real numbers. No generic statements.`;

      const text = await callAnthropic({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        system: "You are a web3 security sales intelligence assistant. Be direct and specific. No fluff.",
        messages: [{ role: "user", content: userMsg }],
      });
      setBrief(text);
    } catch (e) {
      setBriefError(e instanceof Error ? e.message : String(e));
    } finally {
      setBriefLoading(false);
    }
  }

  if (!selectedSlug) {
    return (
      <div className="as-card flex flex-col h-full overflow-hidden" style={{ background: "#0F1420", borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <h3 className="text-sm font-semibold text-white">Account Intel</h3>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
          <Crosshair className="w-10 h-10 text-primary/40" />
          <div className="text-sm">Select a target</div>
        </div>
      </div>
    );
  }

  const c = company.data;

  return (
    <div className="as-card flex flex-col h-full overflow-hidden" style={{ background: "#0F1420", borderColor: "rgba(255,255,255,0.08)" }}>
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {c && <CompanyLogo logo={c.logo} url={c.url} name={c.name} className="w-7 h-7 rounded-md shrink-0" />}
          <h3 className="text-sm font-semibold text-white truncate">{c?.name || "Account Intel"}</h3>
        </div>
        <button
          type="button"
          onClick={onGenerateBrief}
          disabled={briefLoading || !c}
          className="as-btn as-btn-primary text-xs py-1.5 px-3 disabled:opacity-50"
        >
          {briefLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          Generate Brief
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {company.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-6 bg-white/[0.03] rounded animate-pulse" />
            ))}
          </div>
        ) : !c ? (
          <div className="text-sm text-muted-foreground">Company not found.</div>
        ) : (
          <>
            <CompanyLinks c={c} />
            <div className="grid grid-cols-2 gap-3 text-xs">
              <Stat label="TVL" value={tvl.isLoading ? "…" : tvl.data != null ? formatTvl(tvl.data) : "—"} accent="text-cyan-400" />
              <Stat
                label="Last Audit"
                value={(() => {
                  const date = derivedLatestAudit?.date ?? c.last_audit_date;
                  const firm = derivedLatestAudit?.firm ?? c.last_audit_firm;
                  if (auditHistory.isLoading) return "…";
                  return date
                    ? `${firm || "Audit"} • ${format(new Date(date), "MMM yyyy")}`
                    : "Never audited";
                })()}
              />
              <Stat
                label="Total Audits"
                value={(() => {
                  const cnt = derivedAuditCount || (c.audit_count ?? 0);
                  const firms = derivedUniqueFirms || (c.unique_auditor_count ?? 0);
                  return `${cnt} across ${firms} firm${firms === 1 ? "" : "s"}`;
                })()}
              />
              <Stat
                label="Bug Bounty"
                value={
                  bounty.data
                    ? `${bounty.data.platform || "Yes"} • ${fmtBounty(bounty.data.max_bounty_usd)}`
                    : c.has_bug_bounty
                      ? "Yes"
                      : "None"
                }
              />
              <Stat
                label="Total Raised"
                value={(() => {
                  const total = (funding.data || []).reduce((s, r) => s + (Number(r.amount_usd) || 0), 0);
                  const n = funding.data?.length ?? 0;
                  if (n === 0) return "—";
                  return `${fmtBounty(total)} · ${n} round${n === 1 ? "" : "s"}`;
                })()}
              />
              <Stat label="Language" value={language ? <LangBadge language={language} /> : "—"} />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Chains:</span>
              {chains.length === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                chains.slice(0, 6).map((ch) => (
                  <span key={ch} className="px-1.5 py-0.5 rounded bg-white/[0.05] text-white border border-white/10">
                    {ch}
                  </span>
                ))
              )}
              {chains.length > 6 && (
                <span className="text-muted-foreground">+{chains.length - 6}</span>
              )}
            </div>

            <FundingHistory rounds={funding.data || []} loading={funding.isLoading} />

            <div className="border-t border-white/[0.05] pt-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
                  <Users className="w-3.5 h-3.5" />
                  People
                  {people.data && people.data.length > 0 && (
                    <span className="font-mono text-[10px]">{people.data.length}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setFindOpen(true)}
                  className="text-xs inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-white/10 bg-white/[0.03] text-muted-foreground hover:text-primary hover:border-white/20"
                >
                  <Search className="w-3 h-3" />
                  Find people
                </button>
              </div>

              {findOpen && (
                <FindPeopleDialog
                  open={findOpen}
                  onClose={() => setFindOpen(false)}
                  companySlug={c.slug}
                  companyName={c.name}
                  companyUrl={c.url}
                  companyCategory={null}
                  isInstitution={c.is_institution}
                  githubUrls={githubUrls}
                />
              )}
              {people.isLoading ? (
                <div className="space-y-1.5">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="h-8 bg-white/[0.03] rounded animate-pulse" />
                  ))}
                </div>
              ) : !people.data || people.data.length === 0 ? (
                <div className="text-xs text-muted-foreground bg-white/[0.02] border border-white/[0.04] rounded-md px-3 py-2">
                  No contacts on file for this account.
                </div>
              ) : (
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {people.data.map((p) => (
                    <PersonItem key={p.id} p={p} companySlug={c.slug} companyName={c.name} />
                  ))}
                </ul>
              )}
            </div>

            {(brief || briefError) && (
              <div className="bg-black/30 border border-primary/30 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs text-primary font-mono uppercase tracking-wider">
                  <Sparkles className="w-3.5 h-3.5" /> Sales brief
                </div>
                {briefError ? (
                  <div className="text-xs text-destructive">{briefError}</div>
                ) : (
                  <pre className="text-xs text-white whitespace-pre-wrap font-sans leading-relaxed">{brief}</pre>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={onSaveTarget}
                className={`as-btn as-btn-ghost text-xs py-1.5 px-3 ${
                  saved.data ? "text-primary border-primary/30 bg-primary/10" : ""
                }`}
              >
                <Target className="w-3.5 h-3.5" />
                {saved.data ? "Saved" : "Save Target"}
              </button>
              <Link
                to={`/companies/${c.slug}`}
                className="as-btn as-btn-ghost text-xs py-1.5 px-3"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View Full Profile
              </Link>
              <RemindButton companySlug={c.slug} companyName={c.name} source="account_intel" />

              <button
                type="button"
                disabled
                className="as-btn as-btn-ghost text-xs py-1.5 px-3 opacity-40 cursor-not-allowed"
              >
                Draft Outreach
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono ${accent || "text-white"}`}>{value}</div>
    </div>
  );
}

function CompanyLinks({ c }: { c: CompanyRow }) {
  const links: Array<{ href: string; label: string; node: React.ReactNode }> = [];
  if (c.url) links.push({ href: c.url, label: c.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), node: <Globe className="w-3.5 h-3.5" /> });
  if (c.twitter) {
    const tw = c.twitter.startsWith("http") ? c.twitter : `https://x.com/${c.twitter.replace(/^@/, "")}`;
    links.push({ href: tw, label: "X", node: <span className="text-[11px] font-semibold leading-none">𝕏</span> });
  }
  if (c.linkedin) links.push({ href: c.linkedin, label: "LinkedIn", node: <Linkedin className="w-3.5 h-3.5" /> });
  if (c.telegram) links.push({ href: c.telegram, label: "Telegram", node: <TelegramIcon className="w-3.5 h-3.5" /> });
  if (c.discord) links.push({ href: c.discord, label: "Discord", node: <MessageSquare className="w-3.5 h-3.5" /> });
  (c.github || []).slice(0, 1).forEach((g) => links.push({ href: g, label: "GitHub", node: <Github className="w-3.5 h-3.5" /> }));

  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {links.map((l, i) => (
        <a
          key={i}
          href={l.href}
          target="_blank"
          rel="noreferrer"
          title={l.label}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-white/10 bg-white/[0.03] text-muted-foreground hover:text-primary hover:border-white/20 transition-colors"
        >
          {l.node}
          {l.label.length < 40 && l.label !== "X" && l.label !== "LinkedIn" && l.label !== "Telegram" && l.label !== "Discord" && l.label !== "GitHub" ? (
            <span className="truncate max-w-[140px]">{l.label}</span>
          ) : null}
        </a>
      ))}
    </div>
  );
}

function FundingHistory({ rounds, loading }: { rounds: FundingRow[]; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (loading) return <div className="h-10 bg-white/[0.03] rounded animate-pulse" />;
  if (rounds.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        <span className="uppercase tracking-wider text-[10px]">Funding:</span> no recorded rounds
      </div>
    );
  }
  const visible = expanded ? rounds : rounds.slice(0, 3);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Funding history · {rounds.length} round{rounds.length === 1 ? "" : "s"}
        </span>
        {rounds.length > 3 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[10px] text-muted-foreground hover:text-primary"
          >
            {expanded ? "Show less" : `Show all ${rounds.length}`}
          </button>
        )}
      </div>
      <ul className="space-y-1">
        {visible.map((r, i) => (
          <li key={i} className="flex items-center gap-2 text-xs bg-white/[0.02] border border-white/[0.04] rounded px-2.5 py-1.5">
            <span className="font-mono text-[10px] text-muted-foreground w-16 shrink-0">
              {r.date ? format(new Date(r.date), "MMM yyyy") : "—"}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-muted-foreground border border-white/10 shrink-0">
              {r.round_type || "—"}
            </span>
            <span className="font-mono text-sm font-semibold text-teal-400 whitespace-nowrap">
              {fmtBounty(r.amount_usd)}
            </span>
            {r.lead_investors && (
              <span className="text-[11px] text-muted-foreground truncate">
                · led by <span className="text-teal-400/80">{r.lead_investors}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PersonItem({
  p,
  companySlug,
  companyName,
}: {
  p: PersonRow;
  companySlug: string;
  companyName: string;
}) {
  const qc = useQueryClient();
  const [enriching, setEnriching] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function remove() {
    if (!confirm(`Remove ${p.name} from this account?`)) return;
    setRemoving(true);
    try {
      const { error } = await supabase.from("company_people").delete().eq("id", p.id);
      if (error) throw error;
      toast.success(`Removed ${p.name}`);
      qc.invalidateQueries({ queryKey: ["dashboard-intel-people", companySlug] });
    } catch (e) {
      const o = e as { message?: string; code?: string };
      const msg = e instanceof Error ? e.message : o?.message || JSON.stringify(e);
      toast.error(`Remove failed: ${msg}`);
    } finally {
      setRemoving(false);
    }
  }

  async function enrich() {
    setEnriching(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        toast.error("Sign in required");
        return;
      }
      const r = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL || "https://qktjbtmcjrwzmtqnszbq.supabase.co"}/functions/v1/enrich-person-grok`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            person_id: p.id,
            company_slug: companySlug,
            company_name: companyName,
            name: p.name,
            twitter: p.twitter,
            github: p.github,
            linkedin: p.linkedin,
            telegram: p.telegram,
          }),
        },
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = data?.error || `Enrich failed (${r.status})`;
        const detail = data?.details ? ` — ${String(data.details).slice(0, 160)}` : "";
        toast.error(`${msg}${detail}`);
        return;
      }
      const added: string[] = [];
      if (data.twitter && !p.twitter) added.push("X");
      if (data.telegram && !p.telegram) added.push("Telegram");
      if (data.linkedin && !p.linkedin) added.push("LinkedIn");
      if (data.email && !p.email) added.push("email");
      if (data.title && !p.title) added.push("title");
      if (added.length === 0) {
        toast.message("No new contacts found", {
          description: `Confidence: ${data.confidence ?? "n/a"}`,
        });
      } else {
        toast.success(`Enriched: added ${added.join(", ")}`, {
          description: `Confidence: ${data.confidence ?? "n/a"}`,
        });
      }
      qc.invalidateQueries({ queryKey: ["dashboard-intel-people", companySlug] });
    } catch (e) {
      console.error("[enrich grok]", e);
      toast.error(`Enrich failed: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setEnriching(false);
    }
  }

  const confidenceCls =
    p.enrichment_confidence === "high"
      ? "text-emerald-400"
      : p.enrichment_confidence === "medium"
        ? "text-amber-300"
        : p.enrichment_confidence === "low"
          ? "text-muted-foreground"
          : "";

  const sourceLabel = p.source === "tavily" ? "Web" : p.source === "github" ? "GH" : p.source === "imported" ? "DB" : p.source === "grok" ? "X" : null;
  const sourceClass =
    p.source === "tavily"
      ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
      : p.source === "github"
        ? "bg-white/[0.04] text-muted-foreground border-white/10"
        : p.source === "imported"
          ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
          : "bg-primary/10 text-primary border-primary/20";

  return (
    <li className="group flex items-start gap-2.5 bg-white/[0.03] border border-white/[0.05] rounded-md px-3 py-2.5 hover:border-white/15 transition-colors">
      <div className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">
        {(p.name?.trim()?.[0] || "?").toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          <span className="text-sm font-semibold text-white truncate">{p.name}</span>
          {p.is_decision_maker && <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />}
          {sourceLabel && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono ${sourceClass}`} title={`Source: ${p.source}`}>
              {sourceLabel}
            </span>
          )}
          {p.enriched_at && (
            <span className={`text-[9px] font-mono ${confidenceCls}`} title={`Enriched · ${p.enrichment_confidence || ""}`}>
              ✦
            </span>
          )}
        </div>
        <div className={`text-[11px] truncate ${p.title || p.role ? "text-muted-foreground" : "text-muted-foreground/60 italic"}`}>
          {p.title || p.role || "Unknown"}
        </div>
        <div className="flex items-center gap-2.5 mt-1.5">
          {p.linkedin ? (
            <a href={p.linkedin} target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300" aria-label="LinkedIn">
              <Linkedin className="w-3.5 h-3.5" />
            </a>
          ) : (
            <span className="text-muted-foreground/30" title="No LinkedIn"><Linkedin className="w-3.5 h-3.5" /></span>
          )}
          {p.email && (
            <a href={`mailto:${p.email}`} className="text-muted-foreground hover:text-primary" aria-label="Email">
              <Mail className="w-3.5 h-3.5" />
            </a>
          )}
          {p.telegram && (
            <a href={p.telegram} target="_blank" rel="noreferrer" className="text-cyan-300 hover:text-cyan-200" aria-label="Telegram">
              <TelegramIcon className="w-3.5 h-3.5" />
            </a>
          )}
          {p.twitter && (
            <a href={p.twitter} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary" aria-label="X">
              <span className="text-[11px] font-semibold leading-none">𝕏</span>
            </a>
          )}
          {p.github && (
            <a href={p.github} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary" aria-label="GitHub">
              <Github className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <button
          type="button"
          onClick={enrich}
          disabled={enriching || removing}
          title={p.enriched_at ? "Re-enrich (X + web)" : "Enrich with X + web"}
          className={`text-[10px] inline-flex items-center gap-1 px-1.5 py-1 rounded border transition-colors ${
            p.enriched_at
              ? "border-white/10 bg-white/[0.02] text-muted-foreground hover:text-primary"
              : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
          } disabled:opacity-50`}
        >
          {enriching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          {!p.enriched_at && <span>Enrich</span>}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={removing || enriching}
          aria-label="Remove person"
          title="Remove from this account"
          className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] p-1 rounded text-muted-foreground hover:text-destructive hover:bg-white/[0.04] disabled:opacity-30"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </li>
  );
}
