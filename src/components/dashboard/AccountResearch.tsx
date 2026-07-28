import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  AlertTriangle,
  Banknote,
  TrendingUp,
  Activity,
  Sparkles,
  Loader2,
  Target,
  Mail,
  Bell,
  Users,
  ExternalLink,
  Check,
  X,
  ClipboardCopy,
} from "lucide-react";
import { Link } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { CompanyLogo } from "@/components/CompanyLogo";
import { BrandLogo } from "@/components/BrandLogo";
import { fetchLlamaProtocol } from "@/lib/liveData";
import { formatTvl } from "@/lib/format";
import { callAnthropic } from "@/lib/anthropic";
import { generateCompanyDescription } from "@/lib/descriptions";
import { FindPeopleDialog } from "./FindPeopleDialog";
import { RemindButton } from "@/components/RemindButton";

type Props = { slug: string };

const RADAR_MESSAGES = [
  "Checking smart-contract footprint…",
  "Pulling audit history…",
  "Reading recent signals…",
  "Fetching funding & TVL…",
  "Mapping investor warm leads…",
  "Building qualification verdict…",
];

function RadarSpinner({ active }: { active: boolean }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % RADAR_MESSAGES.length), 700);
    return () => clearInterval(t);
  }, [active]);
  if (!active) return null;
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-black/30 border border-cyan-500/20 rounded-lg">
      <div className="relative w-8 h-8 shrink-0">
        <div className="absolute inset-0 rounded-full border border-cyan-400/40" />
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, rgba(34,211,238,0) 0deg, rgba(34,211,238,0) 270deg, rgba(34,211,238,0.6) 350deg, rgba(34,211,238,0) 360deg)",
            animation: "radar-spin 1.4s linear infinite",
          }}
        />
        <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)]" />
      </div>
      <div className="text-xs font-mono text-cyan-300">{RADAR_MESSAGES[idx]}</div>
      <style>{`@keyframes radar-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

type Verdict = {
  fit: "hot" | "warm" | "cool" | "skip";
  reasons: string[];
  attack_plan: string[];
  opening_line: string;
};

export function AccountResearch({ slug }: Props) {
  const { user } = useAuth();
  const [findOpen, setFindOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftText, setDraftText] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftCopied, setDraftCopied] = useState(false);

  // 1) Company core
  const companyQ = useQuery({
    queryKey: ["research-company", slug],
    queryFn: async () => {
      const { data } = await supabase
        .from("companies")
        .select("slug,name,logo,url,category,country,description,is_institution,twitter,linkedin,github,total_raised_usd")
        .eq("slug", slug)
        .maybeSingle();
      return data as {
        slug: string; name: string; logo: string | null; url: string | null; category: string | null;
        country: string | null; description: string | null; is_institution: boolean | null;
        twitter: string | null; linkedin: string | null; github: string[] | null; total_raised_usd: number | null;
      } | null;
    },
  });

  // 2) Child protocols (smart contracts)
  const protosQ = useQuery({
    queryKey: ["research-protos", slug],
    queryFn: async () => {
      const { data } = await supabase
        .from("protocols")
        .select("slug,name,chains,smart_contract_language,has_active_contracts,description,category")
        .eq("parent_slug", slug);
      return (data || []) as Array<{
        slug: string; name: string; chains: string[] | null;
        smart_contract_language: string | null; has_active_contracts: boolean | null;
        description: string | null; category: string | null;
      }>;
    },
  });

  // 3) Audit summary (from view)
  const auditSummaryQ = useQuery({
    queryKey: ["research-audit-summary", slug],
    queryFn: async () => {
      const { data } = await supabase
        .from("company_audit_summary")
        .select("*")
        .eq("company_slug", slug)
        .maybeSingle();
      return data as {
        company_slug: string; audit_count: number; firm_count: number;
        latest_audit_date: string | null; earliest_audit_date: string | null;
        latest_audit_firm: string | null; firms: string[];
      } | null;
    },
  });

  // 4) Full audit history (for top-firm breakdown + findings totals)
  const auditsQ = useQuery({
    queryKey: ["research-audits", slug, (protosQ.data || []).map((p) => p.slug).join(",")],
    enabled: !!slug,
    queryFn: async () => {
      const protoSlugs = (protosQ.data || []).map((p) => p.slug);
      const orFilters = [`company_slug.eq.${slug}`];
      if (protoSlugs.length > 0) orFilters.push(`protocol_slug.in.(${protoSlugs.join(",")})`);
      const { data } = await supabase
        .from("audit_history")
        .select("audit_firm,audit_date,audit_type,findings_critical,findings_high,findings_medium,findings_low,report_url,protocol_name,smart_contract_language")
        .or(orFilters.join(","))
        .order("audit_date", { ascending: false, nullsFirst: false });
      return (data || []) as Array<{
        audit_firm: string | null; audit_date: string | null; audit_type: string | null;
        findings_critical: number | null; findings_high: number | null;
        findings_medium: number | null; findings_low: number | null;
        report_url: string | null; protocol_name: string | null; smart_contract_language: string | null;
      }>;
    },
  });

  // 5) Funding
  const fundingQ = useQuery({
    queryKey: ["research-funding", slug],
    queryFn: async () => {
      const { data } = await supabase
        .from("funding_rounds")
        .select("amount_usd,round_type,date,lead_investors,other_investors")
        .eq("company_slug", slug)
        .order("date", { ascending: false, nullsFirst: false });
      return (data || []) as Array<{
        amount_usd: number | null; round_type: string | null; date: string | null;
        lead_investors: string | null; other_investors: string | null;
      }>;
    },
  });

  // 6) Live TVL (sum across child protocols)
  const protoSlugs = (protosQ.data || []).map((p) => p.slug);
  const tvlQ = useQuery({
    queryKey: ["research-tvl", protoSlugs.join(",")],
    enabled: protoSlugs.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const vals = await Promise.all(protoSlugs.map((s) => fetchLlamaProtocol(s)));
      const sums = vals.map((v) => v.tvl).filter((v): v is number => v != null);
      return sums.length > 0 ? sums.reduce((a, b) => a + b, 0) : null;
    },
  });

  // 7) Live signals (account_signals)
  const liveQ = useQuery({
    queryKey: ["research-live-signals", slug],
    queryFn: async () => {
      const since = new Date(); since.setDate(since.getDate() - 60);
      const { data } = await supabase
        .from("account_signals")
        .select("id,signal_type,signal_subtype,source,title,detail,evidence_url,fired_at")
        .eq("company_slug", slug)
        .gte("fired_at", since.toISOString())
        .order("fired_at", { ascending: false })
        .limit(20);
      return (data || []) as Array<{
        id: string; signal_type: string; signal_subtype: string | null; source: string;
        title: string; detail: string | null; evidence_url: string | null; fired_at: string;
      }>;
    },
  });

  // User profile (ICP + investors + existing clients) for the verdict
  const profileQ = useQuery({
    queryKey: ["research-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("company_name,firm_type,specialties,focus_categories,icp_summary,sells_what,value_prop,must_haves,disqualifiers,target_personas,investors,existing_client_slugs")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data as {
        company_name: string | null; firm_type: string | null;
        specialties: string[] | null; focus_categories: string[] | null;
        icp_summary: string | null;
        sells_what: string | null; value_prop: string | null;
        must_haves: string[] | null; disqualifiers: string[] | null; target_personas: string[] | null;
        investors: string[] | null; existing_client_slugs: string[] | null;
      } | null;
    },
  });

  const qc = useQueryClient();
  const company = companyQ.data;
  const protos = protosQ.data || [];

  // Fire-and-forget dynamic description generator. Skips if fresh; runs ~$0.0005 Haiku call otherwise.
  useEffect(() => {
    if (!company?.slug) return;
    let cancelled = false;
    generateCompanyDescription(company.slug).then((newDesc) => {
      if (cancelled) return;
      if (newDesc && newDesc !== company.description) {
        qc.invalidateQueries({ queryKey: ["research-company", company.slug] });
      }
    }).catch(() => { /* swallowed; logged inside helper */ });
    return () => { cancelled = true; };
  }, [company?.slug, company?.description, qc]);
  const auditSummary = auditSummaryQ.data;
  const audits = auditsQ.data || [];
  const fundings = fundingQ.data || [];
  const live = liveQ.data || [];

  const chains = useMemo(() => Array.from(new Set(protos.flatMap((p) => p.chains || []))).filter(Boolean), [protos]);
  const languages = useMemo(() => Array.from(new Set(protos.map((p) => p.smart_contract_language).filter(Boolean) as string[])), [protos]);
  // Smart-contract detection: don't rely on a single flag. Any one of these is sufficient evidence.
  const scSignals = {
    audit_count: auditSummary?.audit_count || 0,
    chains_count: chains.length,
    languages_count: languages.length,
    protocols_count: protos.length,
    tvl_usd: tvlQ.data ?? null, // null = unknown, NOT zero. Never lie to the AI prompt.
    active_flag: protos.some((p) => p.has_active_contracts === true),
  };
  const hasSmartContracts =
    scSignals.audit_count > 0 ||
    scSignals.chains_count > 0 ||
    scSignals.languages_count > 0 ||
    scSignals.protocols_count > 0 ||
    scSignals.tvl_usd > 0 ||
    scSignals.active_flag;
  // Confidence label for the section header
  const scConfidence: "confirmed" | "likely" | "unlikely" =
    (scSignals.audit_count > 0 && (scSignals.chains_count > 0 || scSignals.languages_count > 0)) || scSignals.tvl_usd > 0
      ? "confirmed"
      : hasSmartContracts
        ? "likely"
        : "unlikely";

  // Findings totals
  const findings = useMemo(() => {
    const t = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const a of audits) {
      t.critical += a.findings_critical || 0;
      t.high += a.findings_high || 0;
      t.medium += a.findings_medium || 0;
      t.low += a.findings_low || 0;
    }
    return t;
  }, [audits]);

  // Top firms (audit_history rows grouped + ranked)
  const topFirms = useMemo(() => {
    const m = new Map<string, { firm: string; count: number; latest: string | null }>();
    for (const a of audits) {
      const f = (a.audit_firm || "").trim();
      if (!f) continue;
      const e = m.get(f) || { firm: f, count: 0, latest: null };
      e.count += 1;
      if (a.audit_date && (!e.latest || a.audit_date > e.latest)) e.latest = a.audit_date;
      m.set(f, e);
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count).slice(0, 6);
  }, [audits]);

  const latestFunding = fundings[0] || null;
  const totalRaised = fundings.reduce((s, f) => s + (Number(f.amount_usd) || 0), 0);

  // All data loaded?
  const dataReady =
    !companyQ.isLoading &&
    !protosQ.isLoading &&
    !auditsQ.isLoading &&
    !fundingQ.isLoading &&
    !liveQ.isLoading &&
    !profileQ.isLoading &&
    !tvlQ.isLoading;  // Live DefiLlama TVL — without this the verdict races and sees tvl_usd=0

  // 8) Verdict — fires once data is ready
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [verdictError, setVerdictError] = useState<string | null>(null);
  const [verdictLoading, setVerdictLoading] = useState(false);

  useEffect(() => {
    if (!dataReady || !company) return;
    if (verdict || verdictLoading) return;
    setVerdictLoading(true);
    const monthsSinceAudit = auditSummary?.latest_audit_date
      ? Math.floor((Date.now() - new Date(auditSummary.latest_audit_date).getTime()) / (1000 * 60 * 60 * 24 * 30))
      : null;
    const isExisting = (profileQ.data?.existing_client_slugs || []).includes(slug);
    const profile = profileQ.data;
    const dossier = {
      name: company.name,
      slug: company.slug,
      category: company.category,
      country: company.country,
      description: company.description,
      is_institution: company.is_institution,
      smart_contract_evidence: {
        confidence: scConfidence,
        audit_count: scSignals.audit_count,
        chains_count: scSignals.chains_count,
        languages_count: scSignals.languages_count,
        protocols_count: scSignals.protocols_count,
        tvl_usd: scSignals.tvl_usd,
      },
      chains,
      languages,
      tvl_usd: tvlQ.data ?? null,
      audit_count: auditSummary?.audit_count || 0,
      firm_count: auditSummary?.firm_count || 0,
      months_since_last_audit: monthsSinceAudit,
      latest_audit_firm: auditSummary?.latest_audit_firm,
      latest_audit_date: auditSummary?.latest_audit_date,
      top_firms: topFirms.slice(0, 3),
      findings_totals: findings,
      total_raised_usd: totalRaised,
      latest_funding: latestFunding,
      live_signals: live.map((s) => ({ type: s.signal_type, title: s.title, fired_at: s.fired_at })),
      already_a_client: isExisting,
      user_firm: profile?.company_name,
      user_firm_type: profile?.firm_type,
      user_sells_what: profile?.sells_what,
      user_value_prop: profile?.value_prop,
      user_icp: profile?.icp_summary,
      user_must_haves: profile?.must_haves,
      user_disqualifiers: profile?.disqualifiers,
      user_focus: profile?.focus_categories,
      user_specialties: profile?.specialties,
    };

    const system = `You are a senior B2B sales-qualification analyst working with a top-tier sales rep. The user's firm could be ANY kind of B2B security / dev-tooling / infrastructure / AI-safety / compliance company — read their profile (user_sells_what, user_value_prop, user_icp, user_must_haves, user_disqualifiers) and tailor the verdict to THEIR business, not a generic audit-firm template. Output strict JSON. Be honest — if the data says skip, say skip.

CRITICAL DATA-INTERPRETATION RULES:
- If a numeric field is null, treat it as "unknown" — NEVER say "zero" or "no" for null values. Example: tvl_usd: null means "we don't have TVL data right now", not "the protocol has zero TVL".
- The dossier has both tvl_usd at the top level and inside smart_contract_evidence. They are the same value. When TVL is a real positive number, you MUST cite it accurately.
- Never invent missing data. If a field is null/missing, simply skip mentioning it.
- "Smart contracts" matters ONLY if the user's sells_what / icp / must_haves indicate they sell to web3 protocols. For an AI-safety vendor, on-chain monitoring tool, compliance vendor, or fintech-security firm, smart-contract presence is irrelevant or secondary.`;
    const userPrompt = `Dossier:\n${JSON.stringify(dossier, null, 2)}\n\nReturn JSON with this shape:\n{\n  "fit": "hot" | "warm" | "cool" | "skip",\n  "reasons": ["2-4 short bullet points; cite the specific data AND tie it to the user's value prop / ICP"],\n  "attack_plan": ["3-5 concrete steps the sales rep should take, in order"],\n  "opening_line": "ONE sentence the rep can DM or email cold, hyper-specific to the dossier — no greeting prefix",\n  "must_haves_met": ["which user.must_haves this prospect satisfies (cite the evidence)"],\n  "disqualifiers_tripped": ["which user.disqualifiers this prospect violates"]\n}\n\nFit rules — EVALUATE DYNAMICALLY against the user's profile:\n- "skip" = a hard disqualifier from user_disqualifiers is tripped, OR already_a_client is true, OR the prospect is fundamentally outside the user's ICP (e.g. user sells smart-contract audits and prospect is a non-web3 SaaS with no on-chain footprint).\n- "hot" = strong fit on multiple dimensions: meets MOST must_haves + recent urgency signal (recent raise, hiring security/eng roles, TVL momentum, stale audit if they sell audits, etc.) + worth calling THIS week.\n- "warm" = clear fit on the user's ICP but no urgency yet. Pipeline material.\n- "cool" = some positive signals but you wouldn't prioritize this week.\n\nIf user profile is sparse or missing, fall back to: assume web3 security audit firm selling to mainstream EVM protocols, but say so in reasons.\n\nOpening-line rules — read carefully. The rep is selling security to a founder/CTO/security lead. The wrong tone tanks the deal.\n- Be a peer, not a critic. Lead with curiosity or a genuine observation, not a roast.\n- NEVER point out weak metrics as the hook. Phrases like "zero TVL despite raising X", "haven't shipped yet", "only N audits" are off-limits — they read as mocking, even if factual.\n- Reference ONE specific positive or neutral data point that shows you actually researched them: a recent product launch, a specific protocol/product name, a chain they deployed on, an audit firm they used, a known investor, an upcoming integration. Pick the most flattering true thing.\n- Frame the security angle as forward-looking ("as you scale across X chains", "with Y launching", "ahead of mainnet for Z") not backward-looking ("you haven't been audited recently").\n- Sound like a human sales rep, not a database query. Avoid stilted phrasings like "I noticed X has Y" or "your protocol shows Z". A natural opener feels like the kind of message a friend in the industry would send.\n- ONE sentence, 20-35 words. No greeting prefix ("Hey {name}"). No questions that imply they're failing. End with either (a) a soft question that invites a reply, or (b) a clean offer to help.\n\nGood example: "Saw you just shipped the Solana ALM controller alongside the Ethereum vaults — happy to share how some of the larger ALM teams have handled the Solana audit surface if useful."\nBad example: "I noticed Mellow has deployed across 10 chains but shows zero TVL despite $2.75M from ParaFi — are you seeing adoption challenges?"`;

    callAnthropic({
      system,
      messages: [{ role: "user", content: userPrompt }],
      max_tokens: 800,
    })
      .then((text) => {
        const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
        const parsed = JSON.parse(cleaned);
        setVerdict({
          fit: parsed.fit || "cool",
          reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
          attack_plan: Array.isArray(parsed.attack_plan) ? parsed.attack_plan : [],
          opening_line: parsed.opening_line || "",
        });
      })
      .catch((e) => setVerdictError(e instanceof Error ? e.message : "Verdict failed"))
      .finally(() => setVerdictLoading(false));
  }, [dataReady, company, slug, profileQ.data, auditSummary, hasSmartContracts, JSON.stringify(chains), JSON.stringify(languages), tvlQ.data, totalRaised, JSON.stringify(topFirms), JSON.stringify(findings), JSON.stringify(latestFunding), JSON.stringify(live), verdict, verdictLoading]);

  if (companyQ.isLoading) {
    return (
      <div className="p-6">
        <RadarSpinner active />
      </div>
    );
  }
  if (!company) {
    return <div className="p-6 text-sm text-muted-foreground">Account not found.</div>;
  }

  const stillLoading = !dataReady || verdictLoading;

  function sendToClaude() {
    if (!company) return;
    const profile = profileQ.data;
    const firmName = profile?.company_name || "our security firm";
    const firmType = profile?.firm_type || "audit firm";
    const specialties = profile?.specialties || [];
    const focus = profile?.focus_categories || [];
    const icp = profile?.icp_summary || "";
    const totalRaisedUsd = fundings.reduce((sum, f) => sum + (Number(f.amount_usd) || 0), 0);

    const auditLine = auditSummary && auditSummary.audit_count > 0
      ? `${auditSummary.audit_count} audits on file across ${auditSummary.firm_count || "—"} firm${(auditSummary.firm_count || 0) === 1 ? "" : "s"}${auditSummary.latest_audit_date ? `; last audit ${auditSummary.latest_audit_date} by ${auditSummary.latest_audit_firm || "—"}` : ""}`
      : "No audits on file in our DB (coverage gap is possible).";

    const fundingLine = latestFunding
      ? `Most recent round: ${latestFunding.round_type || "round"} on ${latestFunding.date || "?"} for ${latestFunding.amount_usd ? `$${(Number(latestFunding.amount_usd)/1e6).toFixed(1)}M` : "undisclosed"}${(latestFunding.lead_investors as string[] | string | null) ? ` led by ${Array.isArray(latestFunding.lead_investors) ? latestFunding.lead_investors.join(", ") : latestFunding.lead_investors}` : ""}. Total raised (known): ${totalRaisedUsd > 0 ? `$${(totalRaisedUsd/1e6).toFixed(1)}M` : "undisclosed"}.`
      : "No funding rounds on record.";

    const signalsBlock = live.length === 0
      ? "(no live signals captured yet — Refresh signals on the My Accounts table to scan)"
      : live.slice(0, 5).map((s) => `- ${s.signal_type}${s.signal_subtype ? `/${s.signal_subtype}` : ""}: ${s.title}${s.evidence_url ? ` — ${s.evidence_url}` : ""}`).join("\n");

    const verdictBlock = verdict
      ? `Fit: ${verdict.fit.toUpperCase()}\n\nReasons:\n${verdict.reasons.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n\nSuggested attack plan:\n${verdict.attack_plan.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\nSuggested opener: "${verdict.opening_line}"`
      : "(no AI verdict generated yet)";

    const prompt = `I'm a sales rep at ${firmName}${firmType !== "other" ? ` (${firmType.replace(/_/g, " ")})` : ""}. We specialize in ${specialties.length ? specialties.join(", ") : "smart-contract audits"}${focus.length ? `, focused on ${focus.join(", ")}` : ""}.${icp ? ` Our ICP: ${icp}` : ""}

I want to outbound to **${company.name}**${company.url ? ` (${company.url})` : ""}. Here's everything I know — please draft me:
1. A 3-message LinkedIn outreach sequence (Day 1 cold intro, Day 4 value-add follow-up, Day 8 break-up)
2. Each message ≤80 words, peer-to-peer tone, references something specific from the dossier
3. A short attack plan for getting from cold message → discovery call
4. Who I should target (which role/title)

## Target dossier — ${company.name}

**About:** ${company.description || "(no description on file)"}
**Category:** ${company.category || "—"}${company.is_institution ? " · Institution" : ""}
**Chains:** ${chains.length ? chains.join(", ") : "—"}
**Languages:** ${languages.length ? languages.join(", ") : "—"}

**Audit history:** ${auditLine}
${topFirms.length ? `**Top auditing firms:** ${topFirms.slice(0, 3).map((f: { firm: string; count: number }) => `${f.firm} (${f.count})`).join(", ")}` : ""}

**Funding:** ${fundingLine}

**Recent live signals:**
${signalsBlock}

**Our internal AI verdict:**
${verdictBlock}

Now write the sequence + attack plan. Be specific to ${company.name}, no marketing fluff, no "I noticed" preambles, no leading with weak metrics — frame everything forward-looking.`;

    navigator.clipboard.writeText(prompt).then(() => {
      toast.success(`Dossier copied — paste into Claude in the new tab`);
      window.open("https://claude.ai/new", "_blank", "noopener,noreferrer");
    }, () => {
      toast.error("Couldn't copy to clipboard — your browser may have blocked it");
    });
  }

  async function draftOutreach() {
    if (!verdict) return;
    setDraftLoading(true);
    setDraftText(null);
    try {
      const system =
        "You write cold-outreach DMs for a web3 security sales rep. Tight, specific, no fluff, no greeting prefix. Lead with the verdict's opening line. 80-110 words. End with a single-line CTA.";
      const userMsg = `Write a cold DM to ${company!.name}.\n\nLead with this opening line (must include it): "${verdict.opening_line}"\n\nReasons it's a fit: ${verdict.reasons.join(" | ")}\n\nWrite the DM in plain text. The reader is the security/eng leader at ${company!.name}.`;
      const t = await callAnthropic({
        system,
        messages: [{ role: "user", content: userMsg }],
        max_tokens: 400,
      });
      setDraftText(t.trim());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Draft failed");
    } finally {
      setDraftLoading(false);
    }
  }

  function copyDraft() {
    if (!draftText) return;
    navigator.clipboard.writeText(draftText).then(() => {
      setDraftCopied(true);
      setTimeout(() => setDraftCopied(false), 1500);
    });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <CompanyLogo logo={company.logo} url={company.url} name={company.name} className="w-12 h-12 rounded-lg shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-white truncate">{company.name}</h2>
            <div className="text-xs text-muted-foreground mt-0.5 truncate">
              {[company.category, company.country, company.is_institution ? "Institution" : null].filter(Boolean).join(" · ")}
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {company.url && <a href={company.url} target="_blank" rel="noreferrer" className="text-[11px] text-muted-foreground hover:text-primary inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" />website</a>}
              {company.twitter && <a href={company.twitter} target="_blank" rel="noreferrer" className="text-[11px] text-muted-foreground hover:text-primary">X</a>}
              {company.linkedin && <a href={company.linkedin} target="_blank" rel="noreferrer" className="text-[11px] text-muted-foreground hover:text-primary">LinkedIn</a>}
              {company.github?.[0] && <a href={company.github[0]} target="_blank" rel="noreferrer" className="text-[11px] text-muted-foreground hover:text-primary">GitHub</a>}
            </div>
          </div>
        </div>

        {/* Radar — visible while anything is loading */}
        <RadarSpinner active={stillLoading} />

        {/* Section 1: Smart contracts */}
        <Section icon={<ShieldCheck className="w-4 h-4" />} title="Smart contracts" loading={protosQ.isLoading || auditSummaryQ.isLoading || tvlQ.isLoading}>
          {scConfidence === "unlikely" ? (
            <div className="text-amber-300/90 text-sm">
              No on-chain footprint in our DB (no protocols, audits, TVL, or contract languages).
              {company.is_institution
                ? " This is a traditional financial institution — relevant if you sell to CeFi / custody / compliance."
                : " Could be a coverage gap. If your ICP is web3 protocols, verify before passing; if you sell to AI/infra/fintech, this may just mean we don't track that side."}
            </div>
          ) : (
            <div className="space-y-1">
              <Row
                label="Status"
                value={
                  scConfidence === "confirmed"
                    ? <span className="text-emerald-400 font-medium">✓ Confirmed on-chain</span>
                    : <span className="text-amber-300 font-medium">Likely on-chain</span>
                }
              />
              {protos.length > 0 && (
                <Row label="Protocols" value={`${protos.length} (${protos.slice(0, 3).map((p) => p.name).join(", ")}${protos.length > 3 ? "…" : ""})`} />
              )}
              {languages.length > 0 && <Row label="Languages" value={languages.join(", ")} />}
              {chains.length > 0 && <Row label="Chains" value={`${chains.slice(0, 6).join(", ")}${chains.length > 6 ? ` +${chains.length - 6}` : ""}`} />}
              {tvlQ.data != null && <Row label="Live TVL" value={<span className="font-mono text-cyan-400">{formatTvl(tvlQ.data)}</span>} />}
              {scSignals.audit_count > 0 && protos.length === 0 && (
                <Row label="Evidence" value={`${scSignals.audit_count} audit${scSignals.audit_count === 1 ? "" : "s"} on file (no protocol row tracked)`} />
              )}
            </div>
          )}
        </Section>

        {/* Section 2: Audit history */}
        <Section icon={<ShieldCheck className="w-4 h-4" />} title="Audit history" loading={auditSummaryQ.isLoading || auditsQ.isLoading}>
          {auditSummary && auditSummary.audit_count > 0 ? (
            <div className="space-y-2">
              <Row label="Total audits" value={`${auditSummary.audit_count} across ${auditSummary.firm_count} firm${auditSummary.firm_count === 1 ? "" : "s"}`} />
              <Row label="Latest" value={`${auditSummary.latest_audit_firm} · ${auditSummary.latest_audit_date ? format(new Date(auditSummary.latest_audit_date), "MMM d, yyyy") : "—"}`} />
              {topFirms.length > 0 && (
                <div className="pt-1">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Top firms used</div>
                  <ul className="space-y-1.5">
                    {topFirms.map((t) => (
                      <li key={t.firm} className="flex items-center gap-2 text-xs">
                        <BrandLogo name={t.firm} className="w-5 h-5 rounded" />
                        <span className="text-white flex-1 truncate">{t.firm}</span>
                        <span className="font-mono text-muted-foreground shrink-0">
                          {t.count} · last {t.latest ? format(new Date(t.latest), "MMM yyyy") : "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="text-red-300 text-sm">No audits captured. Either truly unaudited (rare for a real protocol) or coverage gap in our data.</div>
          )}
        </Section>

        {/* Section 3: Major findings — only rendered when we actually have parsed counts.
            Audit PDFs rarely expose findings in machine-readable form, so an empty section
            was misleading every time. Cut it entirely when there's nothing to show. */}
        {(findings.critical + findings.high + findings.medium + findings.low > 0) && (
          <Section icon={<AlertTriangle className="w-4 h-4" />} title="Major findings" loading={auditsQ.isLoading}>
            <div className="grid grid-cols-4 gap-2 text-center">
              <FindingChip label="Critical" count={findings.critical} accent="bg-red-500/15 text-red-300 border-red-500/30" />
              <FindingChip label="High" count={findings.high} accent="bg-amber-500/15 text-amber-300 border-amber-500/30" />
              <FindingChip label="Medium" count={findings.medium} accent="bg-yellow-500/10 text-yellow-300 border-yellow-500/30" />
              <FindingChip label="Low" count={findings.low} accent="bg-white/[0.04] text-muted-foreground border-white/10" />
            </div>
          </Section>
        )}

        {/* Section 4: Live signals (instead of expensive news lookup for v1) */}
        <Section icon={<Activity className="w-4 h-4" />} title="Recent signals" loading={liveQ.isLoading}>
          {live.length === 0 ? (
            <div className="text-muted-foreground text-sm">
              No live signals yet. Hit <span className="text-primary">Refresh signals</span> on the table to scan hiring + GitHub.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {live.slice(0, 6).map((s) => (
                <li key={s.id} className="flex items-start gap-2 text-xs">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${
                    s.signal_type === "hiring" ? "bg-amber-400"
                    : s.signal_type === "github" ? "bg-violet-400"
                    : "bg-cyan-400"
                  }`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-white truncate">{s.title}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">
                      {s.source} · {formatDistanceToNow(new Date(s.fired_at), { addSuffix: true })}
                    </div>
                  </div>
                  {s.evidence_url && (
                    <a href={s.evidence_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Section 5: Funding */}
        <Section icon={<Banknote className="w-4 h-4" />} title="Funding" loading={fundingQ.isLoading}>
          {fundings.length === 0 ? (
            <div className="text-muted-foreground text-sm">No funding rounds recorded.</div>
          ) : (
            <div className="space-y-2">
              <Row label="Total raised" value={<span className="font-mono text-teal-400">{formatUsd(totalRaised)}</span>} />
              <Row label="Rounds" value={`${fundings.length}`} />
              {latestFunding && (
                <Row
                  label="Most recent"
                  value={`${latestFunding.round_type || "Round"} · ${formatUsd(latestFunding.amount_usd)} · ${latestFunding.date || "—"}`}
                />
              )}
              {latestFunding?.lead_investors && (
                <Row label="Led by" value={<span className="text-teal-400/90">{latestFunding.lead_investors}</span>} />
              )}
            </div>
          )}
        </Section>

        {/* Section 6: AI verdict + attack plan */}
        <div className="rounded-xl border border-primary/30 bg-primary/[0.04] p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-primary font-mono">
            <Sparkles className="w-3.5 h-3.5" /> Verdict & attack plan
          </div>

          {verdictError && <div className="text-xs text-destructive">{verdictError}</div>}

          {!verdict && !verdictError && (
            <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" /> Synthesizing…
            </div>
          )}

          {verdict && (
            <>
              <div className="flex items-center gap-2">
                <FitBadge fit={verdict.fit} />
                <span className="text-xs text-muted-foreground">based on the dossier above</span>
              </div>

              {verdict.reasons.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Why</div>
                  <ul className="space-y-1">
                    {verdict.reasons.map((r, i) => (
                      <li key={i} className="text-xs text-white leading-snug flex items-start gap-2">
                        <span className="text-primary mt-0.5">›</span> {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {verdict.attack_plan.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Attack plan</div>
                  <ol className="space-y-1">
                    {verdict.attack_plan.map((p, i) => (
                      <li key={i} className="text-xs text-white leading-snug flex items-start gap-2">
                        <span className="font-mono text-primary mt-0.5">{i + 1}.</span> {p}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {verdict.opening_line && (
                <div className="bg-black/30 border border-primary/30 rounded-md p-3 text-xs text-white leading-relaxed">
                  <div className="text-[10px] uppercase tracking-wider text-primary mb-1 font-mono">Opening line</div>
                  {verdict.opening_line}
                </div>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => setFindOpen(true)}
            className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/10 bg-white/[0.03] text-muted-foreground hover:text-primary hover:border-white/20"
          >
            <Users className="w-3.5 h-3.5" /> Find people
          </button>
          <button
            type="button"
            onClick={() => { setDraftOpen(true); draftOutreach(); }}
            disabled={!verdict || draftLoading}
            className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
          >
            {draftLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
            Draft outreach
          </button>
          <button
            type="button"
            onClick={sendToClaude}
            disabled={!company}
            title="Copy this dossier + outreach prompt to clipboard and open claude.ai for a personalized sequence"
            className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-amber-500/30 bg-amber-500/[0.08] text-amber-300 hover:bg-amber-500/15 disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" /> Send to Claude
          </button>
          <RemindButton companySlug={slug} companyName={company.name} source="research" />
          <Link
            to={`/companies/${slug}`}
            className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/10 bg-white/[0.03] text-muted-foreground hover:text-primary"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Full profile
          </Link>
        </div>

        {draftOpen && (draftText || draftLoading) && (
          <div className="rounded-md bg-black/30 border border-primary/30 p-3 space-y-2">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-primary font-mono">
              <span className="inline-flex items-center gap-1"><Sparkles className="w-3 h-3" /> Draft DM</span>
              <div className="flex items-center gap-2">
                {draftText && (
                  <button type="button" onClick={copyDraft} className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary normal-case tracking-normal">
                    {draftCopied ? <Check className="w-3 h-3" /> : <ClipboardCopy className="w-3 h-3" />}
                    {draftCopied ? "Copied" : "Copy"}
                  </button>
                )}
                <button type="button" onClick={() => setDraftOpen(false)} className="text-muted-foreground hover:text-white normal-case tracking-normal">
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
            {draftLoading ? (
              <div className="text-xs text-muted-foreground inline-flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Drafting…</div>
            ) : (
              <pre className="text-xs text-white whitespace-pre-wrap font-sans leading-relaxed">{draftText}</pre>
            )}
          </div>
        )}
      </div>

      {findOpen && (
        <FindPeopleDialog
          open={findOpen}
          onClose={() => setFindOpen(false)}
          companySlug={slug}
          companyName={company.name}
          companyUrl={company.url}
          companyCategory={company.category}
          isInstitution={company.is_institution}
          githubUrls={company.github || []}
        />
      )}
    </div>
  );
}

function Section({
  icon, title, loading, children,
}: { icon: React.ReactNode; title: string; loading: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{title}</span>
        {loading && <Loader2 className="w-3 h-3 animate-spin opacity-50" />}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-white text-right min-w-0 truncate">{value}</span>
    </div>
  );
}

function FindingChip({ label, count, accent }: { label: string; count: number; accent: string }) {
  return (
    <div className={`rounded-md border px-2 py-2 ${accent}`}>
      <div className="text-[9px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="font-mono text-base font-semibold mt-0.5">{count}</div>
    </div>
  );
}

function FitBadge({ fit }: { fit: Verdict["fit"] }) {
  const map: Record<Verdict["fit"], { label: string; cls: string }> = {
    hot: { label: "🔥 Hot target", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
    warm: { label: "Warm", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
    cool: { label: "Cool", cls: "bg-white/[0.04] text-muted-foreground border-white/10" },
    skip: { label: "Skip", cls: "bg-muted/10 text-muted-foreground border-white/10 line-through" },
  };
  const s = map[fit];
  return <span className={`text-xs px-2 py-0.5 rounded-md border font-semibold ${s.cls}`}>{s.label}</span>;
}

function formatUsd(n: number | null | undefined): string {
  if (!n) return "—";
  const v = Number(n);
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}
