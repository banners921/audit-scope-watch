import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Beaker, Shield, Coins, Banknote, AlertTriangle, ExternalLink, Activity, ChevronDown, Users, Info, Vote } from "lucide-react";
import { stoverSupabase, stoverConfigured, auditscopeMainSupabase } from "@/lib/stoverSupabase";

type Company = {
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  url: string | null;
  twitter: string | null;
  linkedin: string | null;
  telegram: string | null;
  logo: string | null;
  last_audit_date: string | null;
  last_audit_firm: string | null;
  has_bug_bounty: boolean | null;
  audit_count: number | null;
  data_source: string | null;
  audit_coverage_status: string | null;
  audit_coverage_notes: string | null;
  token_allocation: Record<string, number | string> | null;
  last_refreshed_at: string | null;
  website_status: string | null;
  website_http_status: number | null;
  website_status_checked_at: string | null;
  last_x_post_at: string | null;
  last_x_post_text: string | null;
  x_posts_30d: number | null;
  x_activity_checked_at: string | null;
  token_symbol: string | null;
  token_launch_time: string | null;
  support_exchanges: Array<{ exchange_name: string; exchange_logo: string }> | null;
  on_main_net: string[] | null;
  on_test_net: string[] | null;
  gitbook_url: string | null;
  medium_url: string | null;
  project_active: boolean | null;
  rd_project_id: number | null;
  rd_metadata: {
    rt_score?: number;
    transparency?: string;
    heat_rank?: number;
    influence_rank?: number;
    heat?: string;
    influence?: string;
    tags?: string[];
    countries?: string[];
    establishment_date?: string;
    rootdataurl?: string;
    x_followers?: number;
    x_following?: number;
    similar_projects?: Array<{ id: number; name: string; logo: string }>;
    twitter_metrics?: { handle?: string; followers?: number; heat?: string; influence?: string };
    project_type?: string;
    ecosystem?: string[];
    top_followers_count?: number;
  } | null;
};

type Contract = { id: string; company_slug: string; chain: string; address: string; kind: string; label: string | null; source: string | null; explorer_url: string | null };

type Audit = {
  id: string;
  company_slug: string;
  audit_firm: string | null;
  audit_date: string | null;
  audit_type: string | null;
  report_url: string | null;
  findings_critical: number | null;
  findings_high: number | null;
  findings_medium: number | null;
  findings_low: number | null;
  ai_summary: string | null;
};

type Finding = { audit_id: string; severity: string; title: string; summary: string | null; status: string | null };

type AuditContract = { audit_id: string; contract_id: string; scope_note: string | null; confidence: string };

type Round = {
  id: string;
  company_slug: string;
  company_name: string;
  amount_usd: number | null;
  round_type: string | null;
  date: string | null;
  lead_investors: string | null;
  other_investors: string | null;
  all_investors: string | null;
  announcement_url: string | null;
  announcement_summary: string | null;
  valuation_usd: number | null;
  valuation_type: string | null;
  security_type: string | null;
  token_warrant: boolean | null;
  token_warrant_terms: string | null;
  founder_quote: string | null;
  founder_quote_source: string | null;
  press_coverage: Array<{ url: string; source?: string; date?: string; title?: string }> | null;
  use_of_proceeds: string | null;
  product_stage_at_raise: string | null;
  verified_at: string | null;
  verification_method: string | null;
};

type RoundInvestor = {
  id: string;
  round_id: string;
  investor_name: string;
  investor_slug: string | null;
  role: string;
  check_size_usd: number | null;
  logo_url: string | null;
  investor_url: string | null;
  investor_twitter: string | null;
  notes: string | null;
};

type TeamMember = {
  id: string;
  company_slug: string;
  full_name: string;
  role: string;
  bio: string | null;
  linkedin_url: string | null;
  twitter_url: string | null;
  github_url: string | null;
  photo_url: string | null;
  prior_companies: string[] | null;
  joined_at: string | null;
  is_founder: boolean;
  is_current: boolean;
  source: string | null;
  source_url: string | null;
  verified_at: string | null;
  ownership_pct_low: number | null;
  ownership_pct_high: number | null;
  psc_notified_on: string | null;
  rd_people_id: number | null;
  last_x_post_at: string | null;
  x_activity_checked_at: string | null;
  linkedin_last_seen_active: string | null;
};

type LegalEntity = {
  id: string;
  company_slug: string;
  jurisdiction: string;
  registry: string;
  registry_id: string;
  legal_name: string;
  status: string | null;
  incorporated_on: string | null;
  dissolved_on: string | null;
  registered_address: string | null;
  is_primary: boolean;
  source_url: string | null;
  source: string | null;
  verified_at: string | null;
};

type HolderSnapshot = {
  id: string;
  company_slug: string;
  token_address: string;
  snapshot_at: string;
  total_supply: number | null;
  top_1_pct: number | null;
  top_5_pct: number | null;
  top_10_pct: number | null;
  top_20_pct: number | null;
  top_holder_address: string | null;
  top_holder_balance: number | null;
  top_holder_label: string | null;
  source: string | null;
};

type TokenUnlock = {
  id: string;
  company_slug: string;
  unlock_date: string;
  unlock_type: string | null;
  amount_tokens: number | null;
  amount_usd: number | null;
  allocation: string | null;
  pct_supply_released: number | null;
  is_past: boolean | null;
  source: string | null;
  source_url: string | null;
  notes: string | null;
};

type NewsItem = {
  id: string;
  company_slug: string;
  title: string;
  summary: string | null;
  url: string;
  published_at: string | null;
  source: string | null;
};

type CommunityHandle = {
  id: string;
  company_slug: string;
  platform: string;
  handle: string;
  invite_url: string | null;
  channel_url: string | null;
  source: string | null;
};

type CommunityMetric = {
  id: string;
  company_slug: string;
  platform: string;
  snapshot_at: string;
  members_total: number | null;
  members_online: number | null;
  source: string | null;
};

type GovernanceSnapshot = {
  id: string;
  company_slug: string;
  space_id: string;
  space_name: string | null;
  proposals_count: number | null;
  followers_count: number | null;
  active_proposals_count: number | null;
  closed_proposals_count: number | null;
  last_proposal_at: string | null;
  last_proposal_title: string | null;
  last_proposal_state: string | null;
  last_proposal_url: string | null;
  voting_strategy: string | null;
  source: string | null;
  captured_at: string;
};

type GovernanceProposal = {
  id: string;
  company_slug: string;
  space_id: string;
  proposal_id: string;
  title: string | null;
  state: string | null;
  end_at: string | null;
  votes: number | null;
  scores_total: number | null;
  link: string | null;
};

type ExploitCheck = {
  id: string;
  company_slug: string;
  events_found: number;
  total_amount_usd: number | null;
  most_recent_event_date: string | null;
  source: string | null;
  source_total_hacks: number | null;
  captured_at: string;
};

type ExploitEvent = {
  id: string;
  company_slug: string;
  name: string;
  event_date: string | null;
  amount_usd: number | null;
  returned_funds_usd: number | null;
  classification: string | null;
  technique: string | null;
  chains: string[] | null;
  source_url: string | null;
};

type ComparableRound = {
  company_slug: string;
  company_name: string;
  company_logo: string | null;
  category: string;
  round_type: string | null;
  amount_usd: number | null;
  date: string | null;
  lead_investors: string | null;
  announcement_url: string | null;
};

type RegulatoryCheck = {
  id: string;
  company_slug: string;
  query_used: string;
  hits_count: number;
  hits_json: Array<{
    query: string;
    display_name: string | null;
    ciks: string[];
    forms: string | string[] | null;
    file_date: string | null;
    adsh: string | null;
    url: string | null;
    form_title?: string | null;
    notes?: string | null;
  }> | null;
  most_recent_filing_date: string | null;
  most_recent_form: string | null;
  source: string | null;
  captured_at: string;
};

type LiquiditySnapshot = {
  id: string;
  company_slug: string;
  cg_id: string | null;
  total_pairs: number | null;
  total_24h_volume_usd: number | null;
  total_depth_up_2pct_usd: number | null;
  total_depth_down_2pct_usd: number | null;
  weighted_avg_spread_pct: number | null;
  stale_pairs: number | null;
  anomaly_pairs: number | null;
  top_pair_market: string | null;
  top_pair_base: string | null;
  top_pair_target: string | null;
  top_pair_volume_usd: number | null;
  top_pair_depth_up_usd: number | null;
  top_pair_depth_down_usd: number | null;
  top_pair_spread_pct: number | null;
  pairs_json: Array<{
    market: string; market_id: string; base: string; target: string;
    last: number; vol_24h_usd: number; spread_pct: number;
    depth_up_2pct_usd: number; depth_down_2pct_usd: number;
    trust_score: string | null; trade_url: string | null;
  }> | null;
  source: string | null;
  captured_at: string;
};

type Metric = {
  company_slug: string;
  snapshot_at: string;
  circulating_supply: number | null;
  total_supply: number | null;
  total_staked: number | null;
  staking_apy_unlocked: number | null;
  staking_apy_locked_max: number | null;
  tvl_usd: number | null;
  holder_count: number | null;
  foundation_treasury_balance: number | null;
  coinbase_balance: number | null;
  staking_contract_balance: number | null;
  reward_per_second: number | null;
  reward_pool_remaining: number | null;
  staking_period_finish: number | null;
  reward_pool_runway_years: number | null;
  github_commits_90d: number | null;
  github_active_repos: number | null;
  github_last_commit_at: string | null;
  price_usd: number | null;
  market_cap_usd: number | null;
  volume_24h_usd: number | null;
  ath_usd: number | null;
  ath_date: string | null;
  exchange_pair_count: number | null;
  top_exchange_name: string | null;
  top_exchange_24h_vol_usd: number | null;
  source: string | null;
  source_url: string | null;
};

