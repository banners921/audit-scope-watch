import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Plus,
  ChevronDown,
  ShieldCheck,
  Banknote,
  Clock,
  Flame,
  Sparkles,
  X as XIcon,
  Loader2,
  RefreshCw,
  Briefcase,
  Github,
  Mail,
  Trash2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
// formatDistanceToNow used in toolbar; toast for action feedback
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { CompanyLogo } from "@/components/CompanyLogo";
import { SignalSparkline } from "./SignalSparkline";
import { AddAccountModal } from "./AddAccountModal";
import { DailyBriefPreview } from "./DailyBriefPreview";
import { fetchLlamaTvlHistory } from "@/lib/liveData";

type Props = {
  onSelectAccount: (slug: string) => void;
};

type CompanyRow = {
  slug: string;
  name: string;
  logo: string | null;
  category: string | null;
  country: string | null;
  is_institution: boolean | null;
  audit_count: number | null;
  unique_auditor_count: number | null;
  has_bug_bounty: boolean | null;
};

type LiveSignal = {
  id: string;
  company_slug: string;
  signal_type: string;
  signal_subtype: string | null;
  source: string;
  title: string;
  detail: string | null;
  evidence_url: string | null;
  score_boost: number | null;
  fired_at: string;
  expires_at: string | null;
};

type AuditSummary = {
  company_slug: string;
  audit_count: number;
  firm_count: number;
  latest_audit_date: string | null;
  earliest_audit_date: string | null;
  latest_audit_firm: string | null;
};
type AuditEvt = { company_slug: string | null; audit_firm: string | null; audit_date: string | null; protocol_slug: string | null };
type FundEvt = { company_slug: string; amount_usd: number | null; date: string | null; round_type: string | null };

type SignalType = "recent_audit" | "active_program" | "slowing" | "dormant" | "no_audits" | "stale_audit" | "never_audited" | "recent_funding" | "warm_lead" | "new_bounty" | "none";

type Account = {
  slug: string;
  name: string;
  logo: string | null;
  category: string | null;
  country: string | null;
  is_institution: boolean | null;
  score: number;
  last_signal: {
    type: SignalType | "hiring" | "github";
    label: string;
    subtitle: string;
    age_days: number | null;
    accent: string;
  };
  live_signals: LiveSignal[];
  last_touch_days: number | null;
  label_tag: string | null;
  trend: number[];
  tvl_max: number;            // peak TVL across the 12mo window (for tooltip)
  has_smart_contracts: boolean | null;  // null=unknown, true=confirmed, false=likely not
  sc_evidence: string[];      // which signals say "yes SC"
  source: "saved" | "ideal";
  audit_count: number;
};

type TabKey = "all" | "saved" | "ideal";

const LABEL_STYLES: Record<string, string> = {
  "Crypto Native": "bg-violet-500/10 text-violet-300 border-violet-500/30",
  "DeFi": "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  "L1/L2": "bg-sky-500/10 text-sky-300 border-sky-500/30",
  "Tokenization/Stablecoin": "bg-amber-500/10 text-amber-300 border-amber-500/30",
  "Traditional Finance": "bg-red-500/10 text-red-300 border-red-500/30",
  "Fintech": "bg-blue-500/10 text-blue-300 border-blue-500/30",
  "Infrastructure": "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  "Gaming": "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30",
  "CeFi": "bg-pink-500/10 text-pink-300 border-pink-500/30",
};

function inferLabel(c: CompanyRow): string {
  if (c.is_institution) {
    const cat = (c.category || "").toLowerCase();
    if (/blockchain|crypto|defi|tokeniz/.test(cat)) return "Tokenization/Stablecoin";
    return "Traditional Finance";
  }
  const cat = c.category || "";
  if (/stablecoin|tokeniz/i.test(cat)) return "Tokenization/Stablecoin";
  if (/^DeFi$|dex|cdp|lending/i.test(cat)) return "DeFi";
  if (/L1|L2|chain|rollup/i.test(cat)) return "L1/L2";
  if (/infra|oracle|bridge|rpc/i.test(cat)) return "Infrastructure";
  if (/game|gaming|metaverse|nft/i.test(cat)) return "Gaming";
  if (/cefi|exchange|custody/i.test(cat)) return "CeFi";
  if (/fintech|payment|bank|broker/i.test(cat)) return "Fintech";
  return cat || "Crypto Native";
}

function monthsAgo(d: string | null): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24 * 30));
}

function daysSince(d: string | null): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
}

function monthBucket(d: string): number {
  // months back from now: 0 = current month, 11 = 11 months ago
  const ev = new Date(d);
  const now = new Date();
  return (now.getFullYear() - ev.getFullYear()) * 12 + (now.getMonth() - ev.getMonth());
}

