// Today-feed signal sources for the sales hub dashboard.
// Each source fetches independently; merge + score in the component.
import { supabase } from "./supabase";

export type SignalType =
  | "reminder_due"
  | "recent_audit"
  | "stale_audit"
  | "never_audited"
  | "recent_funding"
  | "warm_lead";

export type Signal = {
  id: string; // stable within session for snooze/dismiss tracking
  type: SignalType;
  company_slug: string;
  company_name: string;
  company_logo: string | null;
  score: number;
  reason: string;
  detail: string | null;
  date: string | null;
  badges: string[];
  // Optional links for the "Draft outreach" / "Open report" actions
  report_url?: string | null;
  audit_firm?: string | null;
  amount_usd?: number | null;
};

type UserProfile = {
  investors: string[] | null;
  ideal_target_slugs: string[] | null;
  existing_client_slugs: string[] | null;
  focus_categories: string[] | null;
  specialties: string[] | null;
};

export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("investors,ideal_target_slugs,existing_client_slugs,focus_categories,specialties")
    .eq("user_id", userId)
    .maybeSingle();
  if (error && error.code !== "PGRST116") return null;
  return (data as UserProfile) || null;
}

export async function fetchSavedSlugs(userId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("saved_targets")
    .select("company_slug")
    .eq("user_id", userId);
  return new Set((data || []).map((r: { company_slug: string }) => r.company_slug));
}

type CompanyLite = { slug: string; name: string; logo: string | null };

async function fetchCompaniesLite(slugs: string[]): Promise<Map<string, CompanyLite>> {
  if (slugs.length === 0) return new Map();
  const { data } = await supabase
    .from("companies")
    .select("slug,name,logo")
    .in("slug", Array.from(new Set(slugs)));
  const m = new Map<string, CompanyLite>();
  (data || []).forEach((c: CompanyLite) => m.set(c.slug, c));
  return m;
}

function daysBetween(a: string | Date, b: string | Date): number {
  const da = typeof a === "string" ? new Date(a) : a;
  const db = typeof b === "string" ? new Date(b) : b;
  return Math.round((da.getTime() - db.getTime()) / (1000 * 60 * 60 * 24));
}

function monthsAgoFromDate(d: string | null): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24 * 30));
}

// 1) Due reminders
export async function fetchReminderSignals(userId: string): Promise<Signal[]> {
  const { data } = await supabase
    .from("reminders")
    .select("id,company_slug,company_name,remind_at,note,source")
    .eq("user_id", userId)
    .eq("status", "pending")
    .lte("remind_at", new Date().toISOString())
    .order("remind_at", { ascending: true });
  const rows = (data || []) as Array<{
    id: string; company_slug: string; company_name: string | null;
    remind_at: string; note: string | null; source: string | null;
  }>;
  const slugs = rows.map((r) => r.company_slug);
  const cmap = await fetchCompaniesLite(slugs);
  return rows.map((r) => {
    const overdue = Math.max(0, daysBetween(new Date(), r.remind_at));
    const c = cmap.get(r.company_slug);
    return {
      id: `reminder:${r.id}`,
      type: "reminder_due",
      company_slug: r.company_slug,
      company_name: c?.name || r.company_name || r.company_slug,
      company_logo: c?.logo || null,
      score: 100 + Math.min(50, overdue * 3),
      reason: overdue > 0
        ? `Reminder overdue ${overdue}d — follow up now`
        : `Reminder due today — follow up`,
      detail: r.note,
      date: r.remind_at,
      badges: ["Reminder"],
    };
  });
}