export default function Stover() {
  if (!stoverConfigured) return <ConfigMissing />;

  const companiesQ = useQuery({
    queryKey: ["stover-companies"],
    queryFn: async (): Promise<Company[]> => {
      const { data, error } = await stoverSupabase!.from("companies").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Company[];
    },
  });

  const contractsQ = useQuery({
    queryKey: ["stover-contracts"],
    queryFn: async (): Promise<Contract[]> => {
      const { data, error } = await stoverSupabase!.from("chain_addresses").select("*");
      if (error) throw error;
      return (data ?? []) as Contract[];
    },
  });

  const auditsQ = useQuery({
    queryKey: ["stover-audits"],
    queryFn: async (): Promise<Audit[]> => {
      const { data, error } = await stoverSupabase!.from("audit_history").select("*").order("audit_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Audit[];
    },
  });

  const findingsQ = useQuery({
    queryKey: ["stover-findings"],
    queryFn: async (): Promise<Finding[]> => {
      const { data, error } = await stoverSupabase!.from("audit_findings_detail").select("*");
      if (error) throw error;
      return (data ?? []) as Finding[];
    },
  });

  const roundsQ = useQuery({
    queryKey: ["stover-rounds"],
    queryFn: async (): Promise<Round[]> => {
      const { data, error } = await stoverSupabase!.from("funding_rounds").select("*").order("date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Round[];
    },
  });

  const metricsQ = useQuery({
    queryKey: ["stover-metrics"],
    queryFn: async (): Promise<Metric[]> => {
      const { data, error } = await stoverSupabase!.from("protocol_metrics").select("*").order("snapshot_at", { ascending: false });
      if (error) return [];
      return (data ?? []) as Metric[];
    },
  });

  const auditContractsQ = useQuery({
    queryKey: ["stover-audit-contracts"],
    queryFn: async (): Promise<AuditContract[]> => {
      const { data, error } = await stoverSupabase!.from("audit_contracts").select("*");
      if (error) return [];
      return (data ?? []) as AuditContract[];
    },
  });

  const roundInvestorsQ = useQuery({
    queryKey: ["stover-round-investors"],
    queryFn: async (): Promise<RoundInvestor[]> => {
      const { data, error } = await stoverSupabase!.from("funding_round_investors").select("*");
      if (error) return [];
      return (data ?? []) as RoundInvestor[];
    },
  });

  const teamMembersQ = useQuery({
    queryKey: ["stover-team-members"],
    queryFn: async (): Promise<TeamMember[]> => {
      const { data, error } = await stoverSupabase!.from("team_members").select("*").order("is_founder", { ascending: false });
      if (error) return [];
      return (data ?? []) as TeamMember[];
    },
  });

  const legalEntitiesQ = useQuery({
    queryKey: ["stover-legal-entities"],
    queryFn: async (): Promise<LegalEntity[]> => {
      const { data, error } = await stoverSupabase!.from("legal_entities").select("*").order("is_primary", { ascending: false });
      if (error) return [];
      return (data ?? []) as LegalEntity[];
    },
  });

  const newsItemsQ = useQuery({
    queryKey: ["stover-news-items"],
    queryFn: async (): Promise<NewsItem[]> => {
      const { data, error } = await stoverSupabase!.from("news_items").select("*").order("published_at", { ascending: false });
      if (error) return [];
      return (data ?? []) as NewsItem[];
    },
  });

  const communityHandlesQ = useQuery({
    queryKey: ["stover-community-handles"],
    queryFn: async (): Promise<CommunityHandle[]> => {
      const { data, error } = await stoverSupabase!.from("community_handles").select("*");
      if (error) return [];
      return (data ?? []) as CommunityHandle[];
    },
  });

  const communityMetricsQ = useQuery({
    queryKey: ["stover-community-metrics"],
    queryFn: async (): Promise<CommunityMetric[]> => {
      const { data, error } = await stoverSupabase!.from("community_metrics").select("*").order("snapshot_at", { ascending: false });
      if (error) return [];
      return (data ?? []) as CommunityMetric[];
    },
  });

  const tokenUnlocksQ = useQuery({
    queryKey: ["stover-token-unlocks"],
    queryFn: async (): Promise<TokenUnlock[]> => {
      const { data, error } = await stoverSupabase!.from("token_unlocks").select("*").order("unlock_date", { ascending: true });
      if (error) return [];
      return (data ?? []) as TokenUnlock[];
    },
  });

  const holderSnapshotsQ = useQuery({
    queryKey: ["stover-holder-snapshots"],
    queryFn: async (): Promise<HolderSnapshot[]> => {
      const { data, error } = await stoverSupabase!.from("token_holder_snapshots").select("*").order("snapshot_at", { ascending: false });
      if (error) return [];
      return (data ?? []) as HolderSnapshot[];
    },
  });

  const governanceSnapshotsQ = useQuery({
    queryKey: ["stover-governance-snapshots"],
    queryFn: async (): Promise<GovernanceSnapshot[]> => {
      const { data, error } = await stoverSupabase!.from("governance_snapshots").select("*").order("captured_at", { ascending: false });
      if (error) return [];
      return (data ?? []) as GovernanceSnapshot[];
    },
  });

  const governanceProposalsQ = useQuery({
    queryKey: ["stover-governance-proposals"],
    queryFn: async (): Promise<GovernanceProposal[]> => {
      const { data, error } = await stoverSupabase!.from("governance_proposals").select("id,company_slug,space_id,proposal_id,title,state,end_at,votes,scores_total,link").order("end_at", { ascending: false, nullsFirst: false }).limit(200);
      if (error) return [];
      return (data ?? []) as GovernanceProposal[];
    },
  });

  const exploitChecksQ = useQuery({
    queryKey: ["stover-exploit-checks"],
    queryFn: async (): Promise<ExploitCheck[]> => {
      const { data, error } = await stoverSupabase!.from("exploit_check_snapshots").select("*").order("captured_at", { ascending: false });
      if (error) return [];
      return (data ?? []) as ExploitCheck[];
    },
  });

  const exploitEventsQ = useQuery({
    queryKey: ["stover-exploit-events"],
    queryFn: async (): Promise<ExploitEvent[]> => {
      const { data, error } = await stoverSupabase!.from("exploit_events").select("id,company_slug,name,event_date,amount_usd,returned_funds_usd,classification,technique,chains,source_url").order("event_date", { ascending: false, nullsFirst: false });
      if (error) return [];
      return (data ?? []) as ExploitEvent[];
    },
  });

  const liquidityQ = useQuery({
    queryKey: ["stover-liquidity"],
    queryFn: async (): Promise<LiquiditySnapshot[]> => {
      const { data, error } = await stoverSupabase!.from("liquidity_snapshots").select("*").order("captured_at", { ascending: false });
      if (error) return [];
      return (data ?? []) as LiquiditySnapshot[];
    },
  });

  const regulatoryQ = useQuery({
    queryKey: ["stover-regulatory"],
    queryFn: async (): Promise<RegulatoryCheck[]> => {
      const { data, error } = await stoverSupabase!.from("regulatory_checks").select("*").order("captured_at", { ascending: false });
      if (error) return [];
      return (data ?? []) as RegulatoryCheck[];
    },
  });

  // Comparable transactions — Otto Cat 7. Pulls recent same-category rounds
  // from the main AuditScope DB (10K companies, 3.6K rounds), keyed by each
  // Otto position's category. Filtered to last 18 months for mark-to-model.
  const comparablesQ = useQuery({
    queryKey: ["stover-comparable-rounds", (companiesQ.data ?? []).map(c => c.category).join(",")],
    enabled: !!auditscopeMainSupabase && (companiesQ.data ?? []).length > 0,
    queryFn: async (): Promise<Record<string, ComparableRound[]>> => {
      if (!auditscopeMainSupabase) return {};
      const cats = Array.from(new Set((companiesQ.data ?? []).map(c => c.category).filter(Boolean))) as string[];
      if (cats.length === 0) return {};
      const cutoff = new Date(Date.now() - 18 * 30 * 86400 * 1000).toISOString().slice(0, 10);

      // 1. Find companies in those categories in main DB
      const { data: comps } = await auditscopeMainSupabase
        .from("companies")
        .select("slug,name,category,logo")
        .in("category", cats)
        .limit(2000);
      if (!comps || comps.length === 0) return {};
      const slugToCo = new Map<string, any>();
      const slugsByCategory = new Map<string, string[]>();
      for (const c of comps) {
        slugToCo.set(c.slug, c);
        if (!slugsByCategory.has(c.category)) slugsByCategory.set(c.category, []);
        slugsByCategory.get(c.category)!.push(c.slug);
      }

      // 2. Pull recent funding rounds for those slugs
      const allSlugs = Array.from(slugToCo.keys());
      const chunks: string[][] = [];
      for (let i = 0; i < allSlugs.length; i += 500) chunks.push(allSlugs.slice(i, i + 500));
      const allRounds: any[] = [];
      for (const chunk of chunks) {
        const { data: rounds } = await auditscopeMainSupabase
          .from("funding_rounds")
          .select("company_slug,company_name,round_type,amount_usd,date,lead_investors,announcement_url")
          .in("company_slug", chunk)
          .gte("date", cutoff)
          .order("date", { ascending: false });
        if (rounds) allRounds.push(...rounds);
      }

      // 3. Group rounds by Otto position's category, dedupe (slug,date,amount),
      //    skip self-comps and rounds without an amount.
      const ottoSlugs = new Set((companiesQ.data ?? []).map(c => c.slug));
      const seen = new Set<string>();
      const byCategory = new Map<string, ComparableRound[]>();
      for (const r of allRounds) {
        const co = slugToCo.get(r.company_slug);
        if (!co || ottoSlugs.has(co.slug)) continue;
        if (!r.amount_usd || r.amount_usd <= 0) continue;
        const dedupeKey = `${r.company_slug}|${r.date}|${Math.round(r.amount_usd)}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        const cat = co.category;
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        if (byCategory.get(cat)!.length >= 6) continue;  // top 6 per category
        byCategory.get(cat)!.push({
          company_slug: co.slug,
          company_name: co.name || r.company_name,
          company_logo: co.logo,
          category: cat,
          round_type: r.round_type || null,
          amount_usd: r.amount_usd,
          date: r.date,
          lead_investors: r.lead_investors || null,
          announcement_url: r.announcement_url,
        });
      }

      // 4. Materialise as map Otto-slug → comp rounds for THAT category
      const out: Record<string, ComparableRound[]> = {};
      for (const c of companiesQ.data ?? []) {
        if (!c.category) continue;
        out[c.slug] = byCategory.get(c.category) ?? [];
      }
      return out;
    },
  });

  const isLoading = companiesQ.isLoading || contractsQ.isLoading || auditsQ.isLoading || findingsQ.isLoading || roundsQ.isLoading;
  const error = companiesQ.error || contractsQ.error || auditsQ.error || findingsQ.error || roundsQ.error;

  return (
    <div className="space-y-5 max-w-[1400px]">
      <header className="flex items-end justify-between gap-3 flex-wrap pb-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Beaker className="w-5 h-5 text-fuchsia-300" />
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-fuchsia-300">Veilux × Otto pilot</div>
            <h1 className="text-xl font-semibold text-white tracking-tight">STOVER</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Live view of the new Supabase project (`anhfsuiacapcxwtbuuav`). Read-only. Temp page.
            </p>
          </div>
        </div>
        {!isLoading && !error && (
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <Stat label="Companies" value={companiesQ.data?.length ?? 0} />
            <Stat label="Contracts" value={contractsQ.data?.length ?? 0} />
            <Stat label="Audits" value={auditsQ.data?.length ?? 0} />
            <Stat label="Findings" value={findingsQ.data?.length ?? 0} />
            <Stat label="Rounds" value={roundsQ.data?.length ?? 0} />
          </div>
        )}
      </header>

      {isLoading && <div className="text-muted-foreground text-sm py-8 text-center">Loading…</div>}
      {error && (
        <div className="as-card p-4 border-rose-500/30 bg-rose-500/[0.06]">
          <div className="text-sm font-semibold text-rose-300">Couldn't reach the new Supabase</div>
          <div className="text-[11px] text-muted-foreground mt-1">{(error as Error).message}</div>
        </div>
      )}

      {!isLoading && !error && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {(companiesQ.data ?? []).map(c => {
            const cContracts = (contractsQ.data ?? []).filter(x => x.company_slug === c.slug);
            const cAudits = (auditsQ.data ?? []).filter(x => x.company_slug === c.slug);
            const cAuditIds = new Set(cAudits.map(a => a.id));
            const cFindings = (findingsQ.data ?? []).filter(x => cAuditIds.has(x.audit_id));
            const cRounds = (roundsQ.data ?? []).filter(x => x.company_slug === c.slug);
            const cMetrics = (metricsQ.data ?? []).filter(x => x.company_slug === c.slug);
            const cAuditContracts = (auditContractsQ.data ?? []).filter(ac =>
              cAuditIds.has(ac.audit_id) && cContracts.some(ct => ct.id === ac.contract_id)
            );
            const cRoundIds = new Set(cRounds.map(r => r.id));
            const cRoundInvestors = (roundInvestorsQ.data ?? []).filter(ri => cRoundIds.has(ri.round_id));
            const cTeam = (teamMembersQ.data ?? []).filter(t => t.company_slug === c.slug);
            const cLegal = (legalEntitiesQ.data ?? []).filter(l => l.company_slug === c.slug);
            const cNews = (newsItemsQ.data ?? []).filter(n => n.company_slug === c.slug);
            const cCommHandles = (communityHandlesQ.data ?? []).filter(h => h.company_slug === c.slug);
            const cCommMetrics = (communityMetricsQ.data ?? []).filter(m => m.company_slug === c.slug);
            const cUnlocks = (tokenUnlocksQ.data ?? []).filter(u => u.company_slug === c.slug);
            const cHolderSnap = (holderSnapshotsQ.data ?? []).find(h => h.company_slug === c.slug);
            const cGovSnap = (governanceSnapshotsQ.data ?? []).find(g => g.company_slug === c.slug);
            const cGovProposals = (governanceProposalsQ.data ?? []).filter(p => p.company_slug === c.slug);
            const cExploitCheck = (exploitChecksQ.data ?? []).find(x => x.company_slug === c.slug);
            const cExploitEvents = (exploitEventsQ.data ?? []).filter(x => x.company_slug === c.slug);
            const cLiquidity = (liquidityQ.data ?? []).find(x => x.company_slug === c.slug);
            const cRegulatory = (regulatoryQ.data ?? []).find(x => x.company_slug === c.slug);
            const cComparables = (comparablesQ.data ?? {})[c.slug] ?? [];
            return <CompanyCard key={c.slug} company={c} contracts={cContracts} audits={cAudits} findings={cFindings} rounds={cRounds} roundInvestors={cRoundInvestors} metrics={cMetrics} auditContracts={cAuditContracts} team={cTeam} legalEntities={cLegal} news={cNews} commHandles={cCommHandles} commMetrics={cCommMetrics} unlocks={cUnlocks} holderSnap={cHolderSnap} govSnap={cGovSnap} govProposals={cGovProposals} exploitCheck={cExploitCheck} exploitEvents={cExploitEvents} liquidity={cLiquidity} regulatory={cRegulatory} comparables={cComparables} />;
          })}
          {(companiesQ.data ?? []).length === 0 && (
            <div className="text-muted-foreground text-sm py-12 text-center col-span-full border border-dashed border-white/[0.08] rounded">
              No companies yet in the new Supabase. Push some via the audit-api or directly.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-2 py-1 rounded bg-white/[0.03] border border-white/[0.06]">
      <span className="text-white font-mono">{value}</span>
      <span className="text-muted-foreground ml-1">{label}</span>
    </div>
  );
}

function CompanyCard({ company, contracts, audits, findings, rounds, roundInvestors, metrics, auditContracts, team, legalEntities, news, commHandles, commMetrics, unlocks, holderSnap, govSnap, govProposals, exploitCheck, exploitEvents, liquidity, regulatory, comparables }: { company: Company; contracts: Contract[]; audits: Audit[]; findings: Finding[]; rounds: Round[]; roundInvestors: RoundInvestor[]; metrics: Metric[]; auditContracts: AuditContract[]; team: TeamMember[]; legalEntities: LegalEntity[]; news: NewsItem[]; commHandles: CommunityHandle[]; commMetrics: CommunityMetric[]; unlocks: TokenUnlock[]; holderSnap: HolderSnapshot | undefined; govSnap: GovernanceSnapshot | undefined; govProposals: GovernanceProposal[]; exploitCheck: ExploitCheck | undefined; exploitEvents: ExploitEvent[]; liquidity: LiquiditySnapshot | undefined; regulatory: RegulatoryCheck | undefined; comparables: ComparableRound[] }) {
  const totalRaised = rounds.reduce((acc, r) => acc + (Number(r.amount_usd) || 0), 0);
  const latestMetric = metrics[0];
  const contractsById = new Map(contracts.map(ct => [ct.id, ct]));
  const findingsBySev = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="as-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start gap-3 pb-2 border-b border-white/[0.04]">
        {company.logo ? (
          <img src={company.logo} alt="" className="w-10 h-10 rounded-md border border-white/[0.06] object-cover" />
        ) : (
          <div className="w-10 h-10 rounded-md border border-white/[0.06] bg-white/[0.02] flex items-center justify-center text-[14px] font-bold text-muted-foreground">{company.name.charAt(0)}</div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[14px] font-semibold text-white truncate">{company.name}</h3>
            {company.category && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-muted-foreground border border-white/[0.05]">{company.category}</span>}
            {company.subcategory && <span className="text-[10px] text-muted-foreground/70">· {company.subcategory}</span>}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">{company.slug}</div>
          {company.description && <p className="text-[11.5px] text-muted-foreground mt-1.5 line-clamp-3">{company.description}</p>}
          <div className="flex items-center gap-2 mt-1.5 text-[10.5px]">
            {company.url && <a href={company.url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">site <ExternalLink className="w-2.5 h-2.5" /></a>}
            {company.twitter && <a href={company.twitter.startsWith("http") ? company.twitter : `https://x.com/${company.twitter}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">x</a>}
            {company.linkedin && <a href={company.linkedin} target="_blank" rel="noreferrer" className="text-primary hover:underline">linkedin</a>}
            {company.telegram && <a href={company.telegram} target="_blank" rel="noreferrer" className="text-primary hover:underline">telegram</a>}
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-1.5">
        <Kpi label="Contracts" value={String(contracts.length)} />
        <Kpi label="Audits" value={String(audits.length)} />
        <Kpi label="Findings" value={String(findings.length)} />
        <Kpi label="Raised" value={totalRaised > 0 ? `$${(totalRaised / 1e6).toFixed(1)}M` : "—"} />
      </div>

      {/* Exploit cross-check — Otto Cat 1 "exploits" signal, daily DefiLlama Hacks API check */}
      {exploitCheck && (() => {
        const clean = (exploitCheck.events_found ?? 0) === 0;
        const checkedAt = new Date(exploitCheck.captured_at);
        return (
          <div className={`rounded border p-2 flex items-center gap-2 text-[11px] ${
            clean ? "border-emerald-500/30 bg-emerald-500/[0.05]" : "border-rose-500/40 bg-rose-500/[0.08]"
          }`}>
            <Shield className={`w-3.5 h-3.5 flex-shrink-0 ${clean ? "text-emerald-300" : "text-rose-300"}`} />
            <div className="flex-1 min-w-0">
              {clean ? (
                <div className="text-emerald-200">
                  <span className="font-semibold">No exploit incidents found.</span>
                  <span className="text-emerald-200/70 ml-1">
                    Checked against {exploitCheck.source_total_hacks?.toLocaleString() ?? "—"} DefiLlama records.
                  </span>
                </div>
              ) : (
                <div className="text-rose-200">
                  <span className="font-semibold">{exploitCheck.events_found} exploit incident{exploitCheck.events_found > 1 ? "s" : ""} on record</span>
                  {exploitCheck.total_amount_usd && (
                    <span className="ml-1 text-rose-200/80">· ${(exploitCheck.total_amount_usd / 1e6).toFixed(2)}M lost</span>
                  )}
                  {exploitCheck.most_recent_event_date && (
                    <span className="ml-1 text-rose-200/70">· most recent {exploitCheck.most_recent_event_date.slice(0, 10)}</span>
                  )}
                </div>
              )}
              {!clean && exploitEvents.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {exploitEvents.slice(0, 3).map(e => (
                    <div key={e.id} className="text-[10.5px] text-rose-200/90 flex items-center gap-1.5">
                      <span className="tabular-nums w-20">{e.event_date?.slice(0, 10) ?? "—"}</span>
                      <span className="flex-1 truncate">{e.name}</span>
                      {e.amount_usd != null && <span className="tabular-nums">${(e.amount_usd / 1e6).toFixed(2)}M</span>}
                      {e.classification && <span className="text-rose-200/60">· {e.classification}</span>}
                      {e.source_url && <a href={e.source_url} target="_blank" rel="noreferrer" className="hover:underline"><ExternalLink className="w-2.5 h-2.5" /></a>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="text-[9px] text-muted-foreground/80 font-mono whitespace-nowrap">
              checked {checkedAt.toLocaleDateString()}
            </div>
          </div>
        );
      })()}

      {/* Regulatory / SEC EDGAR check — Otto Cat 6 "SEC filings, enforcement news, regulatory developments" */}
      {regulatory && (() => {
        const clean = regulatory.hits_count === 0;
        const hits = regulatory.hits_json ?? [];
        return (
          <div className={`rounded border p-2 flex items-center gap-2 text-[11px] ${
            clean ? "border-emerald-500/30 bg-emerald-500/[0.05]" : "border-sky-500/30 bg-sky-500/[0.06]"
          }`}>
            <Shield className={`w-3.5 h-3.5 flex-shrink-0 ${clean ? "text-emerald-300" : "text-sky-300"}`} />
            <div className="flex-1 min-w-0">
              {clean ? (
                <div className="text-emerald-200">
                  <span className="font-semibold">No SEC filings or enforcement actions found.</span>
                  <span className="text-emerald-200/70 ml-1">Queried: {regulatory.query_used}</span>
                </div>
              ) : (
                <div className="text-sky-200">
                  <span className="font-semibold">{regulatory.hits_count} SEC filing{regulatory.hits_count > 1 ? "s" : ""} on record</span>
                  {regulatory.most_recent_form && (
                    <span className="ml-1 text-sky-200/80">· latest: Form {regulatory.most_recent_form}</span>
                  )}
                  {regulatory.most_recent_filing_date && (
                    <span className="ml-1 text-sky-200/70">· filed {regulatory.most_recent_filing_date}</span>
                  )}
                </div>
              )}
              {!clean && hits.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {hits.slice(0, 3).map((h, i) => (
                    <div key={`${h.adsh ?? i}`} className="text-[10.5px] text-sky-200/90 flex items-center gap-1.5">
                      <span className="tabular-nums w-20">{h.file_date ?? "—"}</span>
                      <span className="flex-1 truncate">{h.display_name ?? h.query}</span>
                      {h.forms && <span className="px-1 rounded bg-sky-500/20 text-sky-100 text-[9px] font-bold uppercase">{Array.isArray(h.forms) ? h.forms.join(",") : h.forms}</span>}
                      {h.url && <a href={h.url} target="_blank" rel="noreferrer" className="hover:underline"><ExternalLink className="w-2.5 h-2.5" /></a>}
                    </div>
                  ))}
                  {hits[0]?.notes && (
                    <div className="text-[10px] text-sky-200/70 italic mt-0.5 leading-snug">{hits[0].notes}</div>
                  )}
                </div>
              )}
            </div>
            <div className="text-[9px] text-muted-foreground/80 font-mono whitespace-nowrap">
              EDGAR · {new Date(regulatory.captured_at).toLocaleDateString()}
            </div>
          </div>
        );
      })()}

      {/* Activity / Dormancy signals — Otto's mark-review signal. High position by design. */}
      {(company.website_status || company.last_x_post_at || team.some(t => t.last_x_post_at)) && (() => {
        const monthsSince = (iso: string | null) => {
          if (!iso) return null;
          const ms = Date.now() - new Date(iso).getTime();
          return Math.floor(ms / (30 * 86400 * 1000));
        };
        const fmtMonths = (m: number | null) =>
          m == null ? "—" : m === 0 ? "this month" : m === 1 ? "1 month ago" : `${m} months ago`;
        const tone = (m: number | null) =>
          m == null ? "border-white/[0.06] bg-white/[0.02] text-muted-foreground"
          : m < 3 ? "border-emerald-500/30 bg-emerald-500/[0.04] text-emerald-300"
          : m < 6 ? "border-amber-500/30 bg-amber-500/[0.06] text-amber-300"
          : "border-rose-500/30 bg-rose-500/[0.06] text-rose-300";
        const companyMonths = monthsSince(company.last_x_post_at);
        const founderMostRecent = team
          .filter(t => t.is_founder && t.last_x_post_at)
          .map(t => ({ name: t.full_name, months: monthsSince(t.last_x_post_at), handle: t.twitter_url }))
          .sort((a, b) => (a.months ?? 0) - (b.months ?? 0))[0];
        const dormant = (company.website_status === "paused" || company.website_status === "down") ||
          (companyMonths != null && companyMonths >= 6) ||
          (founderMostRecent && (founderMostRecent.months ?? 0) >= 6);
        return (
          <div className={`rounded border p-2 ${dormant ? "border-rose-500/30 bg-rose-500/[0.06]" : "border-white/[0.06] bg-white/[0.02]"}`}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Activity className={`w-3 h-3 ${dormant ? "text-rose-300" : "text-emerald-300"}`} />
              <h4 className="text-[10px] uppercase tracking-[0.1em] font-semibold">
                {dormant ? "Dormancy signals" : "Activity signals"}
              </h4>
              {dormant && (
                <span className="text-[9px] uppercase tracking-wider px-1 py-0 rounded bg-rose-500/15 text-rose-200 border border-rose-500/30 font-bold">
                  mark review
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {company.website_status && (
                <div className={`rounded border p-1.5 ${company.website_status === "live" ? "border-emerald-500/30 bg-emerald-500/[0.04]" : "border-rose-500/30 bg-rose-500/[0.06]"}`}>
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Website</div>
                  <div className={`text-[11px] font-semibold ${company.website_status === "live" ? "text-emerald-300" : "text-rose-300"}`}>
                    {company.website_status === "live" ? "🟢 Live" : company.website_status === "paused" ? "⚠ Paused" : company.website_status === "down" ? "🔴 Down" : company.website_status}
                  </div>
                  {company.website_http_status != null && (
                    <div className="text-[9px] text-muted-foreground font-mono">HTTP {company.website_http_status}</div>
                  )}
                  {company.website_status_checked_at && (
                    <div className="text-[8.5px] text-muted-foreground/70 mt-0.5">checked {new Date(company.website_status_checked_at).toLocaleDateString()}</div>
                  )}
                </div>
              )}
              {company.last_x_post_at && (
                <div className={`rounded border p-1.5 ${tone(companyMonths)}`}>
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Company last X post</div>
                  <div className="text-[11px] font-semibold">{fmtMonths(companyMonths)}</div>
                  <div className="text-[8.5px] text-muted-foreground/70 mt-0.5 truncate">
                    {company.twitter ? (company.twitter.includes("/") ? company.twitter.split("/").pop() : company.twitter) : "—"}
                  </div>
                </div>
              )}
              {founderMostRecent && founderMostRecent.months != null && (
                <div className={`rounded border p-1.5 ${tone(founderMostRecent.months)}`}>
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Founder last X post</div>
                  <div className="text-[11px] font-semibold">{fmtMonths(founderMostRecent.months)}</div>
                  <div className="text-[8.5px] text-muted-foreground/70 mt-0.5 truncate">{founderMostRecent.name}</div>
                </div>
              )}
            </div>
            {dormant && (
              <div className="text-[10px] text-rose-200/90 mt-1.5 italic leading-snug">
                Otto-grade signal: position lacks recent activity. Defensible mark review recommended at next quarterly close.
              </div>
            )}
          </div>
        );
      })()}

      {/* Project intel badges */}
      {(company.rd_metadata?.transparency || company.rd_metadata?.twitter_metrics?.followers) && (
        <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
          {company.rd_metadata?.transparency && (
            <span
              title="Transparency Rating (A=highest, D=lowest). Measures how much verified information the project discloses publicly: team identities, audit reports, contract addresses, financials, tokenomics."
              className="px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/[0.06] text-amber-200 cursor-help"
            >
              transparency <span className="font-bold">{company.rd_metadata.transparency}</span>
              <Info className="w-2.5 h-2.5 inline-block ml-0.5 opacity-50" />
            </span>
          )}
          {company.rd_metadata?.twitter_metrics?.followers != null && (
            <span
              title={`Twitter/X followers: ${company.rd_metadata.twitter_metrics.followers.toLocaleString()}. Updated daily. Handle: ${company.rd_metadata.twitter_metrics.handle || company.twitter || "—"}`}
              className="px-1.5 py-0.5 rounded border border-sky-500/30 bg-sky-500/[0.06] text-sky-300 cursor-help"
            >
              𝕏 <span className="font-bold tabular-nums">{formatFollowers(company.rd_metadata.twitter_metrics.followers)}</span>
            </span>
          )}
          {company.project_active === false && (
            <span
              title="Project flagged as INACTIVE (no recent on-chain or social activity)."
              className="px-1.5 py-0.5 rounded border border-rose-500/30 bg-rose-500/[0.06] text-rose-300 uppercase tracking-wider font-bold cursor-help"
            >
              inactive
            </span>
          )}
          {company.rd_metadata?.tags?.slice(0, 4).map(t => (
            <span
              key={t}
              title={`Category tag: ${t}`}
              className="px-1.5 py-0.5 rounded bg-white/[0.03] border border-white/[0.06] text-muted-foreground"
            >{t}</span>
          ))}
          {/* RootData profile link intentionally hidden — don't link users out to the source */}
        </div>
      )}

      {/* Token info row */}
      {(company.token_symbol || company.token_launch_time || (company.on_main_net && company.on_main_net.length > 0)) && (
        <div className="rounded border border-white/[0.05] bg-white/[0.015] p-2 text-[10.5px] flex items-center gap-2 flex-wrap">
          <Coins className="w-3 h-3 text-emerald-300 flex-shrink-0" />
          {company.token_symbol && (
            <span className="text-white font-bold font-mono">{company.token_symbol}</span>
          )}
          {company.token_launch_time && (
            <span className="text-muted-foreground">launched {company.token_launch_time}</span>
          )}
          {company.on_main_net && company.on_main_net.length > 0 && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">mainnet:</span>
              {company.on_main_net.map(chain => (
                <span key={chain} className="px-1 py-0 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 text-[9.5px] uppercase tracking-wider font-bold">{chain}</span>
              ))}
            </>
          )}
          {company.on_test_net && company.on_test_net.length > 0 && (
            <>
              <span className="text-muted-foreground">testnet:</span>
              {company.on_test_net.map(chain => (
                <span key={chain} className="px-1 py-0 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[9.5px] uppercase tracking-wider font-bold">{chain}</span>
              ))}
            </>
          )}
        </div>
      )}

      {/* Exchange listings strip */}
      {company.support_exchanges && company.support_exchanges.length > 0 && (
        <Section icon={Activity} title={`Exchange listings (${company.support_exchanges.length})`}>
          <div className="flex flex-wrap gap-1.5">
            {company.support_exchanges.map((ex, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded border border-white/[0.06] bg-white/[0.02] px-1.5 py-1">
                {ex.exchange_logo ? (
                  <img src={ex.exchange_logo} alt="" className="w-4 h-4 rounded object-cover" />
                ) : (
                  <div className="w-4 h-4 rounded bg-white/[0.04] border border-white/[0.05]" />
                )}
                <span className="text-[10.5px] text-white/85">{ex.exchange_name}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Token unlocks — Otto Signal #4: Token Metrics */}
      {unlocks.length > 0 && (() => {
        const today = new Date(); today.setUTCHours(0,0,0,0);
        const upcoming = unlocks.filter(u => !u.is_past).sort((a, b) => a.unlock_date.localeCompare(b.unlock_date));
        const past = unlocks.filter(u => u.is_past).sort((a, b) => b.unlock_date.localeCompare(a.unlock_date));
        const nextUnlock = upcoming[0];
        const isImminent = nextUnlock && (new Date(nextUnlock.unlock_date).getTime() - today.getTime()) <= 7 * 86400000;
        return (
          <Section icon={Coins} title={`Token unlocks (${upcoming.length} upcoming · ${past.length} past)`}>
            {nextUnlock && (
              <div className={`rounded border p-2 mb-1.5 ${isImminent ? "border-rose-500/40 bg-rose-500/[0.08]" : "border-amber-500/30 bg-amber-500/[0.06]"}`}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[9px] uppercase tracking-wider px-1 py-0 rounded font-bold ${isImminent ? "bg-rose-500/20 text-rose-200 border border-rose-500/40" : "bg-amber-500/20 text-amber-200 border border-amber-500/40"}`}>
                    {isImminent ? "⚠ imminent" : "upcoming"}
                  </span>
                  <span className="text-[11.5px] font-semibold text-white">
                    {new Date(nextUnlock.unlock_date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                  </span>
                  {nextUnlock.amount_usd != null && (
                    <span className="text-[12px] font-bold tabular-nums text-emerald-300">
                      ${(nextUnlock.amount_usd / 1e6).toFixed(2)}M
                    </span>
                  )}
                  {nextUnlock.pct_supply_released != null && (
                    <span className="text-[10px] px-1 rounded bg-white/[0.05] text-muted-foreground">+{nextUnlock.pct_supply_released}% supply</span>
                  )}
                </div>
                <div className="text-[10.5px] text-white/80 mt-0.5">
                  {nextUnlock.allocation || "—"}
                  {nextUnlock.amount_tokens != null && (
                    <span className="text-muted-foreground"> · {(nextUnlock.amount_tokens / 1e6).toFixed(1)}M tokens</span>
                  )}
                </div>
                {nextUnlock.notes && (
                  <p className="text-[10.5px] text-rose-200/90 mt-1 leading-snug italic">{nextUnlock.notes}</p>
                )}
              </div>
            )}
            <div className="space-y-0.5">
              {[...upcoming.slice(1), ...past].map(u => (
                <div key={u.id} className="text-[10.5px] flex items-baseline gap-2 py-0.5">
                  <span className={`text-[9px] uppercase tracking-wider px-1 rounded ${u.is_past ? "text-muted-foreground bg-white/[0.04]" : "text-amber-300 bg-amber-500/15"}`}>
                    {u.unlock_type || "unlock"}
                  </span>
                  <span className="text-muted-foreground tabular-nums w-24">
                    {new Date(u.unlock_date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                  </span>
                  {u.amount_usd != null && (
                    <span className="text-white/85 tabular-nums w-20">${(u.amount_usd / 1e6).toFixed(2)}M</span>
                  )}
                  {u.pct_supply_released != null && (
                    <span className="text-muted-foreground text-[10px] tabular-nums w-16">+{u.pct_supply_released}%</span>
                  )}
                  <span className="text-muted-foreground flex-1 truncate">{u.allocation || "—"}</span>
                </div>
              ))}
            </div>
            <div className="text-[9px] text-muted-foreground/70 pt-1 mt-1 border-t border-white/[0.04]">
              Source: {unlocks[0]?.source || "—"}
            </div>
          </Section>
        );
      })()}

      {/* Holder concentration — Otto Signal #4: holder concentration changes */}
      {holderSnap && holderSnap.top_1_pct != null && (() => {
        const top1 = holderSnap.top_1_pct ?? 0;
        const concentrated = top1 >= 20 || (holderSnap.top_10_pct ?? 0) >= 50;
        return (
          <Section icon={Users} title="Holder concentration">
            <div className={`rounded border p-2 ${concentrated ? "border-rose-500/30 bg-rose-500/[0.06]" : "border-emerald-500/30 bg-emerald-500/[0.06]"}`}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className={`text-[9px] uppercase tracking-wider px-1 py-0 rounded font-bold ${concentrated ? "bg-rose-500/20 text-rose-200 border border-rose-500/40" : "bg-emerald-500/20 text-emerald-200 border border-emerald-500/40"}`}>
                  {concentrated ? "⚠ concentrated" : "diversified"}
                </span>
                <span className="text-[9.5px] text-muted-foreground">snapshot {new Date(holderSnap.snapshot_at).toLocaleDateString()}</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { label: "Top 1", pct: holderSnap.top_1_pct },
                  { label: "Top 5", pct: holderSnap.top_5_pct },
                  { label: "Top 10", pct: holderSnap.top_10_pct },
                  { label: "Top 20", pct: holderSnap.top_20_pct },
                ].map(c => (
                  <div key={c.label} className="rounded border border-white/[0.06] bg-white/[0.02] p-1.5">
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{c.label}</div>
                    <div className="text-[14px] font-bold tabular-nums text-white">{c.pct != null ? `${c.pct.toFixed(1)}%` : "—"}</div>
                  </div>
                ))}
              </div>
              {holderSnap.top_holder_address && (
                <div className="mt-1.5 text-[10.5px]">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Largest holder</div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[10px] text-white/85 truncate flex-1" title={holderSnap.top_holder_address}>{holderSnap.top_holder_address}</span>
                    {holderSnap.top_holder_balance != null && (
                      <span className="text-emerald-300 tabular-nums">{(holderSnap.top_holder_balance / 1e6).toFixed(1)}M</span>
                    )}
                  </div>
                  {holderSnap.top_holder_label && (
                    <div className="text-[10px] text-muted-foreground/90 mt-0.5">{holderSnap.top_holder_label}</div>
                  )}
                </div>
              )}
              {concentrated && (
                <div className="text-[10px] text-rose-200/90 mt-1.5 italic leading-snug">
                  Otto-grade signal: high single-holder concentration. Material for secondary-market mark — token price could move sharply if largest holder liquidates.
                </div>
              )}
              <div className="text-[9px] text-muted-foreground/70 pt-1 mt-1 border-t border-white/[0.04] font-mono">source: {holderSnap.source}</div>
            </div>
          </Section>
        );
      })()}

      {/* Liquidity depth — Otto Signal #4: "liquidity depth, exchange listings ... affects mark on token warrant & SAFT positions" */}
      {liquidity && (liquidity.total_pairs ?? 0) > 0 && (() => {
        const depth = liquidity.total_depth_up_2pct_usd ?? 0;
        const vol = liquidity.total_24h_volume_usd ?? 0;
        const thin = depth < 50_000;
        const pairs = liquidity.pairs_json ?? [];
        const fmtUsd = (n: number | null) =>
          n == null ? "—" :
          n >= 1_000_000 ? `$${(n / 1e6).toFixed(2)}M` :
          n >= 1_000 ? `$${(n / 1e3).toFixed(1)}K` :
          `$${n.toFixed(0)}`;
        return (
          <Section icon={Banknote} title={`Liquidity depth · ${liquidity.total_pairs} pairs${thin ? " · THIN" : ""}`}>
            <div className={`rounded border p-2 ${thin ? "border-amber-500/30 bg-amber-500/[0.06]" : "border-emerald-500/30 bg-emerald-500/[0.05]"}`}>
              <div className="grid grid-cols-4 gap-1.5 mb-2">
                <div className="rounded border border-white/[0.06] bg-white/[0.02] p-1.5">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">24h volume</div>
                  <div className="text-[13px] font-bold tabular-nums text-white">{fmtUsd(vol)}</div>
                </div>
                <div className={`rounded border p-1.5 ${thin ? "border-amber-500/40 bg-amber-500/[0.08]" : "border-emerald-500/40 bg-emerald-500/[0.08]"}`}>
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Depth +2%</div>
                  <div className="text-[13px] font-bold tabular-nums text-white">{fmtUsd(depth)}</div>
                </div>
                <div className={`rounded border p-1.5 ${thin ? "border-amber-500/40 bg-amber-500/[0.08]" : "border-emerald-500/40 bg-emerald-500/[0.08]"}`}>
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Depth −2%</div>
                  <div className="text-[13px] font-bold tabular-nums text-white">{fmtUsd(liquidity.total_depth_down_2pct_usd)}</div>
                </div>
                <div className="rounded border border-white/[0.06] bg-white/[0.02] p-1.5">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Spread (vw)</div>
                  <div className="text-[13px] font-bold tabular-nums text-white">{liquidity.weighted_avg_spread_pct != null ? `${liquidity.weighted_avg_spread_pct.toFixed(3)}%` : "—"}</div>
                </div>
              </div>
              {thin && (
                <div className="text-[10.5px] text-amber-200/90 italic mb-2 leading-snug">
                  Mark-defense note: aggregate depth at ±2% is below $50K. Selling a meaningful position could move the price.
                </div>
              )}
              <div className="space-y-0.5">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Top venues (24h volume)</div>
                {pairs.slice(0, 5).map((p, i) => (
                  <div key={`${p.market_id}-${p.base}-${p.target}-${i}`} className="rounded border border-white/[0.04] bg-white/[0.015] p-1.5 text-[10.5px]">
                    <div className="flex items-center gap-2">
                      <span className="text-white/90 font-semibold truncate flex-1">{p.market}</span>
                      <span className="text-muted-foreground font-mono text-[9.5px]">{p.base}/{p.target}</span>
                      {p.trade_url && (
                        <a href={p.trade_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[9.5px] text-muted-foreground tabular-nums">
                      <span>vol {fmtUsd(p.vol_24h_usd)}</span>
                      <span>depth +2% {fmtUsd(p.depth_up_2pct_usd)}</span>
                      <span>−2% {fmtUsd(p.depth_down_2pct_usd)}</span>
                      <span>spread {p.spread_pct != null ? `${p.spread_pct.toFixed(2)}%` : "—"}</span>
                    </div>
                  </div>
                ))}
              </div>
              {(liquidity.stale_pairs || liquidity.anomaly_pairs) ? (
                <div className="text-[9px] text-muted-foreground/70 mt-1.5">
                  {liquidity.stale_pairs ? `${liquidity.stale_pairs} stale` : null}
                  {liquidity.stale_pairs && liquidity.anomaly_pairs ? " · " : null}
                  {liquidity.anomaly_pairs ? `${liquidity.anomaly_pairs} anomaly` : null}
                  {" excluded from aggregates"}
                </div>
              ) : null}
              <div className="text-[9px] text-muted-foreground/70 mt-1.5 italic">
                source: coingecko · last sync {new Date(liquidity.captured_at).toLocaleString()} · refreshed daily
              </div>
            </div>
          </Section>
        );
      })()}

      {/* Audit coverage status (explicit when no audit found) */}
      {company.audit_coverage_status === "no_public_audit_found" && (
        <div className="rounded border border-amber-500/30 bg-amber-500/[0.06] p-2 text-[11.5px]">
          <div className="flex items-center gap-1.5 mb-0.5">
            <AlertTriangle className="w-3 h-3 text-amber-300" />
            <span className="text-[9.5px] uppercase tracking-wider font-semibold text-amber-300">No public audit found</span>
          </div>
          {company.audit_coverage_notes && (
            <p className="text-[10.5px] text-muted-foreground leading-snug">{company.audit_coverage_notes}</p>
          )}
        </div>
      )}

      {/* Token allocation (jsonb) */}
      {company.token_allocation && Object.keys(company.token_allocation).length > 0 && (
        <Section icon={Coins} title="Token allocation">
          <div className="space-y-1">
            {Object.entries(company.token_allocation)
              .filter(([k, v]) => k.endsWith("_pct") && typeof v === "number")
              .sort((a, b) => Number(b[1]) - Number(a[1]))
              .map(([k, v]) => {
                const label = k.replace(/_pct$/, "").replace(/_/g, " ");
                return (
                  <div key={k} className="flex items-center gap-2 text-[11.5px]">
                    <span className="w-44 truncate capitalize text-muted-foreground">{label}</span>
                    <div className="flex-1 h-1.5 bg-white/[0.05] rounded overflow-hidden">
                      <div className="h-full bg-emerald-400/40" style={{ width: `${Math.min(100, Number(v))}%` }} />
                    </div>
                    <span className="text-white tabular-nums w-12 text-right">{Number(v).toFixed(1)}%</span>
                  </div>
                );
              })}
            {typeof company.token_allocation.source === "string" && (
              <div className="text-[9.5px] text-muted-foreground/70 italic pt-1 mt-1 border-t border-white/[0.04]">
                source: {company.token_allocation.source as string}
                {typeof company.token_allocation.verified_at === "string" && ` · verified ${company.token_allocation.verified_at}`}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Live signals from protocol_metrics */}
      {latestMetric && (
        <Section icon={Activity} title="Live signals">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
            {latestMetric.circulating_supply != null && (
              <div className="rounded border border-fuchsia-500/20 bg-fuchsia-500/[0.05] p-1.5">
                <div className="text-[9px] uppercase tracking-wider text-fuchsia-300">Circulating</div>
                <div className="text-[12.5px] font-bold tabular-nums text-white">
                  {(latestMetric.circulating_supply / 1e6).toFixed(1)}M
                </div>
                {latestMetric.total_supply != null && (
                  <div className="text-[9.5px] text-muted-foreground">
                    {((latestMetric.circulating_supply / latestMetric.total_supply) * 100).toFixed(1)}% of supply
                  </div>
                )}
              </div>
            )}
            {latestMetric.price_usd != null && (
              <div className="rounded border border-sky-500/20 bg-sky-500/[0.05] p-1.5">
                <div className="text-[9px] uppercase tracking-wider text-sky-300">Price</div>
                <div className="text-[12.5px] font-bold tabular-nums text-white">${latestMetric.price_usd.toFixed(4)}</div>
                {latestMetric.ath_usd != null && (
                  <div className="text-[9.5px] text-muted-foreground">
                    ATH ${latestMetric.ath_usd.toFixed(2)}{" "}
                    <span className="text-rose-300/80">
                      ({Math.round((1 - latestMetric.price_usd / latestMetric.ath_usd) * -100)}%)
                    </span>
                  </div>
                )}
              </div>
            )}
            {latestMetric.market_cap_usd != null && (
              <div className="rounded border border-sky-500/20 bg-sky-500/[0.05] p-1.5">
                <div className="text-[9px] uppercase tracking-wider text-sky-300">Market cap</div>
                <div className="text-[12.5px] font-bold tabular-nums text-white">${(latestMetric.market_cap_usd / 1e6).toFixed(1)}M</div>
              </div>
            )}
            {latestMetric.volume_24h_usd != null && (
              <div className="rounded border border-sky-500/20 bg-sky-500/[0.05] p-1.5">
                <div className="text-[9px] uppercase tracking-wider text-sky-300">24h volume</div>
                <div className="text-[12.5px] font-bold tabular-nums text-white">${(latestMetric.volume_24h_usd / 1e6).toFixed(1)}M</div>
                {latestMetric.market_cap_usd != null && (
                  <div className="text-[9.5px] text-muted-foreground">
                    {((latestMetric.volume_24h_usd / latestMetric.market_cap_usd) * 100).toFixed(1)}% turnover
                  </div>
                )}
              </div>
            )}
            {latestMetric.exchange_pair_count != null && (
              <div className="rounded border border-sky-500/20 bg-sky-500/[0.05] p-1.5">
                <div className="text-[9px] uppercase tracking-wider text-sky-300">Exchange pairs</div>
                <div className="text-[12.5px] font-bold tabular-nums text-white">{latestMetric.exchange_pair_count}</div>
                {latestMetric.top_exchange_name && (
                  <div className="text-[9.5px] text-muted-foreground truncate" title={latestMetric.top_exchange_name}>
                    top: {latestMetric.top_exchange_name}
                  </div>
                )}
              </div>
            )}
            {latestMetric.total_staked != null && (
              <div className="rounded border border-emerald-500/20 bg-emerald-500/[0.05] p-1.5">
                <div className="text-[9px] uppercase tracking-wider text-emerald-300">Total staked</div>
                <div className="text-[12.5px] font-bold tabular-nums text-white">{(latestMetric.total_staked / 1e6).toFixed(2)}M</div>
                <div className="text-[9.5px] text-muted-foreground">staker principal · L3</div>
              </div>
            )}
            {latestMetric.staking_contract_balance != null && (
              <div className="rounded border border-emerald-500/20 bg-emerald-500/[0.05] p-1.5">
                <div className="text-[9px] uppercase tracking-wider text-emerald-300">Staking contract</div>
                <div className="text-[12.5px] font-bold tabular-nums text-white">{(latestMetric.staking_contract_balance / 1e6).toFixed(2)}M</div>
                <div className="text-[9.5px] text-muted-foreground">total holdings · L3</div>
              </div>
            )}
            {latestMetric.staking_apy_unlocked != null && (
              <div className="rounded border border-emerald-500/20 bg-emerald-500/[0.05] p-1.5">
                <div className="text-[9px] uppercase tracking-wider text-emerald-300">Base APY</div>
                <div className="text-[12.5px] font-bold tabular-nums text-white">{latestMetric.staking_apy_unlocked.toFixed(2)}%</div>
                <div className="text-[9.5px] text-muted-foreground">no lock multiplier</div>
              </div>
            )}
            {latestMetric.reward_pool_remaining != null && (
              <div className="rounded border border-emerald-500/20 bg-emerald-500/[0.05] p-1.5">
                <div className="text-[9px] uppercase tracking-wider text-emerald-300">Reward pool</div>
                <div className="text-[12.5px] font-bold tabular-nums text-white">{(latestMetric.reward_pool_remaining / 1e6).toFixed(2)}M</div>
                <div className="text-[9.5px] text-muted-foreground">remaining · L3</div>
              </div>
            )}
            {latestMetric.reward_per_second != null && (
              <div className="rounded border border-emerald-500/20 bg-emerald-500/[0.05] p-1.5">
                <div className="text-[9px] uppercase tracking-wider text-emerald-300">Emission rate</div>
                <div className="text-[12.5px] font-bold tabular-nums text-white">{latestMetric.reward_per_second.toFixed(4)}</div>
                <div className="text-[9.5px] text-muted-foreground">L3 / sec</div>
              </div>
            )}
            {latestMetric.staking_period_finish != null && (
              <div className="rounded border border-emerald-500/20 bg-emerald-500/[0.05] p-1.5">
                <div className="text-[9px] uppercase tracking-wider text-emerald-300">Rewards end</div>
                <div className="text-[12.5px] font-bold tabular-nums text-white">
                  {new Date(latestMetric.staking_period_finish * 1000).toISOString().slice(0, 10)}
                </div>
                <div className="text-[9.5px] text-muted-foreground">period finish</div>
              </div>
            )}
            {latestMetric.reward_pool_runway_years != null && (
              <div className="rounded border border-cyan-500/30 bg-cyan-500/[0.07] p-1.5">
                <div className="text-[9px] uppercase tracking-wider text-cyan-300">Reward runway</div>
                <div className="text-[12.5px] font-bold tabular-nums text-white">{latestMetric.reward_pool_runway_years.toFixed(2)} yr</div>
                <div className="text-[9.5px] text-muted-foreground">computed · pool ÷ emission</div>
              </div>
            )}
            {latestMetric.github_commits_90d != null && (
              <div className={`rounded border p-1.5 ${
                latestMetric.github_commits_90d > 20 ? "border-emerald-500/20 bg-emerald-500/[0.05]" :
                latestMetric.github_commits_90d > 5 ? "border-amber-500/20 bg-amber-500/[0.05]" :
                "border-rose-500/20 bg-rose-500/[0.05]"
              }`}>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Dev activity (90d)</div>
                <div className="text-[12.5px] font-bold tabular-nums text-white">{latestMetric.github_commits_90d} commits</div>
                <div className="text-[9.5px] text-muted-foreground">
                  {latestMetric.github_active_repos != null && `${latestMetric.github_active_repos} active repo${latestMetric.github_active_repos === 1 ? "" : "s"}`}
                  {latestMetric.github_last_commit_at && ` · last ${new Date(latestMetric.github_last_commit_at).toISOString().slice(0, 10)}`}
                </div>
              </div>
            )}
            {latestMetric.staking_apy_locked_max != null && (
              <div className="rounded border border-emerald-500/20 bg-emerald-500/[0.05] p-1.5">
                <div className="text-[9px] uppercase tracking-wider text-emerald-300">Stake APY (max locked)</div>
                <div className="text-[12.5px] font-bold tabular-nums text-white">{latestMetric.staking_apy_locked_max.toFixed(2)}%</div>
              </div>
            )}
            {latestMetric.tvl_usd != null && (
              <div className="rounded border border-sky-500/20 bg-sky-500/[0.05] p-1.5">
                <div className="text-[9px] uppercase tracking-wider text-sky-300">TVL</div>
                <div className="text-[12.5px] font-bold tabular-nums text-white">${(latestMetric.tvl_usd / 1e6).toFixed(1)}M</div>
              </div>
            )}
            {latestMetric.holder_count != null && (
              <div className="rounded border border-white/[0.05] bg-white/[0.02] p-1.5">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Holders</div>
                <div className="text-[12.5px] font-bold tabular-nums text-white">{latestMetric.holder_count.toLocaleString()}</div>
              </div>
            )}
            {latestMetric.foundation_treasury_balance != null && (
              <div className="rounded border border-violet-500/20 bg-violet-500/[0.05] p-1.5">
                <div className="text-[9px] uppercase tracking-wider text-violet-300">Treasury balance</div>
                <div className="text-[12.5px] font-bold tabular-nums text-white">
                  {(latestMetric.foundation_treasury_balance / 1e6).toFixed(2)}M
                </div>
                <div className="text-[9.5px] text-muted-foreground">on-chain · L3</div>
              </div>
            )}
            {latestMetric.coinbase_balance != null && (
              <div className="rounded border border-amber-500/20 bg-amber-500/[0.05] p-1.5">
                <div className="text-[9px] uppercase tracking-wider text-amber-300">On Coinbase</div>
                <div className="text-[12.5px] font-bold tabular-nums text-white">
                  {(latestMetric.coinbase_balance / 1e6).toFixed(2)}M
                </div>
                <div className="text-[9.5px] text-muted-foreground">exchange custody · L3</div>
              </div>
            )}
          </div>
          <div className="text-[9.5px] text-muted-foreground mt-1.5">
            Snapshot: {new Date(latestMetric.snapshot_at).toLocaleString()}
            {latestMetric.source && ` · ${latestMetric.source}`}
            {metrics.length > 1 && ` · ${metrics.length} snapshots in history`}
          </div>
        </Section>
      )}

      {/* Contracts */}
      {contracts.length > 0 && (
        <Section icon={Coins} title="Token contracts">
          <div className="space-y-1">
            {contracts.map((ct, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span className="text-[9.5px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.04] text-muted-foreground border border-white/[0.05] w-20 text-center">{ct.chain}</span>
                {ct.explorer_url ? (
                  <a href={ct.explorer_url} target="_blank" rel="noreferrer" className="font-mono text-primary hover:underline truncate flex-1 inline-flex items-center gap-1" title={ct.address}>
                    {ct.address}
                    <ExternalLink className="w-2.5 h-2.5 flex-shrink-0 opacity-60" />
                  </a>
                ) : (
                  <span className="font-mono text-white/85 truncate flex-1" title={ct.address}>{ct.address}</span>
                )}
                {ct.label && <span className="text-muted-foreground text-[10.5px] truncate">{ct.label}</span>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Audits */}
      {audits.length > 0 && (
        <Section icon={Shield} title="Audits">
          <div className="space-y-2">
            {audits.map(a => {
              const sevTotal = (a.findings_critical || 0) + (a.findings_high || 0) + (a.findings_medium || 0) + (a.findings_low || 0);
              const linked = auditContracts.filter(ac => ac.audit_id === a.id);
              return (
                <div key={a.id} className="rounded border border-white/[0.05] bg-white/[0.015] p-2 text-[11.5px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-medium">{a.audit_firm || "—"}</span>
                    {a.audit_date && <span className="text-muted-foreground">· {a.audit_date}</span>}
                    {a.audit_type && <span className="text-[10px] px-1 py-0 rounded bg-white/[0.04] text-muted-foreground border border-white/[0.05]">{a.audit_type}</span>}
                    {a.report_url && <a href={a.report_url} target="_blank" rel="noreferrer" className="ml-auto text-primary hover:underline inline-flex items-center gap-0.5 text-[10.5px]">PDF <ExternalLink className="w-2.5 h-2.5" /></a>}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[10.5px]">
                    {(a.findings_critical || 0) > 0 && <SevBadge level="critical" n={a.findings_critical!} />}
                    {(a.findings_high || 0) > 0 && <SevBadge level="high" n={a.findings_high!} />}
                    {(a.findings_medium || 0) > 0 && <SevBadge level="medium" n={a.findings_medium!} />}
                    {(a.findings_low || 0) > 0 && <SevBadge level="low" n={a.findings_low!} />}
                    {sevTotal === 0 && <span className="text-emerald-300/80 text-[10px]">no findings</span>}
                  </div>
                  {a.ai_summary && <p className="text-[10.5px] text-muted-foreground mt-1 line-clamp-2">{a.ai_summary}</p>}
                  {linked.length > 0 && (
                    <div className="mt-1.5 pt-1.5 border-t border-white/[0.04]">
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">
                        Audited contract{linked.length > 1 ? "s" : ""} ({linked.length})
                      </div>
                      <div className="space-y-0.5">
                        {linked.map((ac, i) => {
                          const ct = contractsById.get(ac.contract_id);
                          if (!ct) return null;
                          return (
                            <div key={i} className="flex items-center gap-1.5 text-[10px]">
                              <span className="text-[9px] uppercase tracking-wider px-1 py-0 rounded bg-white/[0.04] text-muted-foreground border border-white/[0.05] w-16 text-center">{ct.chain}</span>
                              {ct.explorer_url ? (
                                <a href={ct.explorer_url} target="_blank" rel="noreferrer" className="font-mono text-primary hover:underline truncate flex-1 inline-flex items-center gap-1" title={ct.address}>
                                  {ct.address}
                                  <ExternalLink className="w-2.5 h-2.5 flex-shrink-0 opacity-60" />
                                </a>
                              ) : (
                                <span className="font-mono text-white/85 truncate flex-1" title={ct.address}>{ct.address}</span>
                              )}
                              {ac.confidence === "inferred" && <span className="text-[8.5px] uppercase tracking-wider text-amber-300/80 italic">inferred</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Findings detail */}
      {findings.length > 0 && (
        <Section icon={AlertTriangle} title={`Findings detail (${findings.length})`}>
          <div className="space-y-1.5">
            {findings.map((f, i) => (
              <div key={i} className="rounded border border-white/[0.05] bg-white/[0.015] p-2 text-[11px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <SevBadge level={f.severity} />
                  <span className="text-white/90 flex-1 line-clamp-1 font-medium">{f.title}</span>
                  {f.status && <span className="text-[10px] text-muted-foreground italic">{f.status}</span>}
                </div>
                {f.summary && <p className="text-[10.5px] text-muted-foreground mt-1 line-clamp-2">{f.summary}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Funding */}
      {rounds.length > 0 && (
        <Section icon={Banknote} title={`Funding rounds (${rounds.length})`}>
          <div className="space-y-2.5">
            {rounds.map((r) => (
              <RoundCard key={r.id} round={r} investors={roundInvestors.filter(ri => ri.round_id === r.id)} />
            ))}
            <div className="text-[9.5px] text-muted-foreground/70 pt-1 border-t border-white/[0.04]">
              Total raised across {rounds.length} round{rounds.length !== 1 ? "s" : ""}: ${rounds.reduce((s, r) => s + (r.amount_usd || 0), 0).toLocaleString()}
            </div>
          </div>
        </Section>
      )}

      {/* Comparable transactions — Otto Cat 7: "benchmarks for mark-to-model when no direct pricing data exists" */}
      {(comparables.length > 0 || (company.rd_metadata?.similar_projects?.length ?? 0) > 0) && (
        <Section icon={Beaker} title={`Comparable transactions${comparables.length > 0 ? ` · ${comparables.length} recent ${company.category} rounds` : ""}`} defaultOpen={false}>
          {rounds.length === 0 && comparables.length > 0 && (
            <div className="text-[10.5px] text-muted-foreground italic mb-2">
              This position has no public funding round on record. Comps below are benchmark rounds in the same category for mark-to-model reference.
            </div>
          )}
          {comparables.length > 0 && (
            <div className="space-y-1 mb-2">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                Same-category rounds, last 18 months · drawn from AuditScope corpus (3,593 rounds across 10,389 companies)
              </div>
              {comparables.map(c => {
                const amt = c.amount_usd
                  ? c.amount_usd >= 1_000_000 ? `$${(c.amount_usd / 1e6).toFixed(1)}M`
                  : c.amount_usd >= 1_000 ? `$${(c.amount_usd / 1e3).toFixed(0)}K`
                  : `$${c.amount_usd.toFixed(0)}`
                  : "—";
                return (
                  <div key={`${c.company_slug}-${c.date}-${c.round_type}`} className="rounded border border-white/[0.05] bg-white/[0.015] p-1.5 text-[10.5px]">
                    <div className="flex items-center gap-2">
                      {c.company_logo
                        ? <img src={c.company_logo} alt="" className="w-5 h-5 rounded object-cover flex-shrink-0" />
                        : <div className="w-5 h-5 rounded bg-white/[0.04] flex-shrink-0" />}
                      <span className="text-white/95 font-semibold truncate flex-1">{c.company_name}</span>
                      {c.round_type && <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-white/[0.04] text-muted-foreground border border-white/[0.05]">{c.round_type}</span>}
                      <span className="text-white tabular-nums font-mono text-[10.5px]">{amt}</span>
                      <span className="text-[9.5px] text-muted-foreground/80 tabular-nums w-20 text-right">{c.date ?? ""}</span>
                      {c.announcement_url && (
                        <a href={c.announcement_url} target="_blank" rel="noreferrer" className="text-primary hover:underline flex-shrink-0">
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                    {c.lead_investors && (
                      <div className="text-[9.5px] text-muted-foreground/80 mt-0.5 truncate pl-7">led by {c.lead_investors}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {company.rd_metadata?.similar_projects && company.rd_metadata.similar_projects.length > 0 && (
            <>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Similar protocols</div>
              <div className="grid grid-cols-2 gap-1.5">
                {company.rd_metadata.similar_projects.slice(0, 8).map(p => (
                  <div key={p.id} className="flex items-center gap-2 rounded border border-white/[0.06] bg-white/[0.02] p-1.5">
                    {p.logo ? <img src={p.logo} alt="" className="w-6 h-6 rounded object-cover" /> : <div className="w-6 h-6 rounded bg-white/[0.04]" />}
                    <span className="text-[10.5px] text-white/90 truncate">{p.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>
      )}

      {/* Team */}
      {team.length > 0 && (
        <Section icon={Users} title={`Team (${team.filter(t => t.is_current).length} active${team.some(t => !t.is_current) ? ` · ${team.filter(t => !t.is_current).length} departed` : ""})`}>
          <div className="space-y-1.5">
            {team.map(m => (
              <div key={m.id} className={`rounded border p-2 ${m.is_current ? "border-white/[0.05] bg-white/[0.015]" : "border-rose-500/20 bg-rose-500/[0.04]"}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11.5px] font-semibold text-white">{m.full_name}</span>
                  {m.is_founder && <span className="text-[9px] uppercase tracking-wider px-1 py-0 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">founder</span>}
                  {!m.is_current && <span className="text-[9px] uppercase tracking-wider px-1 py-0 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">departed</span>}
                  {!m.verified_at && (
                    <span
                      title={`Entity link not independently verified. Source: ${m.source || "—"}`}
                      className="text-[9px] uppercase tracking-wider px-1 py-0 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 cursor-help"
                    >⚠ unverified</span>
                  )}
                  {m.ownership_pct_low != null && m.ownership_pct_high != null && (
                    <span
                      title={`UK Companies House PSC (Persons with Significant Control) disclosure: this person owns between ${m.ownership_pct_low}% and ${m.ownership_pct_high}% of shares + voting rights. PSC is a legally-required UK disclosure for any beneficial owner of >25%.${m.psc_notified_on ? ` Notified on ${m.psc_notified_on}.` : ""}`}
                      className="text-[9.5px] px-1 py-0 rounded bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30 font-bold tabular-nums cursor-help inline-flex items-center gap-0.5"
                    >
                      {m.ownership_pct_low}–{m.ownership_pct_high}% PSC
                      <Info className="w-2.5 h-2.5 opacity-60" />
                    </span>
                  )}
                  <span className="text-[10.5px] text-muted-foreground">· {m.role}</span>
                  <div className="ml-auto flex gap-1">
                    {m.linkedin_url && <a href={m.linkedin_url} target="_blank" rel="noreferrer" className="text-[10px] text-primary hover:underline">LinkedIn</a>}
                    {m.twitter_url && <a href={m.twitter_url} target="_blank" rel="noreferrer" className="text-[10px] text-primary hover:underline">𝕏</a>}
                  </div>
                </div>
                {m.bio && <p className="text-[10.5px] text-muted-foreground mt-1 leading-snug">{m.bio}</p>}
                {m.prior_companies && m.prior_companies.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.prior_companies.map((p, i) => (
                      <span key={i} className="text-[9.5px] px-1 py-0 rounded bg-white/[0.04] border border-white/[0.05] text-muted-foreground">ex-{p}</span>
                    ))}
                  </div>
                )}
                {(m.joined_at || m.source_url) && (
                  <div className="text-[9px] text-muted-foreground/70 mt-1 font-mono">
                    {m.joined_at ? `joined ${m.joined_at}` : ""}
                    {m.joined_at && m.source_url ? " · " : ""}
                    {m.source_url && <a href={m.source_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">verified</a>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Legal entities */}
      {legalEntities.length > 0 && (
        <Section icon={Shield} title={`Legal entities (${legalEntities.length})`}>
          <div className="space-y-1">
            {legalEntities.map(e => (
              <div key={e.id} className="rounded border border-white/[0.05] bg-white/[0.015] p-2 text-[11px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[10.5px] text-white">{e.registry_id}</span>
                  <span className="text-white/90">{e.legal_name}</span>
                  {e.is_primary && <span className="text-[9px] uppercase tracking-wider px-1 py-0 rounded bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30">primary</span>}
                  <span className={`text-[9.5px] px-1 py-0 rounded border ${e.status === "active" ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" : "bg-white/[0.04] text-muted-foreground border-white/[0.05]"}`}>{e.status || "unknown"}</span>
                  {e.source_url && <a href={e.source_url} target="_blank" rel="noreferrer" className="ml-auto text-[10px] text-primary hover:underline inline-flex items-center gap-0.5">{e.registry}<ExternalLink className="w-2.5 h-2.5" /></a>}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {e.jurisdiction} · incorporated {e.incorporated_on || "—"}{e.registered_address ? ` · ${e.registered_address}` : ""}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Community signals (Discord/Telegram/Reddit live counts) */}
      {(commHandles.length > 0 || commMetrics.length > 0) && (
        <Section icon={Users} title={`Community`}>
          <div className="grid grid-cols-2 gap-1.5">
            {(() => {
              // Build per-platform latest snapshot
              const latest = new Map<string, CommunityMetric>();
              for (const m of commMetrics) {
                if (!latest.has(m.platform)) latest.set(m.platform, m);
              }
              const platforms: Array<{ key: string; icon: string; color: string }> = [
                { key: "discord", icon: "🟦", color: "border-indigo-500/30 bg-indigo-500/[0.06]" },
                { key: "telegram", icon: "✈️", color: "border-sky-500/30 bg-sky-500/[0.06]" },
                { key: "reddit", icon: "🟠", color: "border-orange-500/30 bg-orange-500/[0.06]" },
                { key: "twitter", icon: "𝕏", color: "border-white/[0.06] bg-white/[0.02]" },
                { key: "x", icon: "𝕏", color: "border-white/[0.06] bg-white/[0.02]" },
              ];
              return platforms.flatMap(({ key, icon, color }) => {
                const m = latest.get(key);
                const h = commHandles.find(x => x.platform === key);
                if (!m && !h) return [];
                const link = h?.invite_url || h?.channel_url;
                const members = m?.members_total;
                if (members === 0) return [];
                return [
                  <div key={key} className={`rounded border p-2 text-[10.5px] ${color}`}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[12px]">{icon}</span>
                      <span className="uppercase tracking-wider text-[9px] font-semibold opacity-80">{key}</span>
                      {link && (
                        <a href={link} target="_blank" rel="noreferrer" className="ml-auto text-primary hover:underline inline-flex items-center text-[9.5px]">
                          {h?.handle?.slice(0, 14) || "open"} <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
                        </a>
                      )}
                    </div>
                    <div className="flex items-baseline gap-2">
                      {members != null && (
                        <span className="text-[14px] font-bold tabular-nums text-white">{formatFollowers(members)}</span>
                      )}
                      <span className="text-[9.5px] text-muted-foreground">members</span>
                    </div>
                    {m?.members_online != null && (
                      <div className="text-[9.5px] text-emerald-300 mt-0.5">
                        🟢 {m.members_online.toLocaleString()} online now
                      </div>
                    )}
                  </div>
                ];
              });
            })()}
            {commHandles.length === 0 && (
              <div className="col-span-2 text-[10.5px] text-muted-foreground italic">
                No community handles found yet. (Auto-refresh runs daily — will populate when discovered.)
              </div>
            )}
          </div>
          {commMetrics.length > 0 && (
            <div className="text-[9px] text-muted-foreground/70 mt-1.5 italic">
              Last snapshot: {new Date(commMetrics[0].snapshot_at).toLocaleString()}. Refreshed daily.
            </div>
          )}
        </Section>
      )}

      {/* Governance — Snapshot.org DAO signals */}
      {govSnap && (() => {
        const lastAt = govSnap.last_proposal_at ? new Date(govSnap.last_proposal_at) : null;
        const monthsSince = lastAt ? Math.floor((Date.now() - lastAt.getTime()) / (1000 * 60 * 60 * 24 * 30)) : null;
        const dormant = govSnap.proposals_count === 0 || (monthsSince !== null && monthsSince >= 12);
        const recentClosed = govProposals.filter(p => p.state === "closed" && p.votes != null && p.votes > 0).slice(0, 4);
        const avgVotes = recentClosed.length
          ? Math.round(recentClosed.reduce((s, p) => s + (p.votes || 0), 0) / recentClosed.length)
          : null;
        return (
          <Section icon={Vote} title={`Governance · ${govSnap.proposals_count ?? 0} proposals${dormant ? " · DORMANT" : ""}`}>
            <div className="grid grid-cols-4 gap-1.5 mb-2">
              <div className="rounded border border-white/[0.05] bg-white/[0.02] p-2">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Proposals</div>
                <div className="text-[14px] font-bold tabular-nums text-white">{govSnap.proposals_count ?? 0}</div>
              </div>
              <div className="rounded border border-white/[0.05] bg-white/[0.02] p-2">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Followers</div>
                <div className="text-[14px] font-bold tabular-nums text-white">{govSnap.followers_count ?? 0}</div>
              </div>
              <div className={`rounded border p-2 ${(govSnap.active_proposals_count ?? 0) > 0 ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "border-white/[0.05] bg-white/[0.02]"}`}>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Active now</div>
                <div className="text-[14px] font-bold tabular-nums text-white">{govSnap.active_proposals_count ?? 0}</div>
              </div>
              <div className="rounded border border-white/[0.05] bg-white/[0.02] p-2">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Avg voters</div>
                <div className="text-[14px] font-bold tabular-nums text-white">{avgVotes ?? "—"}</div>
              </div>
            </div>
            {govSnap.proposals_count === 0 ? (
              <div className="rounded border border-amber-500/30 bg-amber-500/[0.06] p-2 text-[11px] text-amber-200">
                Space exists ({govSnap.space_id}) with {govSnap.followers_count} followers but <span className="font-semibold">zero proposals ever filed</span>. Governance infrastructure is unused.
              </div>
            ) : dormant && monthsSince !== null ? (
              <div className="rounded border border-amber-500/30 bg-amber-500/[0.06] p-2 text-[11px] text-amber-200">
                Last proposal closed {monthsSince} months ago. DAO has been inactive.
              </div>
            ) : null}
            {govProposals.length > 0 && (
              <div className="space-y-1 mt-2">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Recent proposals</div>
                {govProposals.slice(0, 5).map(p => (
                  <a key={p.proposal_id} href={p.link || "#"} target="_blank" rel="noreferrer"
                    className="block rounded border border-white/[0.04] bg-white/[0.015] hover:bg-white/[0.04] p-1.5 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded ${
                        p.state === "active" ? "bg-emerald-500/20 text-emerald-300"
                        : p.state === "closed" ? "bg-white/[0.05] text-muted-foreground"
                        : "bg-amber-500/20 text-amber-300"
                      }`}>{p.state}</span>
                      <span className="flex-1 truncate text-white/90">{p.title || p.proposal_id.slice(0, 12)}</span>
                      <span className="text-[10px] tabular-nums text-muted-foreground">{p.votes ?? 0} votes</span>
                      {p.end_at && <span className="text-[10px] tabular-nums text-muted-foreground/70 w-20 text-right">{p.end_at.slice(0, 10)}</span>}
                    </div>
                  </a>
                ))}
              </div>
            )}
            <div className="text-[9px] text-muted-foreground/70 mt-1.5 italic">
              <a href={`https://snapshot.org/#/${govSnap.space_id}`} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-0.5">
                snapshot.org/#/{govSnap.space_id} <ExternalLink className="w-2.5 h-2.5" />
              </a>
              {" · "}Last sync: {new Date(govSnap.captured_at).toLocaleString()} · Refreshed daily.
            </div>
          </Section>
        );
      })()}

      {/* News / material events */}
      {news.length > 0 && (
        <Section icon={Activity} title={`News & events (${news.length})`}>
          <div className="space-y-1">
            {news.map(n => (
              <div key={n.id} className="rounded border border-white/[0.05] bg-white/[0.015] p-2 text-[11px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] tabular-nums text-muted-foreground w-20">{n.published_at ? n.published_at.slice(0,10) : "—"}</span>
                  <a href={n.url} target="_blank" rel="noreferrer" className="flex-1 text-white/95 hover:text-primary hover:underline inline-flex items-center gap-1">
                    {n.title}
                    <ExternalLink className="w-2.5 h-2.5 opacity-60 flex-shrink-0" />
                  </a>
                </div>
                {n.summary && <p className="text-[10.5px] text-muted-foreground mt-1 leading-snug">{n.summary}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Empty states */}
      {contracts.length === 0 && audits.length === 0 && rounds.length === 0 && team.length === 0 && legalEntities.length === 0 && news.length === 0 && (
        <div className="text-[11px] text-muted-foreground italic py-2">No data yet for this position.</div>
      )}

      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground/60 pt-1 border-t border-white/[0.03] font-mono">
        <span>{company.data_source || "—"}</span>
        {company.last_refreshed_at && (
          <span title={`Auto-refreshed via daily cron. Last run: ${company.last_refreshed_at}`}>
            🟢 auto-refresh · {new Date(company.last_refreshed_at).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children, defaultOpen = false }: { icon: React.ComponentType<any>; title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 mb-1.5 hover:text-white text-muted-foreground transition-colors"
      >
        <Icon className="w-3 h-3" />
        <h4 className="text-[10px] uppercase tracking-[0.1em] font-semibold">{title}</h4>
        <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && children}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/[0.05] bg-white/[0.02] p-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-[13px] font-bold tabular-nums text-white">{value}</div>
    </div>
  );
}

function SevBadge({ level, n }: { level: string; n?: number }) {
  const cls =
    level === "critical" ? "bg-rose-600/20 text-rose-200 border-rose-500/40" :
    level === "high"     ? "bg-rose-500/15 text-rose-300 border-rose-500/30" :
    level === "medium"   ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
    level === "low"      ? "bg-sky-500/15 text-sky-300 border-sky-500/30" :
                           "bg-white/[0.05] text-muted-foreground border-white/[0.06]";
  return <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-md border ${cls}`}>{level}{n != null ? ` ${n}` : ""}</span>;
}

/**
 * Derive a structured investor list for a round. Prefers the junction table
 * (funding_round_investors) when populated; falls back to splitting the legacy
 * lead_investors / other_investors text columns so the UI is robust either way.
 */
function deriveInvestors(round: Round, junction: RoundInvestor[]): RoundInvestor[] {
  if (junction.length > 0) return junction;
  const parse = (s: string | null) =>
    (s || "").split(/[,;]/).map(x => x.trim()).filter(Boolean);
  const leads = parse(round.lead_investors).map((name, i): RoundInvestor => ({
    id: `lead-${round.id}-${i}`,
    round_id: round.id,
    investor_name: name,
    investor_slug: null,
    role: "lead",
    check_size_usd: null,
    logo_url: null,
    investor_url: null,
    investor_twitter: null,
    notes: null,
  }));
  const otherSrc = round.other_investors || (round.all_investors && round.lead_investors
    ? round.all_investors.replace(round.lead_investors, "")
    : round.all_investors) || "";
  const others = parse(otherSrc)
    .filter(n => !leads.some(l => l.investor_name.toLowerCase() === n.toLowerCase()))
    .map((name, i): RoundInvestor => ({
      id: `other-${round.id}-${i}`,
      round_id: round.id,
      investor_name: name,
      investor_slug: null,
      role: "participant",
      check_size_usd: null,
      logo_url: null,
      investor_url: null,
      investor_twitter: null,
      notes: null,
    }));
  return [...leads, ...others];
}

function formatFollowers(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function formatAmount(usd: number | null | undefined): string {
  if (usd == null) return "—";
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(usd >= 10e6 ? 0 : 1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
  return `$${usd.toFixed(0)}`;
}

function formatRoundDate(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch { return d; }
}

function InvestorChip({ inv }: { inv: RoundInvestor }) {
  const isLead = inv.role === "lead" || inv.role === "co-lead";
  const initials = inv.investor_name
    .split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase().slice(0, 2);
  const href = inv.investor_url
    || (inv.investor_twitter ? (inv.investor_twitter.startsWith("http") ? inv.investor_twitter : `https://x.com/${inv.investor_twitter.replace(/^@/, "")}`) : null);
  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors p-2 flex items-center gap-2 min-w-0">
      {inv.logo_url ? (
        <img src={inv.logo_url} alt="" className="w-7 h-7 rounded object-cover border border-white/[0.05] flex-shrink-0" />
      ) : (
        <div className="w-7 h-7 rounded bg-white/[0.04] border border-white/[0.05] flex items-center justify-center text-[9.5px] font-bold text-muted-foreground flex-shrink-0">
          {initials || "?"}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-white truncate" title={inv.investor_name}>{inv.investor_name}</div>
        <div className={`text-[9.5px] ${isLead ? "text-emerald-300" : "text-muted-foreground"} capitalize`}>
          {inv.role === "lead" ? "Lead" : inv.role === "co-lead" ? "Co-lead" : inv.role === "angel" ? "Angel" : inv.role === "strategic" ? "Strategic" : "Participant"}
        </div>
      </div>
      {href && (
        <a href={href} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary flex-shrink-0">
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

function RoundCard({ round, investors }: { round: Round; investors: RoundInvestor[] }) {
  const all = deriveInvestors(round, investors);
  const leads = all.filter(i => i.role === "lead" || i.role === "co-lead");
  const rest  = all.filter(i => !(i.role === "lead" || i.role === "co-lead"));
  const sorted = [...leads, ...rest];

  return (
    <div className="rounded border border-white/[0.06] bg-white/[0.02] p-2.5">
      {/* Header row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11.5px] font-semibold text-white">{round.round_type || "Round"}</span>
        <span className="text-[11.5px] tabular-nums font-bold text-emerald-300">{formatAmount(round.amount_usd)}</span>
        <span className="text-[10.5px] text-muted-foreground">· {formatRoundDate(round.date)}</span>
        {round.valuation_usd != null && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] text-muted-foreground">
            {round.valuation_type === "fdv" ? "FDV" : round.valuation_type === "pre-money" ? "Pre" : "Post"} {formatAmount(round.valuation_usd)}
          </span>
        )}
        {round.security_type && (
          <span className="text-[9.5px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.03] border border-white/[0.05] text-muted-foreground">
            {round.security_type}
          </span>
        )}
        {round.token_warrant && (
          <span className="text-[9.5px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-fuchsia-500/10 border border-fuchsia-500/30 text-fuchsia-300">
            Token warrant
          </span>
        )}
        {round.announcement_url && (
          <a href={round.announcement_url} target="_blank" rel="noreferrer" className="ml-auto text-primary hover:underline inline-flex items-center gap-0.5 text-[10.5px]">
            Announcement <ExternalLink className="w-2.5 h-2.5" />
          </a>
        )}
      </div>

      {/* Summary */}
      {round.announcement_summary && (
        <p className="text-[10.5px] text-muted-foreground mt-1.5 leading-snug">{round.announcement_summary}</p>
      )}

      {/* Use of proceeds */}
      {round.use_of_proceeds && (
        <div className="mt-1.5 text-[10.5px]">
          <span className="text-muted-foreground">Use of proceeds: </span>
          <span className="text-white/80">{round.use_of_proceeds}</span>
        </div>
      )}

      {/* Founder quote */}
      {round.founder_quote && (
        <blockquote className="mt-2 border-l-2 border-fuchsia-500/40 pl-2 text-[10.5px] italic text-white/80">
          "{round.founder_quote}"
          {round.founder_quote_source && <span className="block not-italic text-[9.5px] text-muted-foreground mt-0.5">— {round.founder_quote_source}</span>}
        </blockquote>
      )}

      {/* Investor grid */}
      {sorted.length > 0 && (
        <div className="mt-2 pt-2 border-t border-white/[0.04]">
          <div className="flex items-center gap-1.5 mb-1.5">
            <h5 className="text-[9.5px] uppercase tracking-[0.1em] font-semibold text-muted-foreground">
              Investors
            </h5>
            <span className="text-[9.5px] px-1.5 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-muted-foreground tabular-nums">
              {sorted.length}
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-1.5">
            {sorted.map((inv) => <InvestorChip key={inv.id} inv={inv} />)}
          </div>
        </div>
      )}

      {/* Press coverage */}
      {round.press_coverage && round.press_coverage.length > 0 && (
        <div className="mt-2 pt-1.5 border-t border-white/[0.04]">
          <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground mb-1">Press coverage</div>
          <div className="flex flex-wrap gap-1.5">
            {round.press_coverage.map((p, i) => (
              <a key={i} href={p.url} target="_blank" rel="noreferrer"
                 className="text-[10px] px-1.5 py-0.5 rounded border border-white/[0.06] bg-white/[0.02] text-primary hover:underline inline-flex items-center gap-0.5">
                {p.source || new URL(p.url).hostname} <ExternalLink className="w-2.5 h-2.5" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Provenance footer */}
      {(round.verified_at || round.verification_method) && (
        <div className="mt-1.5 pt-1.5 border-t border-white/[0.03] text-[9px] text-muted-foreground/70 font-mono">
          verified {round.verified_at ? new Date(round.verified_at).toLocaleDateString() : "—"} via {round.verification_method || "—"}
        </div>
      )}
    </div>
  );
}

function ConfigMissing() {
  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Beaker className="w-5 h-5 text-fuchsia-300" />
        <h1 className="text-xl font-semibold text-white">STOVER</h1>
      </div>
      <div className="as-card p-4 border-amber-500/30 bg-amber-500/[0.04] text-[12.5px] text-amber-100/90">
        <div className="font-semibold mb-2">Not configured yet.</div>
        <div className="space-y-2 text-amber-100/80">
          <p>Add these two lines to your <code className="font-mono bg-black/30 px-1 rounded">.env</code> file, then restart <code className="font-mono bg-black/30 px-1 rounded">npm run dev</code>:</p>
          <pre className="font-mono text-[11px] bg-black/40 rounded p-2 overflow-x-auto">
{`VITE_STOVER_SUPABASE_URL=https://anhfsuiacapcxwtbuuav.supabase.co
VITE_STOVER_SUPABASE_ANON_KEY=<the anon key from Settings → API → Legacy>`}
          </pre>
          <p>The <strong>anon</strong> key (not the service_role one) is what frontends use. It's safe to expose — RLS keeps it read-only.</p>
        </div>
      </div>
    </div>
  );
}