function computeAccount(args: {
  company: CompanyRow;
  summary: AuditSummary | null;
  audits: AuditEvt[];
  fundings: FundEvt[];
  liveSignals: LiveSignal[];
  tvlHistory: number[] | null;            // 12-month TVL, oldest→newest, or null if unavailable
  protocolCount: number;                  // count of rows in protocols table for this company
  source: "saved" | "ideal";
  warm: boolean;
}): Account {
  const { company: c, summary, audits, fundings, liveSignals, tvlHistory, protocolCount, source, warm } = args;
  // Latest audit — prefer the summary view (it joins via protocol_slug too)
  const latestAudit = summary && summary.audit_count > 0
    ? { audit_firm: summary.latest_audit_firm, audit_date: summary.latest_audit_date, company_slug: c.slug, protocol_slug: null }
    : null;
  const totalAuditCount = summary?.audit_count ?? audits.length;
  const firmCount = summary?.firm_count ?? 0;
  const sortedFundings = [...fundings].sort((a, b) =>
    (b.date || "").localeCompare(a.date || ""),
  );
  const latestFunding = sortedFundings[0] || null;

  // Smart-contract evidence: multi-signal. NEVER claim "no SC" unless we're really sure.
  const SC_CATEGORIES = new Set(["DEX","DeFi","Lending","Bridge","CDP","Derivatives","Liquid Staking","Yield","NFT","L1","L2","Stablecoin","Real World Assets","Prediction Market","Insurance","Privacy","Gaming"]);
  const sc_evidence: string[] = [];
  if (totalAuditCount > 0) sc_evidence.push(`${totalAuditCount} audits on file`);
  if (protocolCount > 0) sc_evidence.push(`tracked as ${protocolCount} protocol${protocolCount === 1 ? "" : "s"}`);
  if ((tvlHistory || []).some((v) => v > 0)) sc_evidence.push("has on-chain TVL");
  if (c.category && SC_CATEGORIES.has(c.category)) sc_evidence.push(`category: ${c.category}`);
  const has_smart_contracts = sc_evidence.length > 0 ? true : (c.is_institution === true ? false : null);

  // 12mo TVL trend (replaces the old audits+fundings combined sparkline).
  // If we have TVL history use it. Otherwise fall back to combined-events so we never show a flat empty line.
  let trend: number[];
  let tvl_max = 0;
  if (tvlHistory && tvlHistory.some((v) => v > 0)) {
    trend = tvlHistory;
    tvl_max = Math.max(...tvlHistory);
  } else {
    trend = new Array(12).fill(0);
    for (const a of audits) {
      if (!a.audit_date) continue;
      const m = monthBucket(a.audit_date);
      if (m >= 0 && m < 12) trend[11 - m] += 1;
    }
    for (const f of fundings) {
      if (!f.date) continue;
      const m = monthBucket(f.date);
      if (m >= 0 && m < 12) trend[11 - m] += 1;
    }
  }

  // Score: composite — flipped per UX feedback.
  // Recent + high-volume audits = green flag (active, well-funded, real customer).
  // Old or no audits = neutral-to-negative (could be a dead project or our coverage gap).
  let score = 30;
  if (c.is_institution) score += 5;
  const last = latestAudit?.audit_date;
  const lastMonths = monthsAgo(last) ?? 9999;
  // Count audits in the last 24 months for "active program" detection
  const audits24mo = audits.filter((a) => {
    const m = monthsAgo(a.audit_date || null);
    return m !== null && m <= 24;
  }).length;

  if (totalAuditCount === 0) {
    score += 0; // unknown — could be coverage gap or genuinely no SC. Neutral.
  } else if (lastMonths > 24) {
    score += totalAuditCount >= 3 ? 3 : -5; // long gap; if they had history they may rehire, if not likely dormant
  } else if (lastMonths >= 12) {
    score += 6; // 1-2yr gap = slowing, possible re-audit window
  } else if (lastMonths >= 6 && audits24mo >= 3) {
    score += 18; // recent + active program = strong prospect (re-audit cadence)
  } else if (lastMonths >= 6) {
    score += 12; // recent but light cadence
  } else if (audits24mo >= 3) {
    score += 22; // very recent + high volume = active heavyweight
  } else {
    score += 10; // very recent but only one or two
  }

  if (latestFunding && (latestFunding.amount_usd ?? 0) >= 1_000_000) score += 15;
  if (c.has_bug_bounty === false) score += 5;
  if (totalAuditCount > 0 && firmCount >= 3) score += 8;
  if (warm) score += 10;
  // Live signal boosts (capped to prevent runaway)
  const liveScoreBoost = Math.min(35, liveSignals.reduce((s, sig) => s + Math.max(0, sig.score_boost || 0), 0));
  score += liveScoreBoost;
  score = Math.min(100, score);

  // Last signal (pick the most informative recent thing)
  let last_signal: Account["last_signal"];
  const recentAuditDays = daysSince(last);
  const recentFundingDays = daysSince(latestFunding?.date ?? null);
  // Prefer the freshest live signal if it's <= 30 days old (hiring + github events)
  const freshLive = liveSignals.length > 0 ? liveSignals[0] : null;
  const freshLiveDays = freshLive ? daysSince(freshLive.fired_at) : null;
  if (freshLive && freshLiveDays != null && freshLiveDays <= 30) {
    last_signal = {
      type: freshLive.signal_type === "hiring" ? "hiring" : freshLive.signal_type === "github" ? "github" : "recent_audit",
      label: freshLive.signal_type === "hiring" ? "Hiring signal"
           : freshLive.signal_type === "github" ? "GitHub signal"
           : freshLive.title,
      subtitle: freshLive.title + (liveSignals.length > 1 ? ` · +${liveSignals.length - 1} more` : ""),
      age_days: freshLiveDays,
      accent: freshLive.signal_type === "hiring" ? "bg-amber-400" : freshLive.signal_type === "github" ? "bg-violet-400" : "bg-cyan-400",
    };
  } else if (recentFundingDays != null && recentFundingDays <= 60) {
    const amt = latestFunding!.amount_usd ?? 0;
    last_signal = {
      type: "recent_funding",
      label: "Recent funding",
      subtitle: `${latestFunding!.round_type || "round"} • $${(amt / 1e6).toFixed(amt >= 1e6 ? 1 : 0)}M`,
      age_days: recentFundingDays,
      accent: "bg-emerald-400",
    };
  } else if (recentAuditDays != null && recentAuditDays <= 30 && audits24mo >= 3) {
    // Recent + high cadence = green flag, active program
    last_signal = {
      type: "active_program",
      label: "Active program",
      subtitle: `${audits24mo} audits in last 24mo · last: ${latestAudit!.audit_firm || "Auditor"} (${recentAuditDays}d ago)`,
      age_days: recentAuditDays,
      accent: "bg-emerald-400",
    };
  } else if (recentAuditDays != null && recentAuditDays <= 90) {
    last_signal = {
      type: "recent_audit",
      label: "Recent audit",
      subtitle: `${latestAudit!.audit_firm || "Auditor"} · ${totalAuditCount} audit${totalAuditCount === 1 ? "" : "s"} on file (${firmCount} firms)`,
      age_days: recentAuditDays,
      accent: "bg-cyan-400",
    };
  } else if (lastMonths > 24 && totalAuditCount > 0) {
    // 2+ years since last audit — could be dead project or just no need. NOT "overdue".
    last_signal = {
      type: "dormant",
      label: totalAuditCount >= 3 ? "Quiet (was active)" : "Quiet",
      subtitle: `${totalAuditCount} audit${totalAuditCount === 1 ? "" : "s"} on file · last ${Math.floor(lastMonths/12)}y ago. May be dormant or no longer auditing.`,
      age_days: recentAuditDays,
      accent: "bg-white/30",
    };
  } else if (lastMonths >= 12 && totalAuditCount > 0) {
    // 1-2 years — possible re-audit window, not yet stale
    last_signal = {
      type: "slowing",
      label: "Slowing cadence",
      subtitle: `${totalAuditCount} audit${totalAuditCount === 1 ? "" : "s"} · last: ${latestAudit!.audit_firm || "Auditor"} ${lastMonths}mo ago`,
      age_days: recentAuditDays,
      accent: "bg-amber-400",
    };
  } else if (totalAuditCount === 0) {
    // No audits on file — neutral, not red flag. Could be coverage gap or no SC.
    last_signal = {
      type: "no_audits",
      label: "No audits on file",
      subtitle: c.is_institution ? "Institutional product — verify with their security team" : "Coverage gap or unaudited — needs research",
      age_days: null,
      accent: "bg-white/30",
    };
  } else if (warm) {
    last_signal = {
      type: "warm_lead",
      label: "Warm lead",
      subtitle: "Shares investor with your firm",
      age_days: null,
      accent: "bg-violet-400",
    };
  } else if (latestAudit) {
    last_signal = {
      type: "recent_audit",
      label: "Audit history",
      subtitle: `${totalAuditCount} audit${totalAuditCount === 1 ? "" : "s"} · ${firmCount} firm${firmCount === 1 ? "" : "s"} · last: ${latestAudit.audit_firm || "Auditor"}${latestAudit.audit_date ? ` ${latestAudit.audit_date}` : ""}`,
      age_days: recentAuditDays,
      accent: "bg-white/40",
    };
  } else {
    last_signal = { type: "none", label: "—", subtitle: "No recent signal", age_days: null, accent: "bg-white/40" };
  }

  const label_tag = inferLabel(c);

  return {
    slug: c.slug,
    name: c.name,
    logo: c.logo,
    category: c.category,
    country: c.country,
    is_institution: c.is_institution,
    score: Math.round(score),
    last_signal,
    live_signals: liveSignals,
    last_touch_days: null,
    label_tag,
    trend,
    tvl_max,
    has_smart_contracts,
    sc_evidence,
    source,
    audit_count: totalAuditCount,
  };
}