// 2) Recent audits — competitive intel. Only show audits on companies the user cares about
// (saved targets, ideal targets) so the feed isn't noise. 30-day window.
export async function fetchRecentAuditSignals(args: {
  savedSlugs: Set<string>;
  trackedSlugs: Set<string>;
}): Promise<Signal[]> {
  const watch = new Set([...args.savedSlugs, ...args.trackedSlugs]);
  if (watch.size === 0) return [];
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const { data } = await supabase
    .from("audit_history")
    .select("id,audit_firm,audit_date,company_slug,protocol_name,smart_contract_language,report_url")
    .gte("audit_date", since.toISOString().slice(0, 10))
    .in("company_slug", Array.from(watch))
    .order("audit_date", { ascending: false })
    .limit(60);
  const rows = (data || []) as Array<{
    id: string; audit_firm: string | null; audit_date: string | null;
    company_slug: string | null; protocol_name: string | null;
    smart_contract_language: string | null; report_url: string | null;
  }>;
  const slugs = rows.map((r) => r.company_slug).filter(Boolean) as string[];
  const cmap = await fetchCompaniesLite(slugs);
  return rows
    .filter((r) => r.company_slug)
    .map((r) => {
      const c = cmap.get(r.company_slug!);
      const isSaved = args.savedSlugs.has(r.company_slug!);
      return {
        id: `audit:${r.id}`,
        type: "recent_audit",
        company_slug: r.company_slug!,
        company_name: c?.name || r.protocol_name || r.company_slug!,
        company_logo: c?.logo || null,
        score: 90 + (isSaved ? 10 : 0),
        reason: `${r.audit_firm || "An auditor"} just audited them on ${r.audit_date} — re-audit window opens in 6mo`,
        detail: null,
        date: r.audit_date,
        badges: ["Just audited", r.smart_contract_language ?? "", isSaved ? "Saved" : ""].filter(Boolean),
        report_url: r.report_url,
        audit_firm: r.audit_firm,
      };
    });
}

// 3) Stale audits — companies with at least one audit but last audit > 12 months
// Prioritized by saved status, then by how many firms they've used (signals security maturity)
export async function fetchStaleAuditSignals(args: {
  savedSlugs: Set<string>;
  trackedSlugs: Set<string>;
  existingClients: Set<string>;
}): Promise<Signal[]> {
  // Find companies whose latest audit is > 12 months old
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 12);
  const { data } = await supabase
    .from("audit_history")
    .select("company_slug,audit_firm,audit_date,protocol_name")
    .not("company_slug", "is", null)
    .order("audit_date", { ascending: false })
    .limit(2000);
  const latestByCompany = new Map<string, { firm: string | null; date: string }>();
  const firmCount = new Map<string, Set<string>>();
  for (const r of (data || []) as Array<{ company_slug: string | null; audit_firm: string | null; audit_date: string | null; protocol_name: string | null }>) {
    if (!r.company_slug || !r.audit_date) continue;
    if (args.existingClients.has(r.company_slug)) continue;
    if (!latestByCompany.has(r.company_slug)) {
      latestByCompany.set(r.company_slug, { firm: r.audit_firm, date: r.audit_date });
    }
    if (r.audit_firm) {
      const s = firmCount.get(r.company_slug) || new Set();
      s.add(r.audit_firm.toLowerCase());
      firmCount.set(r.company_slug, s);
    }
  }
  const staleSlugs: string[] = [];
  for (const [slug, info] of latestByCompany) {
    if (new Date(info.date) < cutoff) staleSlugs.push(slug);
  }
  const watch = new Set([...args.savedSlugs, ...args.trackedSlugs]);
  // Bias toward watched companies; otherwise take top by firm count + recency
  const ranked = staleSlugs.sort((a, b) => {
    const aPri = watch.has(a) ? 1 : 0;
    const bPri = watch.has(b) ? 1 : 0;
    if (aPri !== bPri) return bPri - aPri;
    return (firmCount.get(b)?.size || 0) - (firmCount.get(a)?.size || 0);
  }).slice(0, 60);
  const cmap = await fetchCompaniesLite(ranked);
  return ranked.map((slug) => {
    const info = latestByCompany.get(slug)!;
    const months = monthsAgoFromDate(info.date) ?? 12;
    const firms = firmCount.get(slug)?.size || 0;
    const c = cmap.get(slug);
    const isSaved = args.savedSlugs.has(slug);
    return {
      id: `stale:${slug}`,
      type: "stale_audit",
      company_slug: slug,
      company_name: c?.name || slug,
      company_logo: c?.logo || null,
      score: 60 + (isSaved ? 20 : 0) + Math.min(10, firms * 2) + Math.min(10, months - 12),
      reason: `Last audit ${months}mo ago (${info.firm || "unknown firm"}) — overdue for re-audit`,
      detail: firms > 1 ? `Has used ${firms} different auditors historically — security-mature buyer` : null,
      date: info.date,
      badges: ["Stale audit", `${months}mo`, isSaved ? "Saved" : ""].filter(Boolean),
      audit_firm: info.firm,
    };
  });
}

