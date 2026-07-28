import { supabase } from "@/lib/supabase";
import { callAnthropic } from "@/lib/anthropic";

const HAIKU = "claude-haiku-4-5-20251001";
const STALE_AFTER_DAYS = 30;

export type CompanyFacts = {
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  description_generated_at: string | null;
  audit_count: number | null;
  last_audit_firm: string | null;
  last_audit_date: string | null;
  total_raised_usd: number | null;
  has_bug_bounty: boolean | null;
  is_institution: boolean | null;
  url: string | null;
};

function shouldRegenerate(c: CompanyFacts): boolean {
  if (!c.description || c.description.trim().length < 20) return true;
  if (!c.description_generated_at) return false;
  const age = Date.now() - new Date(c.description_generated_at).getTime();
  return age > STALE_AFTER_DAYS * 86400000;
}

/**
 * Synthesize a 1-2 sentence "current state" description for a company
 * from our own data — audit history, funding, TVL, signals.
 * Cached in `companies.description` with `description_generated_at` timestamp.
 * Cheap (~$0.0005 per call with Haiku). Skips if already fresh.
 */
export async function generateCompanyDescription(slug: string): Promise<string | null> {
  if (!slug) return null;

  // Pull current state
  const { data: c } = await supabase
    .from("companies")
    .select("slug,name,category,description,description_generated_at,audit_count,last_audit_firm,last_audit_date,total_raised_usd,has_bug_bounty,is_institution,url")
    .eq("slug", slug)
    .maybeSingle();
  if (!c) return null;
  if (!shouldRegenerate(c as CompanyFacts)) return c.description;

  // Pull supplementary facts in parallel
  const [auditsRes, fundingsRes, signalsRes, tvlProtoRes] = await Promise.all([
    supabase.from("audit_history").select("audit_firm,audit_date,audit_type").eq("company_slug", slug).order("audit_date", { ascending: false }).limit(10),
    supabase.from("funding_rounds").select("date,amount_usd,round_type,lead_investors").eq("company_slug", slug).order("date", { ascending: false }).limit(3),
    supabase.from("account_signals").select("signal_type,signal_subtype,title,fired_at").eq("company_slug", slug).order("fired_at", { ascending: false }).limit(5),
    supabase.from("protocols").select("name,smart_contract_language,chains").eq("parent_slug", slug).limit(5),
  ]);

  const audits = auditsRes.data || [];
  const fundings = fundingsRes.data || [];
  const signals = signalsRes.data || [];
  const protocols = (tvlProtoRes.data || []) as Array<{ name: string; smart_contract_language: string | null; chains: string[] | null }>;

  const firms = Array.from(new Set(audits.map((a) => a.audit_firm).filter(Boolean)));
  const lastAudit = audits[0];
  const lastFunding = fundings[0];
  const totalRaised = Number(c.total_raised_usd) || fundings.reduce((s, f) => s + (Number(f.amount_usd) || 0), 0);

  const facts = {
    name: c.name,
    category: c.category,
    is_institution: c.is_institution || undefined,
    url: c.url,
    audit_count: c.audit_count || audits.length || 0,
    firms_used: firms.slice(0, 5),
    last_audit_firm: lastAudit?.audit_firm || null,
    last_audit_date: lastAudit?.audit_date || null,
    total_raised_usd: totalRaised || null,
    last_funding: lastFunding ? { date: lastFunding.date, amount_usd: lastFunding.amount_usd, round_type: lastFunding.round_type, lead_investors: lastFunding.lead_investors } : null,
    has_bug_bounty: c.has_bug_bounty || undefined,
    protocols: protocols.map((p) => ({ name: p.name, chains: p.chains, language: p.smart_contract_language })),
    recent_signals: signals.map((s) => ({ type: s.signal_type, subtype: s.signal_subtype, title: s.title })),
  };

  const system = `You write 1-2 sentence neutral, factual company descriptions for a B2B sales-intel tool. The reader is a security/dev-tooling sales rep evaluating this company as a prospect. Lead with what they DO (use category + protocol names if available), then the most relevant CURRENT STATE fact (recent funding, audit cadence, TVL, hiring momentum). Strictly factual — no marketing fluff, no "leading", no "innovative". If the data is sparse, say less. NEVER invent. Output the description as a single paragraph, plain text, no quotes.`;
  const userPrompt = `Facts about the company:\n${JSON.stringify(facts, null, 2)}\n\nWrite the description now. 1-2 sentences, 20-50 words total.`;

  try {
    const text = await callAnthropic({
      system,
      messages: [{ role: "user", content: userPrompt }],
      max_tokens: 200,
      model: HAIKU,
    });
    const cleaned = text.trim().replace(/^"|"$/g, "").replace(/\s+/g, " ");
    if (!cleaned || cleaned.length < 10) return c.description;

    // Cache it
    await supabase
      .from("companies")
      .update({ description: cleaned, description_generated_at: new Date().toISOString() })
      .eq("slug", slug);
    return cleaned;
  } catch (e) {
    console.warn("[generateCompanyDescription] failed for", slug, e);
    return c.description;
  }
}