export function AccountsTable({ onSelectAccount }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addDefaultTab, setAddDefaultTab] = useState<"search" | "filter" | "suggest">("search");
  const [briefOpen, setBriefOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch user profile for ideal targets + investors
  const profile = useQuery({
    queryKey: ["accounts-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("ideal_target_slugs,investors")
        .eq("user_id", user!.id)
        .maybeSingle();
      return (data as { ideal_target_slugs: string[] | null; investors: string[] | null } | null) || null;
    },
  });

  // Fetch saved_targets
  const saved = useQuery({
    queryKey: ["accounts-saved", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("saved_targets")
        .select("company_slug")
        .eq("user_id", user!.id);
      return (data || []).map((r: { company_slug: string }) => r.company_slug);
    },
  });

  const savedSlugs = saved.data || [];
  const idealSlugs = profile.data?.ideal_target_slugs || [];
  const allSlugs = useMemo(() => Array.from(new Set([...savedSlugs, ...idealSlugs])), [savedSlugs.join(","), idealSlugs.join(",")]);

  // #116 Auto-open Add Accounts on Suggest tab if user has no saved targets yet (once per session).
  useEffect(() => {
    if (saved.isLoading || !user) return;
    if (savedSlugs.length > 0) return;
    const key = `auditscope.firstSuggestOpened.${user.id}`;
    if (typeof window !== "undefined" && window.sessionStorage.getItem(key)) return;
    setAddDefaultTab("suggest");
    setAddOpen(true);
    if (typeof window !== "undefined") window.sessionStorage.setItem(key, "1");
  }, [saved.isLoading, savedSlugs.length, user]);

  // Bulk fetch companies + audit_summary + audits-for-trend + fundings for these slugs
  const dataQ = useQuery({
    queryKey: ["accounts-data", allSlugs.join(",")],
    enabled: allSlugs.length > 0,
    queryFn: async () => {
      // Need child protocol slugs so we can also pull audits attached via protocol_slug.
      // We also pull tvl_usd so we can pick the highest-TVL protocol per parent for the TVL chart.
      const { data: protos } = await supabase
        .from("protocols")
        .select("slug,parent_slug,tvl_usd,has_active_contracts,smart_contract_language")
        .in("parent_slug", allSlugs);
      type ProtoRow = { slug: string; parent_slug: string; tvl_usd: number | null; has_active_contracts: boolean | null; smart_contract_language: string | null };
      const allProtos = (protos || []) as ProtoRow[];
      const childSlugs = allProtos.map((p) => p.slug);
      const childToParent: Record<string, string> = {};
      const protosByParent: Record<string, ProtoRow[]> = {};
      allProtos.forEach((p) => {
        childToParent[p.slug] = p.parent_slug;
        (protosByParent[p.parent_slug] = protosByParent[p.parent_slug] || []).push(p);
      });

      // Live signals from account_signals (non-expired, last 60d)
      const sinceLive = new Date(); sinceLive.setDate(sinceLive.getDate() - 60);
      const [companiesRes, summaryRes, auditsRes, fundingsRes, liveRes] = await Promise.all([
        supabase
          .from("companies")
          .select("slug,name,logo,category,country,is_institution,audit_count,unique_auditor_count,has_bug_bounty")
          .in("slug", allSlugs),
        supabase
          .from("company_audit_summary")
          .select("*")
          .in("company_slug", allSlugs),
        supabase
          .from("audit_history")
          .select("company_slug,protocol_slug,audit_firm,audit_date")
          .or(`company_slug.in.(${allSlugs.join(",")})${childSlugs.length > 0 ? `,protocol_slug.in.(${childSlugs.join(",")})` : ""}`)
          .order("audit_date", { ascending: false })
          .limit(3000),
        supabase
          .from("funding_rounds")
          .select("company_slug,amount_usd,date,round_type")
          .in("company_slug", allSlugs)
          .order("date", { ascending: false, nullsFirst: false })
          .limit(1000),
        supabase
          .from("account_signals")
          .select("id,company_slug,signal_type,signal_subtype,source,title,detail,evidence_url,score_boost,fired_at,expires_at")
          .in("company_slug", allSlugs)
          .gte("fired_at", sinceLive.toISOString())
          .order("fired_at", { ascending: false })
          .limit(2000),
      ]);
      const companies: Record<string, CompanyRow> = {};
      ((companiesRes.data || []) as CompanyRow[]).forEach((c) => { companies[c.slug] = c; });
      const summaryBySlug: Record<string, AuditSummary> = {};
      ((summaryRes.data || []) as AuditSummary[]).forEach((s) => { summaryBySlug[s.company_slug] = s; });
      const auditsBySlug: Record<string, AuditEvt[]> = {};
      ((auditsRes.data || []) as AuditEvt[]).forEach((a) => {
        const cs = a.company_slug || (a.protocol_slug ? childToParent[a.protocol_slug] : null);
        if (!cs) return;
        (auditsBySlug[cs] = auditsBySlug[cs] || []).push(a);
      });
      const fundsBySlug: Record<string, FundEvt[]> = {};
      ((fundingsRes.data || []) as FundEvt[]).forEach((f) => {
        if (!f.company_slug) return;
        (fundsBySlug[f.company_slug] = fundsBySlug[f.company_slug] || []).push(f);
      });
      const liveBySlug: Record<string, LiveSignal[]> = {};
      ((liveRes.data || []) as LiveSignal[]).forEach((s) => {
        (liveBySlug[s.company_slug] = liveBySlug[s.company_slug] || []).push(s);
      });
      return { companies, summaryBySlug, auditsBySlug, fundsBySlug, liveBySlug, protosByParent };
    },
  });

  // TVL history per parent slug. Picks the highest-TVL protocol per company (or first if no tvl_usd)
  // and fetches its 12-month DefiLlama TVL history. All companies fired in parallel.
  const tvlHistoryQ = useQuery({
    queryKey: ["accounts-tvl-history", allSlugs.join(",")],
    enabled: allSlugs.length > 0 && !!dataQ.data,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const protosByParent = dataQ.data?.protosByParent || {};
      const slugToProto = new Map<string, string>();
      for (const parent of allSlugs) {
        const list = protosByParent[parent] || [];
        if (list.length === 0) continue;
        const sorted = list.slice().sort((a, b) => (b.tvl_usd ?? 0) - (a.tvl_usd ?? 0));
        slugToProto.set(parent, sorted[0].slug);
      }
      const entries = await Promise.all(
        Array.from(slugToProto.entries()).map(async ([parent, protoSlug]) => {
          const history = await fetchLlamaTvlHistory(protoSlug, 12);
          return [parent, history] as const;
        })
      );
      const map: Record<string, number[]> = {};
      entries.forEach(([parent, history]) => { map[parent] = history; });
      return map;
    },
  });

  // Warm-lead slugs from investor overlap
  const warmQ = useQuery({
    queryKey: ["accounts-warm-slugs", (profile.data?.investors || []).join("|")],
    enabled: !!profile.data && (profile.data.investors || []).length > 0,
    queryFn: async () => {
      const investors = (profile.data?.investors || []).filter(Boolean);
      const orParts = investors.flatMap((inv) => {
        const safe = inv.replace(/[%,()]/g, " ").trim();
        if (!safe) return [];
        return [
          `lead_investors.ilike.%${safe}%`,
          `other_investors.ilike.%${safe}%`,
          `all_investors.ilike.%${safe}%`,
        ];
      }).join(",");
      if (!orParts) return new Set<string>();
      const { data } = await supabase
        .from("funding_rounds")
        .select("company_slug")
        .or(orParts)
        .not("company_slug", "is", null)
        .limit(3000);
      return new Set((data || []).map((r: { company_slug: string }) => r.company_slug));
    },
  });

  const accounts: Account[] = useMemo(() => {
    if (!dataQ.data) return [];
    const out: Account[] = [];
    const warmSet = warmQ.data || new Set<string>();
    const savedSet = new Set(savedSlugs);
    const idealSet = new Set(idealSlugs);
    const tvlMap = tvlHistoryQ.data || {};
    const protosByParent = dataQ.data.protosByParent || {};
    for (const slug of allSlugs) {
      const c = dataQ.data.companies[slug];
      if (!c) continue;
      const audits = dataQ.data.auditsBySlug[slug] || [];
      const fundings = dataQ.data.fundsBySlug[slug] || [];
      out.push(computeAccount({
        company: c,
        summary: dataQ.data.summaryBySlug[slug] || null,
        audits,
        fundings,
        liveSignals: dataQ.data.liveBySlug[slug] || [],
        tvlHistory: tvlMap[slug] || null,
        protocolCount: (protosByParent[slug] || []).length,
        source: savedSet.has(slug) ? "saved" : "ideal",
        warm: warmSet.has(slug),
      }));
    }
    return out.sort((a, b) => b.score - a.score);
  }, [dataQ.data, allSlugs.join(","), warmQ.data, savedSlugs.join(","), idealSlugs.join(","), tvlHistoryQ.data]);

  const visible = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    return accounts.filter((a) => {
      if (tab === "saved" && a.source !== "saved") return false;
      if (tab === "ideal" && a.source !== "ideal") return false;
      if (q) {
        const blob = `${a.name} ${a.category || ""} ${a.country || ""} ${a.last_signal.label} ${a.last_signal.subtitle}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [accounts, tab, debounced]);

  // Counts per tab
  const counts = useMemo(() => ({
    all: accounts.length,
    saved: accounts.filter((a) => a.source === "saved").length,
    ideal: accounts.filter((a) => a.source === "ideal").length,
  }), [accounts]);

  const isLoading = (dataQ.isLoading || profile.isLoading || saved.isLoading) && allSlugs.length > 0;

  // Last-refreshed indicator
  const refreshLog = useQuery({
    queryKey: ["accounts-refresh-log", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("signal_refresh_log")
        .select("source,completed_at,signals_added")
        .eq("user_id", user!.id)
        .order("completed_at", { ascending: false })
        .limit(5);
      return (data || []) as Array<{ source: string; completed_at: string | null; signals_added: number | null }>;
    },
  });
  const lastRefresh = refreshLog.data?.[0]?.completed_at || null;

  async function runRefresh() {
    if (!user) { toast.error("Sign in required"); return; }
    if (allSlugs.length === 0) { toast.message("Add accounts first."); return; }
    setRefreshing(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not signed in");
      const base = import.meta.env.VITE_SUPABASE_URL || "https://qktjbtmcjrwzmtqnszbq.supabase.co";
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

      const t0 = Date.now();
      toast.message("Refreshing signals…", { description: "Raises + jobs + GitHub + TVL + audits" });

      const payload = JSON.stringify({ only_tracked: true, user_id: user.id });
      const atsPayload = JSON.stringify({ company_slugs: allSlugs });
      const w3lPayload = JSON.stringify({ days: 90, max_pages: 5 });
      const [hiringRes, hiringAtsRes, githubRes, llamaRes, l2beatRes, w3lRes, derivedRes] = await Promise.all([
        fetch(`${base}/functions/v1/collect-hiring`, { method: "POST", headers, body: payload })
          .then((r) => r.json()).catch((e) => ({ error: String(e) })),
        fetch(`${base}/functions/v1/collect-hiring-ats`, { method: "POST", headers, body: atsPayload })
          .then((r) => r.json()).catch((e) => ({ error: String(e) })),
        fetch(`${base}/functions/v1/collect-github`, { method: "POST", headers, body: payload })
          .then((r) => r.json()).catch((e) => ({ error: String(e) })),
        fetch(`${base}/functions/v1/collect-defillama`, { method: "POST", headers, body: payload })
          .then((r) => r.json()).catch((e) => ({ error: String(e) })),
        fetch(`${base}/functions/v1/collect-l2beat`, { method: "POST", headers, body: payload })
          .then((r) => r.json()).catch((e) => ({ error: String(e) })),
        fetch(`${base}/functions/v1/collect-web3leads-raises`, { method: "POST", headers, body: w3lPayload })
          .then((r) => r.json()).catch((e) => ({ error: String(e) })),
        (async () => {
          try {
            const res = await supabase.rpc("compute_audit_derived_signals", { p_company_slugs: allSlugs });
            return { rotation: res.data?.[0]?.rotation_added ?? 0, overdue: res.data?.[0]?.overdue_added ?? 0 };
          } catch (e) {
            return { error: String(e) };
          }
        })(),
      ]);

      const hiringAdded = hiringRes?.signals_added ?? 0;
      const atsAdded = (hiringAtsRes as { summary?: { inserted?: number } })?.summary?.inserted ?? 0;
      const githubAdded = githubRes?.signals_added ?? 0;
      const llamaAdded = llamaRes?.signals_added ?? 0;
      const l2beatAdded = l2beatRes?.signals_added ?? 0;
      const w3lInserted = (w3lRes as { summary?: { inserted?: number } })?.summary?.inserted ?? 0;
      const w3lLogos = (w3lRes as { summary?: { logos_updated?: number } })?.summary?.logos_updated ?? 0;
      const derivedAdded = ((derivedRes as { rotation?: number; overdue?: number })?.rotation ?? 0)
                         + ((derivedRes as { rotation?: number; overdue?: number })?.overdue ?? 0);
      const totalAdded = hiringAdded + atsAdded + githubAdded + llamaAdded + l2beatAdded + w3lInserted + derivedAdded;
      const took = Math.round((Date.now() - t0) / 1000);
      if (totalAdded > 0 || w3lLogos > 0) {
        toast.success(
          `+${totalAdded} signals in ${took}s${w3lLogos > 0 ? ` · ${w3lLogos} logos` : ""}`,
          { description: `${hiringAdded + atsAdded} hiring · ${githubAdded} GitHub · ${llamaAdded} TVL · ${l2beatAdded} L2Beat · ${w3lInserted} raises · ${derivedAdded} audit-derived` }
        );
      } else {
        toast.message("Refresh complete", { description: `No new signals across ${allSlugs.length} accounts (${took}s)` });
      }
      qc.invalidateQueries({ queryKey: ["accounts-data"] });
      qc.invalidateQueries({ queryKey: ["accounts-refresh-log"] });
    } catch (e) {
      console.error("[refresh signals]", e);
      toast.error(`Refresh failed: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white">My Accounts</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {counts.all > 0
              ? `${counts.all} account${counts.all === 1 ? "" : "s"} tracked · scored on stale audits, fresh funding, investor overlap`
              : "Add accounts you want monitored — we'll score them on audit gaps, funding, and warm-lead signals."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setBriefOpen(true)}
            title="Preview the daily brief — what tomorrow morning's email will look like"
            className="text-xs inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-primary/30 bg-primary/[0.08] text-primary hover:bg-primary/15 hover:border-primary/50"
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Daily Brief</span>
          </button>
          <button
            type="button"
            onClick={runRefresh}
            disabled={refreshing || allSlugs.length === 0}
            title={lastRefresh ? `Last refresh ${formatDistanceToNow(new Date(lastRefresh), { addSuffix: true })}` : "Run signal collectors manually"}
            className="text-xs inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-white/10 bg-white/[0.03] text-muted-foreground hover:text-primary hover:border-white/20 disabled:opacity-40"
          >
            {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span>Refresh signals</span>
            {lastRefresh && (
              <span className="text-[10px] font-mono text-muted-foreground/60 ml-1">
                {formatDistanceToNow(new Date(lastRefresh), { addSuffix: false })} ago
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="as-btn as-btn-primary text-xs py-2 px-3"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Accounts
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search accounts…"
            className="as-input pl-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-1 bg-white/[0.04] rounded-md p-0.5">
          <TabPill active={tab === "all"} onClick={() => setTab("all")} label="All Accounts" count={counts.all} />
          <TabPill active={tab === "saved"} onClick={() => setTab("saved")} label="Saved" count={counts.saved} />
          <TabPill active={tab === "ideal"} onClick={() => setTab("ideal")} label="ICP" count={counts.ideal} />
        </div>
      </div>

      {/* Add modal */}
      {addOpen && <AddAccountModal defaultTab={addDefaultTab} onClose={() => { setAddOpen(false); setAddDefaultTab("search"); }} onAdded={() => {
        qc.invalidateQueries({ queryKey: ["accounts-saved"] });
        qc.invalidateQueries({ queryKey: ["saved-target-slugs"] });
        qc.invalidateQueries({ queryKey: ["add-account-saved"] });
        qc.invalidateQueries({ queryKey: ["suggest-targets-ai"] });
      }} />}
      {briefOpen && <DailyBriefPreview onClose={() => setBriefOpen(false)} />}

      {/* Bulk action bar — sticky at top of table when any rows selected */}
      {selectedSlugs.size > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-md border border-primary/40 bg-primary/10">
          <div className="text-xs text-primary font-medium">
            {selectedSlugs.size} selected
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedSlugs(new Set())}
              className="text-[11px] text-muted-foreground hover:text-white"
            >
              Clear
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={async () => {
                if (!user) return;
                const slugs = Array.from(selectedSlugs);
                const ok = window.confirm(`Remove ${slugs.length} account${slugs.length === 1 ? "" : "s"} from My Accounts?`);
                if (!ok) return;
                setBulkBusy(true);
                try {
                  const { error } = await supabase
                    .from("saved_targets")
                    .delete()
                    .eq("user_id", user.id)
                    .in("company_slug", slugs);
                  if (error) { toast.error(`Bulk remove failed: ${error.message}`); return; }
                  toast.success(`Removed ${slugs.length} account${slugs.length === 1 ? "" : "s"}`);
                  setSelectedSlugs(new Set());
                  qc.invalidateQueries({ queryKey: ["accounts-saved"] });
                  qc.invalidateQueries({ queryKey: ["saved-target-slugs"] });
                  qc.invalidateQueries({ queryKey: ["add-account-saved"] });
                  qc.invalidateQueries({ queryKey: ["suggest-targets-ai"] });
                } finally { setBulkBusy(false); }
              }}
              className="text-[11px] inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-50"
            >
              {bulkBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              Remove {selectedSlugs.size}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="as-card overflow-hidden" style={{ background: "#0F1420", borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground bg-white/[0.02]">
              <tr>
                <th className="text-left px-4 py-3 w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={visible.length > 0 && visible.every((a) => selectedSlugs.has(a.slug))}
                    ref={(el) => {
                      if (el) {
                        const someSelected = visible.some((a) => selectedSlugs.has(a.slug));
                        const allSelected = visible.length > 0 && visible.every((a) => selectedSlugs.has(a.slug));
                        el.indeterminate = someSelected && !allSelected;
                      }
                    }}
                    onChange={(e) => {
                      const next = new Set(selectedSlugs);
                      if (e.target.checked) visible.forEach((a) => next.add(a.slug));
                      else visible.forEach((a) => next.delete(a.slug));
                      setSelectedSlugs(next);
                    }}
                    className="w-3.5 h-3.5 rounded bg-white/5 border-white/15 text-primary focus:ring-primary"
                  />
                </th>
                <th className="text-left px-4 py-3">Account</th>
                <th className="text-right px-4 py-3 w-16">Score</th>
                <th className="text-left px-4 py-3">Last Signal</th>
                <th className="text-left px-4 py-3 w-44">Labels</th>
                <th className="text-left px-4 py-3 w-32">Last Touch</th>
                <th className="text-left px-4 py-3 w-32" title="12-month DefiLlama TVL history (monthly snapshots). Tall = high TVL, growing right = TVL rising.">TVL (12mo)</th>
                <th className="px-4 py-3 w-12" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-white/[0.04]">
                    <td colSpan={8} className="px-4 py-4">
                      <div className="h-10 bg-white/[0.03] rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : visible.length === 0 ? (
                <tr><td colSpan={8} className="text-center text-muted-foreground py-16">
                  {accounts.length === 0 ? (
                    <div className="space-y-2">
                      <Sparkles className="w-6 h-6 mx-auto text-muted-foreground/40" />
                      <div>You're not tracking any accounts yet.</div>
                      <button type="button" onClick={() => setAddOpen(true)} className="text-primary hover:underline text-sm">
                        Add your first account →
                      </button>
                    </div>
                  ) : (
                    "No accounts match this filter."
                  )}
                </td></tr>
              ) : (
                visible.map((a) => (
                  <AccountRow
                    key={a.slug}
                    a={a}
                    selected={selectedSlugs.has(a.slug)}
                    onToggleSelect={(checked) => {
                      const next = new Set(selectedSlugs);
                      if (checked) next.add(a.slug);
                      else next.delete(a.slug);
                      setSelectedSlugs(next);
                    }}
                    onClick={() => onSelectAccount(a.slug)}
                    onRemove={async (e) => {
                      e.stopPropagation();
                      if (!user) return;
                      const ok = window.confirm(`Remove ${a.name} from your accounts?`);
                      if (!ok) return;
                      const { error } = await supabase
                        .from("saved_targets")
                        .delete()
                        .eq("user_id", user.id)
                        .eq("company_slug", a.slug);
                      if (error) {
                        toast.error(`Couldn't remove: ${error.message}`);
                      } else {
                        toast.success(`Removed ${a.name}`);
                        qc.invalidateQueries({ queryKey: ["accounts-saved"] });
                        qc.invalidateQueries({ queryKey: ["saved-target-slugs"] });
                        qc.invalidateQueries({ queryKey: ["add-account-saved"] });
                        qc.invalidateQueries({ queryKey: ["suggest-targets-ai"] });
                      }
                    }}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TabPill({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] px-2.5 py-1 rounded ${
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-white"
      }`}
    >
      {label} <span className="opacity-50">{count}</span>
    </button>
  );
}

function AccountRow({
  a,
  selected,
  onToggleSelect,
  onClick,
  onRemove,
}: {
  a: Account;
  selected: boolean;
  onToggleSelect: (checked: boolean) => void;
  onClick: () => void;
  onRemove: (e: React.MouseEvent) => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={`border-t border-white/[0.04] hover:bg-white/[0.02] cursor-pointer transition-colors group ${
        selected ? "bg-primary/[0.05]" : ""
      }`}
    >
      <td className="px-4 py-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggleSelect(e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          className="w-3.5 h-3.5 rounded bg-white/5 border-white/15 text-primary focus:ring-primary"
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <CompanyLogo logo={a.logo} url={null} name={a.name} className="w-8 h-8 rounded-md shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate">{a.name}</div>
            {(a.category || a.country) && (
              <div className="text-[11px] text-muted-foreground truncate">
                {[a.category, a.country].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-right font-mono font-semibold text-white">{a.score}</td>
      <td className="px-4 py-3">
        <div className="flex items-start gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${a.last_signal.accent}`} />
          <div className="min-w-0">
            <div className="text-xs font-medium text-white">
              {a.last_signal.label}
              {a.last_signal.age_days != null && (
                <span className="ml-2 text-muted-foreground font-mono text-[10px]">
                  {a.last_signal.age_days}d ago
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground truncate max-w-md">{a.last_signal.subtitle}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1">
          {a.label_tag && (
            <span className={`text-[10px] px-2 py-0.5 rounded-md border ${LABEL_STYLES[a.label_tag] || "bg-white/[0.04] text-muted-foreground border-white/10"}`}>
              {a.label_tag}
            </span>
          )}
          {a.has_smart_contracts === true && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-md border bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
              title={`Smart contracts confirmed via: ${a.sc_evidence.join("; ")}`}
            >
              ✓ SC
            </span>
          )}
          {a.has_smart_contracts === false && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-md border bg-white/[0.04] text-muted-foreground border-white/10"
              title="Marked institutional with no SC evidence on file. May not be a fit for an audit pitch."
            >
              No SC
            </span>
          )}
          {a.has_smart_contracts === null && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-md border bg-amber-500/[0.08] text-amber-300/70 border-amber-500/20"
              title="No SC evidence found yet — coverage gap. Worth a quick check."
            >
              SC?
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="text-[11px] text-muted-foreground">
          {a.last_touch_days == null ? (
            <>
              <div className="text-amber-400/80">Never contacted</div>
              <div className="text-[10px] text-muted-foreground/70">Follow up</div>
            </>
          ) : (
            <div>{a.last_touch_days}d ago</div>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        {a.tvl_max > 0 ? (
          <div className="space-y-0.5">
            <div className="text-[10px] font-mono text-muted-foreground/70">
              {a.tvl_max >= 1e9 ? `$${(a.tvl_max / 1e9).toFixed(1)}B`
                : a.tvl_max >= 1e6 ? `$${(a.tvl_max / 1e6).toFixed(1)}M`
                : a.tvl_max >= 1e3 ? `$${(a.tvl_max / 1e3).toFixed(0)}K`
                : `$${a.tvl_max.toFixed(0)}`} peak
            </div>
            <SignalSparkline values={a.trend} />
          </div>
        ) : (
          <SignalSparkline values={a.trend} />
        )}
      </td>
      <td className="px-2 py-3 text-right">
        <button
          type="button"
          onClick={onRemove}
          title="Remove from My Accounts"
          className="p-1.5 rounded-md text-muted-foreground/30 group-hover:text-muted-foreground hover:!text-destructive hover:bg-destructive/10 transition-all"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </td>
    </tr>
  );
}


export { ChevronDown, ShieldCheck, Banknote, Clock, Flame };