// 4) Recent funding — companies that raised in last 60 days (security spend often follows)
export async function fetchFundingSignals(args: { existingClients: Set<string>; minAmount: number }): Promise<Signal[]> {
  const since = new Date();
  since.setDate(since.getDate() - 60);
  const { data } = await supabase
    .from("funding_rounds")
    .select("id,company_slug,company_name,amount_usd,round_type,date,lead_investors")
    .gte("date", since.toISOString().slice(0, 10))
    .not("company_slug", "is", null)
    .order("date", { ascending: false })
    .limit(120);
  const rows = (data || []) as Array<{
    id: string; company_slug: string | null; company_name: string | null;
    amount_usd: number | null; round_type: string | null; date: string | null; lead_investors: string | null;
  }>;
  const slugs = rows.map((r) => r.company_slug).filter(Boolean) as string[];
  const cmap = await fetchCompaniesLite(slugs);
  return rows
    .filter((r) => r.company_slug && !args.existingClients.has(r.company_slug))
    .filter((r) => (r.amount_usd || 0) >= args.minAmount)
    .map((r) => {
      const c = cmap.get(r.company_slug!);
      const amt = Number(r.amount_usd) || 0;
      const amtScore = Math.min(30, Math.log10(Math.max(amt, 1)) * 4);
      return {
        id: `funding:${r.id}`,
        type: "recent_funding",
        company_slug: r.company_slug!,
        company_name: c?.name || r.company_name || r.company_slug!,
        company_logo: c?.logo || null,
        score: 50 + amtScore,
        reason: `Just raised ${fmt$(r.amount_usd)} (${r.round_type || "round"}) — fresh security budget`,
        detail: r.lead_investors ? `Led by ${r.lead_investors}` : null,
        date: r.date,
        badges: ["Funded", r.round_type ?? "", fmt$(r.amount_usd)].filter(Boolean),
        amount_usd: r.amount_usd,
      };
    });
}

// 5) Warm leads — share investor with user's firm
export async function fetchWarmLeadSignals(args: {
  investors: string[];
  savedSlugs: Set<string>;
  existingClients: Set<string>;
}): Promise<Signal[]> {
  const investors = args.investors.filter(Boolean);
  if (investors.length === 0) return [];
  const orParts = investors.flatMap((inv) => {
    const safe = inv.replace(/[%,()]/g, " ").trim();
    if (!safe) return [];
    return [
      `lead_investors.ilike.%${safe}%`,
      `other_investors.ilike.%${safe}%`,
      `all_investors.ilike.%${safe}%`,
    ];
  }).join(",");
  if (!orParts) return [];
  const { data } = await supabase
    .from("funding_rounds")
    .select("company_slug,company_name,amount_usd,round_type,date,lead_investors")
    .or(orParts)
    .not("company_slug", "is", null)
    .order("date", { ascending: false })
    .limit(200);
  const seen = new Set<string>();
  const rows = ((data || []) as Array<{
    company_slug: string | null; company_name: string | null;
    amount_usd: number | null; round_type: string | null; date: string | null;
    lead_investors: string | null;
  }>).filter((r) => {
    if (!r.company_slug) return false;
    if (args.existingClients.has(r.company_slug)) return false;
    if (seen.has(r.company_slug)) return false;
    seen.add(r.company_slug);
    return true;
  });
  const slugs = rows.map((r) => r.company_slug!).slice(0, 100);
  const cmap = await fetchCompaniesLite(slugs);
  return rows.slice(0, 100).map((r) => {
    const c = cmap.get(r.company_slug!);
    const isSaved = args.savedSlugs.has(r.company_slug!);
    return {
      id: `warm:${r.company_slug}`,
      type: "warm_lead",
      company_slug: r.company_slug!,
      company_name: c?.name || r.company_name || r.company_slug!,
      company_logo: c?.logo || null,
      score: 45 + (isSaved ? 20 : 0),
      reason: `Backed by an investor you share — warm intro available`,
      detail: r.lead_investors ? `Led by ${r.lead_investors}` : null,
      date: r.date,
      badges: ["Warm", r.round_type ?? "", isSaved ? "Saved" : ""].filter(Boolean),
    };
  });
}

function fmt$(n: number | null | undefined): string {
  if (!n) return "TBA";
  const v = Number(n);
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
}

// Merge all sources; dedup by company_slug keeping the highest-scored signal.
// Returns sorted desc by score.
export function mergeSignals(sources: Signal[][]): Signal[] {
  const byCompany = new Map<string, Signal>();
  for (const list of sources) {
    for (const s of list) {
      const existing = byCompany.get(s.company_slug);
      if (!existing || s.score > existing.score) byCompany.set(s.company_slug, s);
    }
  }
  return Array.from(byCompany.values()).sort((a, b) => b.score - a.score);
}
