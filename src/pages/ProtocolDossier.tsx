import { useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ShieldCheck, AlertTriangle, Activity, Banknote, Briefcase,
  TrendingUp, Boxes, Bug, Skull, ExternalLink, Globe, Twitter, Github,
  Wallet, Layers, Sparkles, RefreshCw, Vote, Tag, Pencil, Trash2, Pin, Plus,
  Bell, Send, Eye, GitCompare, ChevronDown, Users,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";
import { AuditTypeBadge } from "@/components/AuditTypeBadge";
import { useAuth } from "@/hooks/useAuth";
import { HexagonScore } from "@/components/HexagonScore";
import { computeProtocolAxes, computeSalesAxes, scoreToTone } from "@/lib/hexagonScores";
import { explorerUrl, explorerName } from "@/lib/blockExplorers";
import { fetchLiveTvl } from "@/lib/liveTvl";

type DossierTab = "pulse" | "security" | "fundamentals" | "operational" | "ai_brief";

function compactUsd(n: number | null | undefined): string {
  if (n == null || n <= 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}
function daysAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400000);
  if (d < 1) return "today";
  if (d === 1) return "1d";
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}

type Risk = {
  composite_score: number; band: string;
  sub_audit: number; sub_onchain: number; sub_activity: number; sub_team: number; sub_funding: number;
  drivers: Array<{ dimension: string; factor: string; severity: number; evidence_url?: string; good?: boolean }>;
  data_points: Record<string, any>;
  coverage_pct: number;
};

export default function ProtocolDossier() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();

  // Parallel fetch of every signal we have
  const company = useQuery({
    queryKey: ["dossier-company", slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data } = await supabase
        .from("companies")
        .select("slug,name,category,description,url,twitter,github,logo,last_audit_firm,last_audit_date,has_been_hacked,has_bug_bounty,total_raised_usd,audit_count,unique_auditor_count")
        .eq("slug", slug!)
        .maybeSingle();
      return data as any;
    },
  });

  const risk = useQuery({
    queryKey: ["dossier-risk", slug],
    enabled: !!slug,
    queryFn: async (): Promise<Risk | null> => {
      const { data } = await supabase.from("protocol_risk_scores").select("*").eq("company_slug", slug!).maybeSingle();
      return (data as Risk) ?? null;
    },
  });

  // Risk history for timeline (90d)
  const riskHistory = useQuery({
    queryKey: ["dossier-risk-history", slug],
    enabled: !!slug,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("protocol_risk_scores_history")
        .select("snapshot_date,composite_score,sub_audit,sub_onchain,sub_activity,sub_team,sub_funding")
        .eq("company_slug", slug!)
        .gte("snapshot_date", cutoff)
        .order("snapshot_date", { ascending: true });
      return (data ?? []) as Array<{
        snapshot_date: string;
        composite_score: number;
        sub_audit: number | null;
        sub_onchain: number | null;
        sub_activity: number | null;
        sub_team: number | null;
        sub_funding: number | null;
      }>;
    },
  });

  const audits = useQuery({
    queryKey: ["dossier-audits", slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_history")
        .select("id,audit_firm,protocol_name,audit_date,audit_type,report_url,findings_critical,findings_high,findings_medium,findings_low,findings_informational,ai_summary,smart_contract_language,findings_extraction_status,data_source,audited_repo_url,audited_commit_hash,audited_files,audited_chains")
        .eq("company_slug", slug!)
        .order("audit_date", { ascending: false, nullsFirst: false });
      return (data ?? []) as any[];
    },
  });

  const findings = useQuery({
    queryKey: ["dossier-findings", slug],
    enabled: !!slug,
    queryFn: async () => {
      const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, informational: 4, gas: 5, unknown: 6 };
      const { data } = await supabase
        .from("audit_findings_detail")
        .select("severity,title,summary,status,affected_addresses")
        .eq("company_slug", slug!)
        .limit(80);
      return ((data ?? []) as any[]).sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));
    },
  });

  // Aggregate: for every finding in this protocol, count how many cite each contract address.
  // Used to overlay per-contract finding counts on the sidebar contracts list.
  const findingCountsByAddress = useQuery({
    queryKey: ["dossier-finding-addrs", slug],
    enabled: !!slug,
    queryFn: async (): Promise<Record<string, { critical: number; high: number; medium: number; low: number; total: number }>> => {
      const PAGE = 1000;
      let offset = 0;
      const all: { severity: string | null; affected_addresses: string[] | null }[] = [];
      while (true) {
        const { data } = await supabase
          .from("audit_findings_detail")
          .select("severity,affected_addresses")
          .eq("company_slug", slug!)
          .range(offset, offset + PAGE - 1);
        if (!data || data.length === 0) break;
        all.push(...(data as any[]));
        if (data.length < PAGE) break;
        offset += PAGE;
        if (offset > 8000) break;
      }
      const map: Record<string, { critical: number; high: number; medium: number; low: number; total: number }> = {};
      for (const f of all) {
        if (!Array.isArray(f.affected_addresses)) continue;
        const sev = (f.severity || "").toLowerCase();
        const bucket = sev === "critical" ? "critical" : sev === "high" ? "high" : sev === "medium" ? "medium" : sev === "low" ? "low" : null;
        for (const addr of f.affected_addresses) {
          if (typeof addr !== "string") continue;
          const k = addr.toLowerCase().trim();
          if (!k) continue;
          if (!map[k]) map[k] = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
          map[k].total += 1;
          if (bucket) map[k][bucket] += 1;
        }
      }
      return map;
    },
  });

  const contracts = useQuery({
    queryKey: ["dossier-contracts", slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data } = await supabase
        .from("chain_addresses")
        .select("chain,address,kind,label,is_contract,proxy_pattern,implementation_address,admin_address,owner_address,bytecode_size,metadata_checked_at")
        .eq("company_slug", slug!);
      return (data ?? []) as any[];
    },
  });

  // Risk Landscape Brief (AI-generated analyst memo, cached 7 days)
  const riskBrief = useQuery({
    queryKey: ["dossier-brief", slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data } = await supabase
        .from("risk_landscape_briefs")
        .select("brief,headline,posture_rating,generated_at,model,posture_summary,recommended_actions,sections")
        .eq("company_slug", slug!)
        .maybeSingle();
      return data as null | { brief: string; headline: string | null; posture_rating: string | null; generated_at: string; model: string; posture_summary: any; recommended_actions: Array<{ label: string; kind: string; why: string; compare_with?: string[] }> | null; sections: Record<string, string> | null };
    },
  });

  const briefConfidence: string | null = (riskBrief.data?.posture_summary as any)?.data_confidence ?? null;

  const [briefRefreshing, setBriefRefreshing] = useState(false);
  const [dossierTab, setDossierTab] = useState<DossierTab>("pulse");
  const refreshBrief = async () => {
    if (!slug || briefRefreshing) return;
    setBriefRefreshing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL || "https://qktjbtmcjrwzmtqnszbq.supabase.co"}/functions/v1/generate-risk-landscape`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ company_slug: slug, force: true }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      qc.invalidateQueries({ queryKey: ["dossier-brief", slug] });
    } catch (e) {
      console.error("brief refresh failed", e);
    } finally {
      setBriefRefreshing(false);
    }
  };

  // Sector benchmark for the protocol's category
  const sectorBench = useQuery({
    queryKey: ["dossier-sector-bench", company.data?.category],
    enabled: !!company.data?.category,
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_sector_benchmarks")
        .select("category,n_protocols,audited_pct,median_audit_count,median_audits_1y,median_unique_firms,p75_audit_count,avg_days_since_audit")
        .eq("category", company.data!.category!)
        .maybeSingle();
      return data as null | { category: string; n_protocols: number; audited_pct: number; median_audit_count: number; median_audits_1y: number; median_unique_firms: number; p75_audit_count: number; avg_days_since_audit: number };
    },
  });

  // Token unlock (next major event)
  const tokenUnlock = useQuery({
    queryKey: ["dossier-token-unlock", slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data } = await supabase
        .from("token_unlocks")
        .select("next_unlock_date,next_unlock_pct_supply,vesting_kind,total_vested_remaining_pct,source,source_url,notes,updated_at")
        .eq("company_slug", slug!)
        .maybeSingle();
      return data as null | { next_unlock_date: string | null; next_unlock_pct_supply: number | null; vesting_kind: string | null; total_vested_remaining_pct: number | null; source: string; source_url: string | null; notes: string | null; updated_at: string };
    },
  });

  // Oracle dependencies (curated + inferred)
  const oracleDeps = useQuery({
    queryKey: ["dossier-oracle-deps", slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data } = await supabase
        .from("oracle_dependencies")
        .select("oracle_slug,usage_kind,notes,source,oracle_providers(slug,name,website,decentralization_score,notable_failures)")
        .eq("company_slug", slug!);
      return (data ?? []) as Array<{ oracle_slug: string; usage_kind: string | null; notes: string | null; source: string; oracle_providers: { slug: string; name: string; website: string | null; decentralization_score: number | null; notable_failures: any } | null }>;
    },
  });

  // Composability peers (live computed via SQL function)
  const composabilityPeers = useQuery({
    queryKey: ["dossier-composability", slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data } = await supabase.rpc("composability_peers", { p_slug: slug!, p_limit: 8 });
      return (data ?? []) as Array<{
        peer_slug: string; peer_name: string; peer_logo: string | null; peer_url: string | null; peer_category: string | null;
        shared_chains: number; shared_investors: number; shared_auditors: number; category_match: boolean; score: number;
      }>;
    },
  });

  // Multisig safes + signer changes (admin key surveillance)
  const multisigs = useQuery({
    queryKey: ["dossier-multisigs", slug],
    enabled: !!slug,
    queryFn: async () => {
      const [safes, changes] = await Promise.all([
        supabase.from("multisig_safes")
          .select("chain,address,threshold,owners,nonce,version,last_synced_at")
          .eq("company_slug", slug!)
          .order("last_synced_at", { ascending: false }),
        supabase.from("multisig_signer_changes")
          .select("chain,safe_address,event_kind,details,observed_at")
          .eq("company_slug", slug!)
          .order("observed_at", { ascending: false })
          .limit(20),
      ]);
      return {
        safes: (safes.data ?? []) as Array<{ chain: string; address: string; threshold: number | null; owners: string[]; nonce: number | null; version: string | null; last_synced_at: string }>,
        changes: (changes.data ?? []) as Array<{ chain: string; safe_address: string; event_kind: string; details: any; observed_at: string }>,
      };
    },
  });

  // Protocol economics (fees, revenue, treasury)
  const economics = useQuery({
    queryKey: ["dossier-economics", slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data } = await supabase
        .from("protocol_economics")
        .select("fees_24h,fees_7d,fees_30d,fees_1y,revenue_24h,revenue_7d,revenue_30d,revenue_1y,treasury_usd,mcap,fdv,fetched_at")
        .eq("company_slug", slug!)
        .maybeSingle();
      return data as any;
    },
  });

  // Governance proposals (recent)
  const governance = useQuery({
    queryKey: ["dossier-governance", slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data } = await supabase
        .from("governance_proposals")
        .select("id,title,body,state,scores_total,votes_count,start_ts,end_ts,url,snapshot_space")
        .eq("company_slug", slug!)
        .order("end_ts", { ascending: false, nullsFirst: false })
        .limit(8);
      return (data ?? []) as any[];
    },
  });

  // User notes
  const notesQ = useQuery({
    queryKey: ["dossier-notes", slug, user?.id],
    enabled: !!slug && !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("protocol_notes")
        .select("id,body,pinned,created_at,updated_at")
        .eq("user_id", user!.id)
        .eq("company_slug", slug!)
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  // User tags
  const tagsQ = useQuery({
    queryKey: ["dossier-tags", slug, user?.id],
    enabled: !!slug && !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("protocol_tags")
        .select("id,tag")
        .eq("user_id", user!.id)
        .eq("company_slug", slug!);
      return (data ?? []) as Array<{ id: string; tag: string }>;
    },
  });

  // Risk patterns for the protocol's category (Lending/Dexs/Bridge/...)
  const categoryRiskPattern = useQuery({
    queryKey: ["dossier-cat-pattern", company.data?.category],
    enabled: !!company.data?.category,
    queryFn: async () => {
      const { data } = await supabase
        .from("contract_risk_patterns")
        .select("category,pattern_name,description,common_risks,known_exploits,questions_to_ask")
        .eq("category", company.data!.category!)
        .maybeSingle();
      return data as null | {
        category: string;
        pattern_name: string;
        description: string;
        common_risks: Array<{ risk: string; severity: string; mitigation: string }>;
        known_exploits: Array<{ protocol: string; year: number; amount_usd: number; technique: string; notes?: string }> | null;
        questions_to_ask: string[] | null;
      };
    },
  });

  // Similar-pattern hacks beyond our protocol — show what got hacked that looks like this
  const peerHacks = useQuery({
    queryKey: ["dossier-peer-hacks", slug, company.data?.category],
    enabled: !!slug && !!company.data?.category,
    queryFn: async () => {
      // Pull richer peer attributes so we can score similarity
      const { data: peers } = await supabase
        .from("companies")
        .select("slug,name,url,logo,audit_count,unique_auditor_count,last_audit_date,has_bug_bounty")
        .eq("category", company.data!.category!)
        .neq("slug", slug!)
        .eq("has_been_hacked", true)
        .limit(60);
      if (!peers || peers.length === 0) return [];
      const peerSlugs = peers.map((p: any) => p.slug);
      const peerMap = new Map<string, any>();
      for (const p of peers as any[]) peerMap.set(p.slug, p);
      // Pull hacks + chains for similarity
      const [hList, chainsList, tvlList] = await Promise.all([
        supabase.from("hacks").select("company_slug,name,hack_date,amount_usd,technique,returned_funds,chains").in("company_slug", peerSlugs).order("amount_usd", { ascending: false, nullsFirst: false }).limit(40),
        supabase.from("chain_addresses").select("company_slug,chain,proxy_pattern").in("company_slug", peerSlugs),
        supabase.from("protocol_metrics").select("company_slug,tvl_usd,date").in("company_slug", peerSlugs).not("tvl_usd", "is", null).order("date", { ascending: false }).limit(2000),
      ]);
      const peerChains = new Map<string, { chains: Set<string>; proxies: number }>();
      for (const c of (chainsList.data ?? []) as any[]) {
        const e = peerChains.get(c.company_slug) ?? { chains: new Set<string>(), proxies: 0 };
        if (c.chain) e.chains.add(c.chain);
        if (c.proxy_pattern && c.proxy_pattern !== "non_proxy") e.proxies++;
        peerChains.set(c.company_slug, e);
      }
      const peerTvl = new Map<string, number>();
      for (const r of (tvlList.data ?? []) as any[]) if (!peerTvl.has(r.company_slug)) peerTvl.set(r.company_slug, Number(r.tvl_usd));
      return ((hList.data ?? []) as any[]).map((h) => ({
        ...h,
        peer: peerMap.get(h.company_slug),
        peer_chains: Array.from(peerChains.get(h.company_slug)?.chains ?? []),
        peer_proxies: peerChains.get(h.company_slug)?.proxies ?? 0,
        peer_tvl: peerTvl.get(h.company_slug) ?? null,
      }));
    },
  });

  const hacks = useQuery({
    queryKey: ["dossier-hacks", slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data } = await supabase
        .from("hacks")
        .select("name,hack_date,amount_usd,classification,technique,target_type,returned_funds,source_url,chains")
        .eq("company_slug", slug!)
        .order("hack_date", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  const bounties = useQuery({
    queryKey: ["dossier-bounties", slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data } = await supabase
        .from("bug_bounties")
        .select("platform,max_bounty_usd,program_url,is_active")
        .or(`company_slug.eq.${slug},protocol_slug.eq.${slug}`);
      return (data ?? []) as any[];
    },
  });

  const funding = useQuery({
    queryKey: ["dossier-funding", slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data } = await supabase
        .from("funding_rounds")
        .select("round_type,amount_usd,date,lead_investors,all_investors,announcement_url")
        .eq("company_slug", slug!)
        .order("date", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  const hiring = useQuery({
    queryKey: ["dossier-hiring", slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data } = await supabase
        .from("hiring_sources")
        .select("role_count,smart_contract_count,security_count,last_seen_at,source_url")
        .eq("company_slug", slug!)
        .maybeSingle();
      return data as any;
    },
  });

  // Live TVL from DefiLlama (no DB cache — always current). 5-min React Query freshness.
  const tvl = useQuery({
    queryKey: ["dossier-tvl-live", slug],
    enabled: !!slug,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const live = await fetchLiveTvl(slug!);
      if (live.tvl == null) return [] as any[];
      return [{ date: new Date().toISOString().slice(0, 10), tvl: live.tvl, tx_count: null, _source: `defillama:${live.matched_slug}` }];
    },
  });

  const news = useQuery({
    queryKey: ["dossier-news", slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data } = await supabase
        .from("news_items")
        .select("title,url,source,summary,sentiment,published_at")
        .eq("company_slug", slug!)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(15);
      return (data ?? []) as any[];
    },
  });

  const anomalies = useQuery({
    queryKey: ["dossier-anom", slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data } = await supabase
        .from("metric_anomalies")
        .select("chain,date,direction,z_score,detail,value,mean_30d")
        .eq("company_slug", slug!)
        .order("date", { ascending: false })
        .limit(15);
      return (data ?? []) as any[];
    },
  });

  const c = company.data;
  const r = risk.data;
  if (company.isLoading) return <Loading />;
  if (!c) return <NotFound slug={slug} />;

  const auditList = audits.data ?? [];
  const totalFindings = auditList.reduce((acc, a) => ({
    critical: acc.critical + (a.findings_critical ?? 0),
    high: acc.high + (a.findings_high ?? 0),
    medium: acc.medium + (a.findings_medium ?? 0),
    low: acc.low + (a.findings_low ?? 0),
  }), { critical: 0, high: 0, medium: 0, low: 0 });
  const evmContracts = (contracts.data ?? []).filter((x) => x.chain !== "solana");
  const proxyCount = evmContracts.filter((x) => x.proxy_pattern && x.proxy_pattern !== "non_proxy").length;
  const chainsCovered = Array.from(new Set((contracts.data ?? []).map((x) => x.chain).filter(Boolean)));
  const totalRaised = (funding.data ?? []).reduce((s, f) => s + (Number(f.amount_usd) || 0), 0);
  const lastTvl = tvl.data?.[0];
  const sentimentCounts = (news.data ?? []).reduce((acc, n) => {
    if (n.sentiment) acc[n.sentiment] = (acc[n.sentiment] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Hexagon inputs (used in main + sidebar)
  const _fixedCount = (findings.data ?? []).filter((f: any) => ["fixed", "resolved", "remediated"].includes((f.status || "").toLowerCase())).length;
  const _ackCount = (findings.data ?? []).filter((f: any) => (f.status || "").toLowerCase() === "acknowledged").length;
  const _wontfixCount = (findings.data ?? []).filter((f: any) => ["won't fix", "wontfix"].includes((f.status || "").toLowerCase())).length;
  const _responded = _fixedCount + _ackCount + _wontfixCount;
  const _fixRate = _responded > 0 ? (_fixedCount / _responded) * 100 : null;
  const _openCrit = (findings.data ?? []).filter((f: any) => (f.severity || "").toLowerCase() === "critical" && !["fixed", "resolved", "remediated", "acknowledged", "won't fix", "wontfix"].includes((f.status || "").toLowerCase())).length;
  const _openHigh = (findings.data ?? []).filter((f: any) => (f.severity || "").toLowerCase() === "high" && !["fixed", "resolved", "remediated", "acknowledged", "won't fix", "wontfix"].includes((f.status || "").toLowerCase())).length;
  const _datedAudits = auditList.filter((a: any) => !!a.audit_date).map((a: any) => a.audit_date as string).sort();
  const _latestAudit = _datedAudits[_datedAudits.length - 1];
  const _firstAudit = _datedAudits[0];
  const _maxBounty = (bounties.data ?? []).reduce((m: number, b: any) => Math.max(m, Number(b.max_bounty_usd) || 0), 0);
  const _bountyPlatforms = new Set((bounties.data ?? []).map((b: any) => b.platform).filter(Boolean));
  const hexInputs = {
    audit_count: auditList.length,
    unique_auditor_count: new Set(auditList.map((a: any) => a.audit_firm)).size,
    last_audit_date: _latestAudit ?? c.last_audit_date,
    last_audit_firm: c.last_audit_firm,
    has_bug_bounty: c.has_bug_bounty || (bounties.data ?? []).length > 0,
    max_bounty_usd: _maxBounty || null,
    bounty_platforms_count: _bountyPlatforms.size,
    tvl_usd: lastTvl?.tvl ?? null,
    tvl_change_pct_30d: null as number | null,
    has_been_hacked: c.has_been_hacked,
    open_critical: _openCrit,
    open_high: _openHigh,
    fix_rate: _fixRate,
    multisig_count: (multisigs.data ?? []).length,
    last_audit_ago_days: _latestAudit ? Math.floor((Date.now() - new Date(_latestAudit).getTime()) / 86400000) : null,
    first_audit_ago_days: _firstAudit ? Math.floor((Date.now() - new Date(_firstAudit).getTime()) / 86400000) : null,
    news_30d: (news.data ?? []).filter((n: any) => n.published_at && (Date.now() - new Date(n.published_at).getTime()) <= 30 * 86400000).length,
    contract_count: (contracts.data ?? []).length,
  };
  const hexResult = computeProtocolAxes(hexInputs);

  return (
    <div className="max-w-[1700px]">
      {/* TOP BAR */}
      <button onClick={() => navigate(-1)} className="text-xs text-muted-foreground hover:text-white inline-flex items-center gap-1 mb-4">
        <ArrowLeft className="w-3 h-3" /> Back
      </button>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
        {/* === MAIN COLUMN === */}
        <div className="space-y-4 min-w-0">

      <div className="space-y-4">

      {/* OVERVIEW — general intro / who they are */}
      <div className="as-card p-5">
        <div className="flex items-start gap-4">
          <BrandLogo name={c.name} url={c.url} logo={c.logo} className="w-16 h-16 rounded-xl shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-white">{c.name}</h2>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {c.category && <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-white/[0.04] px-2 py-0.5 rounded">{c.category}</span>}
              {c.has_been_hacked && <span className="text-[10px] uppercase tracking-wider text-rose-300 bg-rose-500/15 border border-rose-500/40 px-2 py-0.5 rounded inline-flex items-center gap-1"><Skull className="w-3 h-3" /> Past hack</span>}
              {c.has_bug_bounty && <span className="text-[10px] uppercase tracking-wider text-emerald-300 bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 rounded inline-flex items-center gap-1"><Bug className="w-3 h-3" /> Active bounty</span>}
            </div>
            {c.description ? (
              <p className="text-[13.5px] text-white/85 mt-3 leading-relaxed">{c.description}</p>
            ) : (
              <p className="text-[12.5px] text-muted-foreground italic mt-3">No description on file.</p>
            )}
            <div className="flex items-center gap-3 mt-4 text-[11.5px] text-muted-foreground flex-wrap">
              {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1.5"><Globe className="w-3 h-3" />{(() => { try { return new URL(c.url).hostname.replace("www.", ""); } catch { return c.url; } })()}</a>}
              {c.twitter && <a href={c.twitter} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1.5"><Twitter className="w-3 h-3" /> X</a>}
              {c.github && <a href={c.github} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1.5"><Github className="w-3 h-3" /> GitHub</a>}
              {c.total_raised_usd && <span className="inline-flex items-center gap-1.5"><Banknote className="w-3 h-3" /> Raised {compactUsd(c.total_raised_usd)}</span>}
              {lastTvl && <span className="inline-flex items-center gap-1.5"><TrendingUp className="w-3 h-3" /> TVL {compactUsd(lastTvl.tvl)}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Risk landscape brief removed — overview card above carries the intro. */}

      {/* QUICK STATS GRID */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Audits" value={auditList.length.toString()} hint={`${new Set(auditList.map((a) => a.audit_firm)).size} firms`} />
        <Stat label="Findings" value={`${totalFindings.critical}C ${totalFindings.high}H`} hint={`${totalFindings.medium} med · ${totalFindings.low} low`} tone={totalFindings.critical > 0 ? "alert" : totalFindings.high > 0 ? "warn" : "good"} />
        <Stat label="Contracts" value={(contracts.data ?? []).length.toString()} hint={`${proxyCount} proxy · ${chainsCovered.length} chains`} />
        <Stat label="Total raised" value={compactUsd(totalRaised || c.total_raised_usd)} hint={`${(funding.data ?? []).length} rounds`} />
        <Stat label="Latest TVL" value={lastTvl ? compactUsd(lastTvl.tvl) : "—"} hint={lastTvl ? "live · DefiLlama" : "no data"} />
        <Stat label="Hiring" value={hiring.data?.role_count?.toString() ?? "—"} hint={hiring.data ? `${hiring.data.smart_contract_count ?? 0} SC · ${hiring.data.security_count ?? 0} sec` : "no data"} />
      </div>

      {/* ECONOMICS — fees + revenue + treasury */}
      {economics.data && (economics.data.revenue_30d || economics.data.fees_30d || economics.data.mcap || economics.data.treasury_usd) && (
        <div className="as-card p-5">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Banknote className="w-4 h-4 text-emerald-300" />
            <h2 className="text-sm font-semibold text-white">Protocol economics</h2>
            <span className="text-[10px] text-muted-foreground ml-auto">via DefiLlama · refreshed {daysAgo(economics.data.fetched_at)}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <EcoTile label="Revenue 24h" value={compactUsd(economics.data.revenue_24h)} hint="protocol take" tone="good" />
            <EcoTile label="Revenue 30d" value={compactUsd(economics.data.revenue_30d)} hint="last 30 days" tone="good" />
            <EcoTile label="Revenue 1y" value={compactUsd(economics.data.revenue_1y)} hint="annualized" tone="good" />
            <EcoTile label="Fees 30d" value={compactUsd(economics.data.fees_30d)} hint="total user-paid" tone="neutral" />
            <EcoTile label="Market cap" value={compactUsd(economics.data.mcap)} hint={economics.data.fdv ? `FDV ${compactUsd(economics.data.fdv)}` : "circulating"} tone="neutral" />
            <EcoTile label="Treasury" value={compactUsd(economics.data.treasury_usd)} hint="protocol balance" tone="neutral" />
          </div>
        </div>
      )}

      {/* TOKEN UNLOCK (supply pressure) */}
      {tokenUnlock.data && (tokenUnlock.data.next_unlock_date || tokenUnlock.data.total_vested_remaining_pct != null) && (
        <TokenUnlockCard data={tokenUnlock.data} />
      )}

      {/* Risk score timeline removed — low signal. */}

      {/* AUDIT POSTURE INTELLIGENCE — moved above Risk Profile per request */}
      <AuditPosture
        company={c}
        audits={auditList}
        sector={sectorBench.data}
      />

      {/* RISK PROFILE — moved below Audit Posture */}
      {r && (
        <div className="as-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-white">Risk profile</h2>
            <span className="text-[10px] text-muted-foreground ml-auto">Coverage {r.coverage_pct}% · updated {daysAgo((r as any).computed_at)}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
            <div className="space-y-2">
              {[
                { label: "Audit", val: r.sub_audit },
                { label: "On-chain", val: r.sub_onchain },
                { label: "Activity", val: r.sub_activity },
                { label: "Team", val: r.sub_team },
                { label: "Funding", val: r.sub_funding },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground w-16 shrink-0">{s.label}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                    <div className={`h-full ${s.val >= 70 ? "bg-rose-400" : s.val >= 50 ? "bg-orange-400" : s.val >= 30 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${Math.max(2, s.val)}%` }} />
                  </div>
                  <span className="tabular-nums text-white/80 w-8 text-right">{s.val}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Top drivers (what's moving the score)</div>
              <div className="space-y-1.5">
                {(r.drivers ?? []).slice(0, 10).map((d, i) => (
                  <div key={i} className="flex items-start gap-2 text-[12.5px]">
                    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${d.good ? "bg-emerald-500/15 text-emerald-300" : Math.abs(d.severity) >= 20 ? "bg-rose-500/15 text-rose-300" : "bg-amber-500/10 text-amber-300"}`}>{d.dimension}</span>
                    <span className="flex-1 text-white/90">{d.factor}</span>
                    <span className={`text-[11px] tabular-nums ${d.good ? "text-emerald-400" : d.severity > 0 ? "text-rose-300" : "text-muted-foreground"}`}>{d.severity > 0 ? "+" : ""}{d.severity}</span>
                    {d.evidence_url && <a href={d.evidence_url} target="_blank" rel="noreferrer" className="text-primary hover:underline"><ExternalLink className="w-3 h-3" /></a>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* === Audit history / Bug bounty / Oracle deps — 2-col stack, all collapsible === */}
      <AuditBountyOracleGrid
        audits={auditList}
        bounties={bounties.data ?? []}
        oracles={oracleDeps.data ?? []}
        companyName={c.name}
      />

      {/* CONTRACT INTELLIGENCE — what this protocol does + pattern-based risk + peer exploits */}
      {(categoryRiskPattern.data || (contracts.data ?? []).length > 0) && (
        <ContractIntelligence
          category={c.category}
          pattern={categoryRiskPattern.data}
          contracts={contracts.data ?? []}
          peerHacks={peerHacks.data ?? []}
          lastAudit={c.last_audit_date}
          lastAuditFirm={c.last_audit_firm}
          hasBounty={c.has_bug_bounty}
          bountyDetails={bounties.data ?? []}
          auditCount={c.audit_count}
          uniqueAuditorCount={c.unique_auditor_count}
          selfChains={chainsCovered}
          selfTvl={lastTvl?.tvl ?? null}
          selfProxyCount={proxyCount}
        />
      )}

      {/* NOTES + TAGS (analyst workspace) */}
      {user && <NotesAndTags slug={slug!} userId={user.id} notes={notesQ.data ?? []} tags={tagsQ.data ?? []} onChange={() => {
        qc.invalidateQueries({ queryKey: ["dossier-notes", slug, user.id] });
        qc.invalidateQueries({ queryKey: ["dossier-tags", slug, user.id] });
      }} />}

      {/* MULTISIG SURVEILLANCE — admin keys + signer changes */}
      {((multisigs.data?.safes ?? []).length > 0 || (multisigs.data?.changes ?? []).length > 0) && (
        <MultisigSurveillance
          safes={multisigs.data?.safes ?? []}
          changes={multisigs.data?.changes ?? []}
        />
      )}

      {/* Composability peers — standalone full-width */}
      {(composabilityPeers.data ?? []).length > 0 && (
        <div className="as-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="w-4 h-4 text-violet-300" />
            <h2 className="text-sm font-semibold text-white">Composability peers</h2>
            <span className="text-[10px] text-muted-foreground ml-auto">shared chains · investors · auditors</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {(composabilityPeers.data ?? []).slice(0, 6).map((p) => (
              <Link key={p.peer_slug} to={`/protocol/${p.peer_slug}`} className="rounded-md border border-white/[0.05] bg-white/[0.015] hover:bg-white/[0.04] px-3 py-2 flex items-center gap-3">
                <BrandLogo name={p.peer_name} url={p.peer_url} logo={p.peer_logo} className="w-6 h-6 rounded shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] text-white/90 font-medium truncate">{p.peer_name}</div>
                  <div className="text-[10.5px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                    {p.peer_category && <span>{p.peer_category}</span>}
                    {p.shared_chains > 0 && <span className="text-violet-300/80">· {p.shared_chains} chain{p.shared_chains > 1 ? "s" : ""}</span>}
                    {p.shared_investors > 0 && <span className="text-emerald-300/80">· {p.shared_investors} co-investor{p.shared_investors > 1 ? "s" : ""}</span>}
                    {p.shared_auditors > 0 && <span className="text-sky-300/80">· {p.shared_auditors} same auditor{p.shared_auditors > 1 ? "s" : ""}</span>}
                  </div>
                </div>
                <span className="text-[11px] font-bold tabular-nums text-violet-200">{p.score}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Governance moved to right sidebar (collapsible) */}

      {/* Audit history + bug bounty + oracle deps now rendered by AuditBountyOracleGrid above */}

      {/* TOP FINDINGS — with interpretation */}
      <FindingsSection findings={findings.data ?? []} />

      </div>{/* close content space-y-4 */}

        </div>{/* close main col */}

        {/* === RIGHT SIDEBAR === */}
        <ProtocolSidebar
          company={c}
          composite={hexResult.composite}
          tone={scoreToTone(hexResult.composite)}
          axes={hexResult.axes as any}
          auditCount={auditList.length}
          uniqueFirms={new Set(auditList.map((a: any) => a.audit_firm)).size}
          hasBounty={!!c.has_bug_bounty || (bounties.data ?? []).length > 0}
          multisigCount={(multisigs.data ?? []).length}
          contractCount={(contracts.data ?? []).length}
          proxyCount={proxyCount}
          tvl={lastTvl?.tvl ?? null}
          totalRaised={totalRaised || c.total_raised_usd}
          chains={chainsCovered}
          contracts={contracts.data ?? []}
          findingCountsByAddress={findingCountsByAddress.data ?? {}}
          funding={funding.data ?? []}
          governance={governance.data ?? []}
          news={news.data ?? []}
          hacks={hacks.data ?? []}
        />
      </div>{/* close grid */}
    </div>
  );
}

function AuditBountyOracleGrid({ audits, bounties, oracles, companyName }: { audits: any[]; bounties: any[]; oracles: any[]; companyName: string }) {
  const [auditsOpen, setAuditsOpen] = useState(true); // primary section, open by default
  const [bountyOpen, setBountyOpen] = useState(false);
  const [oracleOpen, setOracleOpen] = useState(false);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* LEFT 2 cols — Audit history */}
      <div className="lg:col-span-2 as-card p-0 overflow-hidden">
        <button type="button" onClick={() => setAuditsOpen(v => !v)} className="w-full px-4 py-3 flex items-center gap-2 hover:bg-white/[0.02] text-left">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-sm font-semibold text-white">Audit history</span>
          <span className="text-[11px] text-muted-foreground ml-auto tabular-nums">{audits.length}</span>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${auditsOpen ? "rotate-0" : "-rotate-90"}`} />
        </button>
        {auditsOpen && (
          <div className="border-t border-white/[0.06]">
            {audits.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground italic">No audits on file.</div>
            ) : (
              <div className="divide-y divide-white/[0.04] max-h-[640px] overflow-y-auto">
                {audits.slice(0, 30).map((a: any) => {
                  const niceDate = a.audit_date ? (() => {
                    const d = new Date(a.audit_date);
                    return isNaN(d.getTime()) ? a.audit_date : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
                  })() : "—";
                  return (
                  <div key={a.id} className="px-4 py-3 flex items-start gap-3">
                    <div className="text-[11px] text-muted-foreground tabular-nums w-24 shrink-0">{niceDate}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-white font-medium truncate">{a.audit_firm}</span>
                        <AuditTypeBadge type={a.audit_type} variant="normal" />
                        {a.smart_contract_language && <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{a.smart_contract_language}</span>}
                      </div>
                      {a.protocol_name && a.protocol_name !== companyName && <div className="text-[11px] text-muted-foreground truncate">{a.protocol_name}</div>}
                      {a.ai_summary && <div className="text-[11px] text-muted-foreground/80 italic mt-1 line-clamp-2">{a.ai_summary}</div>}
                      {(a.audited_repo_url || a.audited_commit_hash || (a.audited_files && a.audited_files.length > 0)) && (
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[10.5px]">
                          {a.audited_repo_url && (
                            <a href={a.audited_repo_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/[0.08] hover:border-primary/40 hover:bg-primary/[0.05] text-muted-foreground hover:text-primary font-mono">
                              <ExternalLink className="w-2.5 h-2.5" />
                              {a.audited_repo_url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 50)}
                            </a>
                          )}
                          {a.audited_commit_hash && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/[0.06] bg-white/[0.02] text-muted-foreground font-mono" title={`Audited commit: ${a.audited_commit_hash}`}>@ {a.audited_commit_hash.slice(0, 7)}</span>
                          )}
                          {a.audited_files && Array.isArray(a.audited_files) && a.audited_files.length > 0 && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/[0.06] bg-white/[0.02] text-muted-foreground" title={a.audited_files.join("\n")}>{a.audited_files.length} file{a.audited_files.length === 1 ? "" : "s"}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-[10px]">
                      {(a.findings_critical ?? 0) > 0 && <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 font-bold">{a.findings_critical}C</span>}
                      {(a.findings_high ?? 0) > 0 && <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300/90 font-bold">{a.findings_high}H</span>}
                      {(a.findings_medium ?? 0) > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">{a.findings_medium}M</span>}
                      {(a.findings_low ?? 0) > 0 && <span className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300/80">{a.findings_low}L</span>}
                    </div>
                    {a.report_url && (
                      <a
                        href={a.report_url}
                        target="_blank"
                        rel="noreferrer"
                        title="Open the full audit report"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:border-primary/50 text-[10px] font-medium shrink-0 whitespace-nowrap"
                      >
                        Report ↗
                      </a>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* RIGHT col: Bug bounty + Oracle deps stacked */}
      <div className="space-y-3">
        {/* Bug bounty — collapsible */}
        {bounties.length > 0 && (
          <div className="as-card p-0 overflow-hidden">
            <button type="button" onClick={() => setBountyOpen(v => !v)} className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/[0.02] text-left">
              <Bug className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
              <span className="text-sm font-semibold text-white">Bug bounty</span>
              <span className="text-[11px] text-muted-foreground ml-auto tabular-nums">{bounties.length}</span>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${bountyOpen ? "rotate-0" : "-rotate-90"}`} />
            </button>
            {bountyOpen && (
              <div className="border-t border-white/[0.04] divide-y divide-white/[0.04]">
                {bounties.map((b: any, i: number) => (
                  <a key={i} href={b.program_url || "#"} target="_blank" rel="noreferrer" className="block px-3 py-2 hover:bg-white/[0.02] text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white">{b.platform}</span>
                      {b.max_bounty_usd && (
                        <span className="text-emerald-300 font-semibold tabular-nums">up to {compactUsd(Number(b.max_bounty_usd))}</span>
                      )}
                    </div>
                    {b.program_url && (
                      <div className="text-[10px] text-muted-foreground/80 mt-0.5 inline-flex items-center gap-1">
                        <ExternalLink className="w-2.5 h-2.5" /> program
                      </div>
                    )}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Oracle dependencies — collapsible */}
        {oracles.length > 0 && (
          <div className="as-card p-0 overflow-hidden">
            <button type="button" onClick={() => setOracleOpen(v => !v)} className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/[0.02] text-left">
              <Activity className="w-3.5 h-3.5 text-sky-300 shrink-0" />
              <span className="text-sm font-semibold text-white">Oracle dependencies</span>
              <span className="text-[11px] text-muted-foreground ml-auto tabular-nums">{oracles.length}</span>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${oracleOpen ? "rotate-0" : "-rotate-90"}`} />
            </button>
            {oracleOpen && (
              <div className="border-t border-white/[0.04] divide-y divide-white/[0.04]">
                {oracles.map((d: any, i: number) => (
                  <div key={i} className="px-3 py-2 text-[11px]">
                    <div className="flex items-center gap-2">
                      <BrandLogo name={d.oracle_providers?.name || d.oracle_slug} className="w-5 h-5 rounded shrink-0" />
                      <span className="text-white font-medium">{d.oracle_providers?.name || d.oracle_slug}</span>
                      {d.usage_kind && <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground bg-white/[0.04] px-1 py-0.5 rounded">{d.usage_kind.replace("_", " ")}</span>}
                      {d.source === "inferred" && <span className="text-[9.5px] uppercase tracking-wider text-amber-300/80 bg-amber-500/10 border border-amber-500/30 px-1 py-0.5 rounded">inferred</span>}
                    </div>
                    {d.oracle_providers?.notable_failures && Array.isArray(d.oracle_providers.notable_failures) && d.oracle_providers.notable_failures.length > 0 && (
                      <div className="text-[10px] text-rose-300/80 mt-1 italic line-clamp-1">
                        ⚠ past incidents: {(d.oracle_providers.notable_failures as any[]).slice(0, 2).map((f: any) => `${f.protocol} (${f.year})`).join(" · ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {bounties.length === 0 && oracles.length === 0 && (
          <div className="as-card p-3 text-[11px] text-muted-foreground italic">
            No bounty program or oracle dependencies tracked.
          </div>
        )}
      </div>
    </div>
  );
}

function ProtocolTabBar({ tab, setTab, openCrit, hasBrief }: { tab: DossierTab; setTab: (t: DossierTab) => void; hexComposite: number; openCrit: number; hasBrief: boolean }) {
  const tabs: Array<{ k: DossierTab; label: string; badge?: number; badgeTone?: "alert" | "info" }> = [
    { k: "pulse", label: "Pulse" },
    { k: "security", label: "Security", badge: openCrit > 0 ? openCrit : undefined, badgeTone: "alert" },
    { k: "fundamentals", label: "Fundamentals" },
    { k: "operational", label: "Operational" },
    { k: "ai_brief", label: "AI Brief", badge: hasBrief ? undefined : undefined, badgeTone: "info" },
  ];
  return (
    <div className="as-card p-1 flex items-center gap-1 overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t.k}
          type="button"
          onClick={() => setTab(t.k)}
          className={`px-3 py-1.5 rounded text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${tab === t.k ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-white hover:bg-white/[0.03]"}`}
        >
          {t.label}
          {t.badge != null && (
            <span className={`text-[9px] font-bold tabular-nums px-1.5 py-0.5 rounded ${t.badgeTone === "alert" ? "bg-rose-500/25 text-rose-200" : "bg-primary/20 text-primary"}`}>{t.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function ProtocolSidebar({ company: c, composite, tone, axes, auditCount, uniqueFirms, hasBounty, multisigCount, contractCount, proxyCount, tvl, totalRaised, chains, contracts, findingCountsByAddress, funding, governance, news, hacks }: {
  company: any;
  composite: number;
  tone: "strong" | "solid" | "concerning" | "weak" | "critical";
  axes: any[];
  auditCount: number;
  uniqueFirms: number;
  hasBounty: boolean;
  multisigCount: number;
  contractCount: number;
  proxyCount: number;
  tvl: number | null;
  totalRaised: number | null;
  chains: string[];
  contracts: any[];
  findingCountsByAddress: Record<string, { critical: number; high: number; medium: number; low: number; total: number }>;
  funding: any[];
  governance: any[];
  news: any[];
  hacks: any[];
}) {
  const [contractsOpen, setContractsOpen] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false);
  const [governanceOpen, setGovernanceOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  const [hacksOpen, setHacksOpen] = useState(hacks.length > 0); // open by default if hack on record
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);

  // Lazy-load people on open
  const { user: _u } = useAuth();
  const peopleQ = useQuery({
    queryKey: ["sidebar-people", c.slug],
    enabled: peopleOpen,
    queryFn: async () => {
      const { data } = await supabase
        .from("company_people")
        .select("id,name,title,role,linkedin,twitter,github,is_decision_maker,title_buckets")
        .eq("company_slug", c.slug)
        .order("is_decision_maker", { ascending: false, nullsFirst: false })
        .limit(50);
      return (data ?? []) as any[];
    },
  });

  // github array from companies row
  const githubLinks: string[] = Array.isArray(c.github) ? c.github.filter((g: any) => typeof g === "string" && g.length > 0) : [];
  const certs = [
    { label: "Audited", ok: auditCount > 0, value: auditCount > 0 ? `${auditCount} audit${auditCount === 1 ? "" : "s"} / ${uniqueFirms} firm${uniqueFirms === 1 ? "" : "s"}` : "no audit" },
    { label: "Bug bounty", ok: hasBounty, value: hasBounty ? "active" : "none" },
    { label: "Multisig", ok: multisigCount > 0, value: multisigCount > 0 ? `${multisigCount} safe${multisigCount === 1 ? "" : "s"}` : "not mapped" },
    { label: "Contracts mapped", ok: contractCount > 0, value: contractCount > 0 ? `${contractCount} addrs · ${proxyCount} proxy` : "no addresses" },
  ];
  return (
    <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
      {/* Hexagon mini */}
      <div className="as-card p-3">
        <div className="flex items-center justify-center">
          <HexagonScore axes={axes} centerLabel="Posture" centerValue={composite} centerTone={tone} size={240} variant="fund" />
        </div>
        {/* Compact brand row below hexagon — logo + name + socials only, no description */}
        <div className="flex items-center gap-2 pt-3 mt-3 border-t border-white/[0.04]">
          <BrandLogo name={c.name} url={c.url} logo={c.logo} className="w-7 h-7 rounded-md shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold text-white truncate leading-tight">{c.name}</div>
            {c.category && <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground mt-0.5">{c.category}</div>}
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center"><Globe className="w-3 h-3" /></a>}
            {c.twitter && <a href={c.twitter} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center"><Twitter className="w-3 h-3" /></a>}
            {githubLinks.length > 0 && <a href={githubLinks[0]} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center"><Github className="w-3 h-3" /></a>}
          </div>
        </div>
      </div>

      {/* Certifications */}
      <div className="as-card p-3">
        <div className="text-[9.5px] uppercase tracking-[0.1em] font-semibold text-muted-foreground mb-2">Certifications & coverage</div>
        <div className="grid grid-cols-2 gap-2">
          {certs.map((cert) => (
            <div key={cert.label} className={`rounded border p-2 ${cert.ok ? "border-emerald-500/25 bg-emerald-500/[0.04]" : "border-white/[0.06] bg-white/[0.02]"}`}>
              <div className="flex items-center gap-1 mb-0.5">
                <div className={`w-2 h-2 rounded-full ${cert.ok ? "bg-emerald-400" : "bg-muted-foreground/30"}`} />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{cert.label}</span>
              </div>
              <div className={`text-[11px] truncate ${cert.ok ? "text-white" : "text-muted-foreground/70"}`}>{cert.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Key metadata */}
      <div className="as-card p-3 text-[11.5px]">
        <div className="text-[9.5px] uppercase tracking-[0.1em] font-semibold text-muted-foreground mb-2">Key metadata</div>
        <dl className="space-y-1.5">
          {tvl != null && <Row label="TVL" value={compactUsd(tvl)} />}
          {totalRaised != null && totalRaised > 0 && <Row label="Total raised" value={compactUsd(totalRaised)} />}
          {chains.length > 0 && <Row label="Chains" value={chains.slice(0, 4).join(" · ")} />}
          <Row label="Audits" value={`${auditCount} · ${uniqueFirms} firm${uniqueFirms === 1 ? "" : "s"}`} />
          {c.last_audit_firm && <Row label="Last audit" value={c.last_audit_firm} />}
        </dl>
      </div>

      {/* Smart contracts — collapsible */}
      <div className="as-card p-0 overflow-hidden">
        <button type="button" onClick={() => setContractsOpen(v => !v)} className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/[0.02] text-left">
          <Boxes className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
          <span className="text-[11px] font-semibold text-white uppercase tracking-wider">Smart contracts</span>
          <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">{contracts.length}</span>
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${contractsOpen ? "rotate-0" : "-rotate-90"}`} />
        </button>
        {contractsOpen && (
          <div className="border-t border-white/[0.04] px-3 py-3 space-y-2 max-h-[420px] overflow-y-auto">
            {contracts.length === 0 ? (
              <div className="text-[11px] text-muted-foreground italic">No contracts mapped.</div>
            ) : (
              [...contracts]
                .sort((a, b) => {
                  const af = findingCountsByAddress[String(a.address || "").toLowerCase()]?.total ?? 0;
                  const bf = findingCountsByAddress[String(b.address || "").toLowerCase()]?.total ?? 0;
                  return bf - af;
                })
                .slice(0, 30)
                .map((cn: any, i: number) => {
                const xUrl = explorerUrl(cn.chain, cn.address);
                const xName = explorerName(cn.chain);
                const findingStats = findingCountsByAddress[String(cn.address || "").toLowerCase()];
                const inner = (
                  <>
                    <div className="flex items-center justify-between mb-1 gap-1">
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{cn.chain}</span>
                      <div className="flex items-center gap-1">
                        {findingStats && findingStats.total > 0 && (
                          <span
                            className="text-[8.5px] uppercase tracking-wider px-1 py-0.5 rounded border bg-rose-500/10 border-rose-500/30 text-rose-300 inline-flex items-center gap-1"
                            title={`${findingStats.total} finding${findingStats.total === 1 ? "" : "s"} cite this contract — ${findingStats.critical}C ${findingStats.high}H ${findingStats.medium}M ${findingStats.low}L`}
                          >
                            <AlertTriangle className="w-2.5 h-2.5" />
                            {findingStats.critical > 0 && <span className="font-bold">{findingStats.critical}C</span>}
                            {findingStats.high > 0 && <span className="font-bold">{findingStats.high}H</span>}
                            {findingStats.critical === 0 && findingStats.high === 0 && <span>{findingStats.total} finding{findingStats.total === 1 ? "" : "s"}</span>}
                          </span>
                        )}
                        {cn.proxy_pattern && cn.proxy_pattern !== "non_proxy" && (
                          <span className="text-[8.5px] uppercase tracking-wider text-amber-300 bg-amber-500/10 px-1 py-0.5 rounded">{cn.proxy_pattern.replace(/^eip\d+_/, "")}</span>
                        )}
                        {cn.proxy_pattern === "non_proxy" && (
                          <span className="text-[8.5px] uppercase tracking-wider text-emerald-300 bg-emerald-500/10 px-1 py-0.5 rounded">immutable</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="font-mono text-white/85 text-[10px] truncate flex-1" title={cn.address}>{cn.address}</div>
                      {xUrl && <ExternalLink className="w-2.5 h-2.5 text-muted-foreground group-hover:text-primary shrink-0" />}
                    </div>
                    {(cn.label || cn.kind) && cn.kind !== "contract" && (
                      <div className="text-[9.5px] text-white/65 mt-0.5 truncate">{cn.label || cn.kind}</div>
                    )}
                    {(cn.owner_address || cn.admin_address) && (
                      <div className="text-muted-foreground/80 mt-1 text-[9.5px] truncate">
                        {cn.owner_address && <>owner <span className="font-mono">{cn.owner_address.slice(0, 6)}…{cn.owner_address.slice(-4)}</span></>}
                        {cn.admin_address && <> · admin <span className="font-mono">{cn.admin_address.slice(0, 6)}…{cn.admin_address.slice(-4)}</span></>}
                      </div>
                    )}
                  </>
                );
                if (xUrl) {
                  return (
                    <a key={i} href={xUrl} target="_blank" rel="noreferrer" className="block rounded border border-white/[0.06] bg-white/[0.02] hover:border-primary/30 hover:bg-white/[0.04] p-2 text-[10.5px] group transition-colors" title={`Open in ${xName}`}>
                      {inner}
                    </a>
                  );
                }
                return (
                  <div key={i} className="rounded border border-white/[0.06] bg-white/[0.02] p-2 text-[10.5px]">
                    {inner}
                  </div>
                );
              })
            )}
            {contracts.length > 30 && (
              <div className="text-[10px] text-muted-foreground/70 text-center pt-1">+{contracts.length - 30} more</div>
            )}
          </div>
        )}
      </div>

      {/* Funding rounds — collapsible */}
      <div className="as-card p-0 overflow-hidden">
        <button type="button" onClick={() => setFundingOpen(v => !v)} className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/[0.02] text-left">
          <Banknote className="w-3.5 h-3.5 text-sky-300 shrink-0" />
          <span className="text-[11px] font-semibold text-white uppercase tracking-wider">Funding rounds</span>
          <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">{funding.length}</span>
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${fundingOpen ? "rotate-0" : "-rotate-90"}`} />
        </button>
        {fundingOpen && (
          <div className="border-t border-white/[0.04] divide-y divide-white/[0.04] max-h-[360px] overflow-y-auto">
            {funding.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-muted-foreground italic">No funding rounds on file.</div>
            ) : (
              funding.slice(0, 20).map((f: any, i: number) => (
                <div key={i} className="px-3 py-2 text-[11px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-white font-semibold tabular-nums">{compactUsd(f.amount_usd)}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">{f.date || "—"}</span>
                  </div>
                  <div className="text-[10.5px] text-muted-foreground mt-0.5 truncate">
                    {f.round_type || "Round"}
                    {f.lead_investors && (Array.isArray(f.lead_investors) ? f.lead_investors.length > 0 : f.lead_investors) && (
                      <> · led by {Array.isArray(f.lead_investors) ? f.lead_investors.join(", ") : f.lead_investors}</>
                    )}
                  </div>
                  {f.announcement_url && (
                    <a href={f.announcement_url} target="_blank" rel="noreferrer" className="text-[10px] text-primary hover:underline inline-flex items-center gap-1 mt-0.5">
                      <ExternalLink className="w-2.5 h-2.5" /> announcement
                    </a>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Governance pulse — collapsible, only if data exists */}
      {governance.length > 0 && (
        <div className="as-card p-0 overflow-hidden">
          <button type="button" onClick={() => setGovernanceOpen(v => !v)} className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/[0.02] text-left">
            <Vote className="w-3.5 h-3.5 text-violet-300 shrink-0" />
            <span className="text-[11px] font-semibold text-white uppercase tracking-wider">Governance pulse</span>
            <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">{governance.length}</span>
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${governanceOpen ? "rotate-0" : "-rotate-90"}`} />
          </button>
          {governanceOpen && (
            <div className="border-t border-white/[0.04] divide-y divide-white/[0.04] max-h-[360px] overflow-y-auto">
              {governance.slice(0, 12).map((p: any) => (
                <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block px-3 py-2 hover:bg-white/[0.02] text-[10.5px]">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`text-[8.5px] uppercase tracking-wider px-1 py-0.5 rounded border ${
                      p.state === "active" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" :
                      p.state === "closed" ? "border-white/[0.08] bg-white/[0.04] text-muted-foreground" :
                      "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    }`}>{p.state}</span>
                    <span className="text-[9.5px] text-muted-foreground tabular-nums ml-auto">{p.votes_count ?? 0} votes</span>
                  </div>
                  <div className="text-white/90 line-clamp-2 leading-snug">{p.title}</div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* News & sentiment — collapsible */}
      {news.length > 0 && (
        <div className="as-card p-0 overflow-hidden">
          <button type="button" onClick={() => setNewsOpen(v => !v)} className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/[0.02] text-left">
            <Activity className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span className="text-[11px] font-semibold text-white uppercase tracking-wider">News & sentiment</span>
            <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">{news.length}</span>
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${newsOpen ? "rotate-0" : "-rotate-90"}`} />
          </button>
          {newsOpen && (
            <div className="border-t border-white/[0.04] divide-y divide-white/[0.04] max-h-[420px] overflow-y-auto">
              {news.slice(0, 15).map((n: any, i: number) => {
                const sc = n.sentiment === "positive" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                  : n.sentiment === "negative" ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
                  : n.sentiment === "mixed" ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                  : "bg-white/[0.04] text-muted-foreground border-white/[0.06]";
                return (
                  <a key={i} href={n.url} target="_blank" rel="noreferrer" className="block px-3 py-2 hover:bg-white/[0.02] text-[10.5px]">
                    <div className="flex items-start gap-1.5">
                      {n.sentiment && <span className={`text-[8.5px] uppercase tracking-wider px-1 py-0.5 rounded border ${sc} shrink-0 mt-0.5`}>{n.sentiment === "positive" ? "+" : n.sentiment === "negative" ? "−" : "~"}</span>}
                      <div className="flex-1 min-w-0">
                        <div className="text-white/90 line-clamp-2 leading-snug">{n.title}</div>
                        <div className="text-[9.5px] text-muted-foreground/80 mt-0.5">{n.source}{n.published_at && <> · {daysAgo(n.published_at)}</>}</div>
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* GitHub — collapsible, only if links exist */}
      {githubLinks.length > 0 && (
        <div className="as-card p-0 overflow-hidden">
          <button type="button" onClick={() => setGithubOpen(v => !v)} className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/[0.02] text-left">
            <Github className="w-3.5 h-3.5 text-white shrink-0" />
            <span className="text-[11px] font-semibold text-white uppercase tracking-wider">GitHub</span>
            <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">{githubLinks.length}</span>
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${githubOpen ? "rotate-0" : "-rotate-90"}`} />
          </button>
          {githubOpen && (
            <div className="border-t border-white/[0.04] divide-y divide-white/[0.04]">
              {githubLinks.map((g: string, i: number) => {
                let display = g;
                try { display = new URL(g).pathname.replace(/^\//, "").replace(/\/$/, ""); } catch { /* ignore */ }
                return (
                  <a key={i} href={g} target="_blank" rel="noreferrer" className="block px-3 py-2 hover:bg-white/[0.02] text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white/90 font-mono truncate">{display || g}</span>
                      <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
                    </div>
                  </a>
                );
              })}
              <div className="px-3 py-2 text-[10px] text-muted-foreground italic">
                Commit activity polling coming soon — for now, links jump to GitHub.
              </div>
            </div>
          )}
        </div>
      )}

      {/* People — collapsible, lazy-loaded */}
      <div className="as-card p-0 overflow-hidden">
        <button type="button" onClick={() => setPeopleOpen(v => !v)} className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/[0.02] text-left">
          <Users className="w-3.5 h-3.5 text-sky-300 shrink-0" />
          <span className="text-[11px] font-semibold text-white uppercase tracking-wider">People</span>
          {peopleQ.data && <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">{peopleQ.data.length}</span>}
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${peopleOpen ? "rotate-0" : "-rotate-90"} ${!peopleQ.data ? "ml-auto" : ""}`} />
        </button>
        {peopleOpen && (
          <div className="border-t border-white/[0.04]">
            {peopleQ.isLoading ? (
              <div className="px-3 py-3 text-[11px] text-muted-foreground italic">Loading people…</div>
            ) : (peopleQ.data ?? []).length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-muted-foreground italic">No people on file. <Link to="/profile" className="text-primary hover:underline">Add manually</Link> or use the "Find people" tool.</div>
            ) : (
              <div className="divide-y divide-white/[0.04] max-h-[420px] overflow-y-auto">
                {(peopleQ.data ?? []).map((p: any) => (
                  <div key={p.id} className="px-3 py-2 text-[10.5px]">
                    <div className="flex items-center gap-1.5">
                      <span className="text-white font-medium truncate">{p.name || "Unknown"}</span>
                      {p.is_decision_maker && <span className="text-[8.5px] uppercase tracking-wider px-1 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">DM</span>}
                    </div>
                    {p.title && <div className="text-[10px] text-muted-foreground truncate">{p.title}</div>}
                    <div className="flex items-center gap-2 mt-1">
                      {p.linkedin && <a href={p.linkedin} target="_blank" rel="noreferrer" className="text-[9.5px] text-primary hover:underline">LinkedIn</a>}
                      {p.twitter && <a href={p.twitter} target="_blank" rel="noreferrer" className="text-[9.5px] text-primary hover:underline">X</a>}
                      {p.github && <a href={p.github} target="_blank" rel="noreferrer" className="text-[9.5px] text-primary hover:underline">GitHub</a>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hack history — collapsible, open by default if hacks exist */}
      {hacks.length > 0 && (
        <div className="as-card p-0 overflow-hidden border-rose-500/20">
          <button type="button" onClick={() => setHacksOpen(v => !v)} className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/[0.02] text-left">
            <Skull className="w-3.5 h-3.5 text-rose-300 shrink-0" />
            <span className="text-[11px] font-semibold text-rose-200 uppercase tracking-wider">Hack history</span>
            <span className="text-[10px] text-rose-300 ml-auto tabular-nums">{hacks.length}</span>
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${hacksOpen ? "rotate-0" : "-rotate-90"}`} />
          </button>
          {hacksOpen && (
            <div className="border-t border-white/[0.04] divide-y divide-white/[0.04] max-h-[360px] overflow-y-auto">
              {hacks.map((h: any, i: number) => (
                <div key={i} className="px-3 py-2 text-[10.5px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-rose-300 font-semibold tabular-nums">{compactUsd(h.amount_usd)}</span>
                    <span className="text-[9.5px] text-muted-foreground tabular-nums">{h.hack_date}</span>
                  </div>
                  <div className="text-white/90 mt-0.5 line-clamp-1">{h.name}</div>
                  {(h.classification || h.technique) && (
                    <div className="text-[9.5px] text-muted-foreground/80 mt-0.5 truncate">{h.classification}{h.technique ? ` · ${h.technique}` : ""}</div>
                  )}
                  {h.source_url && (
                    <a href={h.source_url} target="_blank" rel="noreferrer" className="text-[9.5px] text-primary hover:underline inline-flex items-center gap-1 mt-0.5">
                      <ExternalLink className="w-2.5 h-2.5" /> details
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-white/85 truncate">{value}</dd>
    </div>
  );
}

function Loading() {
  return (
    <div className="max-w-md mx-auto py-16 text-center">
      <RefreshCw className="w-6 h-6 animate-spin text-primary mx-auto" />
      <div className="text-sm text-muted-foreground mt-4">Loading protocol dossier…</div>
    </div>
  );
}

function NotFound({ slug }: { slug: string | undefined }) {
  return (
    <div className="max-w-md mx-auto py-16 text-center">
      <div className="text-base text-white">Protocol not found</div>
      <div className="text-xs text-muted-foreground mt-2">slug: {slug}</div>
      <Link to="/dashboard" className="as-btn as-btn-primary inline-flex mt-4">Back to dashboard</Link>
    </div>
  );
}

function BigRiskBadge({ score, band, coverage }: { score: number; band: string; coverage: number }) {
  const colors: Record<string, string> = {
    low: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300",
    medium: "border-amber-500/30 bg-amber-500/[0.06] text-amber-300",
    high: "border-orange-500/40 bg-orange-500/[0.08] text-orange-300",
    critical: "border-rose-500/50 bg-rose-500/[0.10] text-rose-200",
  };
  const cls = colors[band] || colors.medium;
  return (
    <div className={`rounded-xl border px-5 py-3 text-center min-w-[140px] ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">Risk score</div>
      <div className="text-4xl font-bold tabular-nums leading-tight mt-0.5">{score}</div>
      <div className="text-[10px] uppercase tracking-wider mt-0.5 font-semibold">{band}</div>
      <div className="text-[9px] text-muted-foreground mt-1">coverage {coverage}%</div>
    </div>
  );
}
function UnscoredBadge() {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-3 text-center">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Risk score</div>
      <div className="text-3xl font-bold text-muted-foreground/60 mt-0.5">—</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">not yet computed</div>
    </div>
  );
}

function Stat({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint?: string; tone?: "neutral" | "good" | "warn" | "alert" }) {
  const cls = ({
    neutral: "border-white/[0.06] bg-white/[0.02] text-white",
    good: "border-emerald-500/25 bg-emerald-500/[0.04] text-emerald-200",
    warn: "border-amber-500/30 bg-amber-500/[0.05] text-amber-200",
    alert: "border-rose-500/30 bg-rose-500/[0.06] text-rose-200",
  } as Record<string, string>)[tone];
  return (
    <div className={`rounded-lg border px-3 py-3 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-1">{value}</div>
      {hint && <div className="text-[11px] opacity-70 mt-0.5 truncate">{hint}</div>}
    </div>
  );
}

function SectionCard({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: number | null; children: React.ReactNode }) {
  return (
    <div className="as-card p-0 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-2">
        {icon}
        <h3 className="text-xs font-semibold text-white uppercase tracking-wider">{title}</h3>
        {count != null && <span className="text-[10px] text-muted-foreground ml-auto">{count}</span>}
      </div>
      {children}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="px-4 py-6 text-center text-xs text-muted-foreground italic">{msg}</div>;
}

function RiskLandscapeBrief({
  brief, sections, headline, rating, confidence, generatedAt, loading, refreshing, onRefresh, protocolName,
}: {
  brief: string | null;
  sections: Record<string, string> | null;
  headline: string | null;
  rating: string | null;
  confidence: string | null;
  generatedAt: string | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  protocolName: string;
}) {
  const navigate = useNavigate();
  const ratingTone =
    rating === "strong" ? "border-emerald-500/30 bg-emerald-500/[0.05] text-emerald-200" :
    rating === "solid" ? "border-sky-500/25 bg-sky-500/[0.04] text-sky-200" :
    rating === "concerning" ? "border-amber-500/30 bg-amber-500/[0.05] text-amber-200" :
    rating === "weak" ? "border-orange-500/30 bg-orange-500/[0.05] text-orange-200" :
    rating === "critical" ? "border-rose-500/40 bg-rose-500/[0.07] text-rose-200" :
    "border-white/[0.08] bg-white/[0.02] text-muted-foreground";

  const ageDays = generatedAt ? Math.floor((Date.now() - new Date(generatedAt).getTime()) / 86400000) : null;

  if (loading) {
    return (
      <div className="as-card p-6 text-center text-xs text-muted-foreground">
        Loading risk landscape brief…
      </div>
    );
  }

  if (!brief) {
    return (
      <div className="as-card p-6 border-primary/15 bg-gradient-to-br from-primary/[0.04] to-secondary/[0.02]">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="rounded-lg bg-primary/15 border border-primary/30 p-2">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-white tracking-tight">Risk landscape brief</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Generate an analyst memo for {protocolName} — what they do, their security posture, current risks worth tracking.</p>
          </div>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="text-xs px-3 py-1.5 rounded-md bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            {refreshing ? "Generating…" : <><Sparkles className="w-3 h-3" /> Generate brief</>}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="as-card p-6 border-primary/15 bg-gradient-to-br from-primary/[0.03] to-transparent">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="rounded-md bg-primary/15 border border-primary/30 p-1.5">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
        </div>
        <h2 className="text-sm font-semibold text-white tracking-tight">Risk landscape brief</h2>
        {rating && (
          <span className={`text-[10px] uppercase tracking-[0.1em] font-bold px-2 py-0.5 rounded border ${ratingTone}`}>
            posture: {rating}
          </span>
        )}
        {confidence && (
          <span
            className={`text-[10px] uppercase tracking-[0.1em] font-medium px-2 py-0.5 rounded border ${
              confidence === "high" ? "border-emerald-500/30 bg-emerald-500/[0.04] text-emerald-200" :
              confidence === "medium" ? "border-amber-500/30 bg-amber-500/[0.05] text-amber-200" :
              "border-rose-500/30 bg-rose-500/[0.05] text-rose-200"
            }`}
            title="Overall confidence in the underlying data — high = mostly verified, low = mostly inferred or sparse"
          >
            data: {confidence}
          </span>
        )}
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground">
          generated {ageDays != null ? (ageDays < 1 ? "today" : ageDays === 1 ? "yesterday" : `${ageDays}d ago`) : "—"}
        </span>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          title="Regenerate brief with latest data"
          className="text-[11px] px-2 py-1 rounded border border-white/[0.08] hover:border-primary/40 hover:bg-white/[0.03] text-muted-foreground hover:text-white inline-flex items-center gap-1 disabled:opacity-40"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      {headline && (
        <div className="text-[15px] font-semibold text-white mb-4 leading-snug">
          {headline}
        </div>
      )}
      {sections && Object.keys(sections).length > 0 ? (
        <div className="space-y-4">
          {sections.overview && <BriefSection label="Overview" body={sections.overview} />}
          {sections.sector_risk && <BriefSection label="Sector risk class" body={sections.sector_risk} />}
          {sections.audit_posture && <BriefSection label="Audit posture" body={sections.audit_posture} />}
          {sections.findings && <BriefSection label="Findings picture" body={sections.findings} />}
          {sections.controls && <BriefSection label="Controls (bounty · multisig · oracle)" body={sections.controls} />}
          {sections.events && <BriefSection label="Past events" body={sections.events} />}
          {sections.watch && <BriefSection label="What to watch" body={sections.watch} accent />}
        </div>
      ) : (
        <p className="text-[14px] text-white/85 leading-relaxed">{brief}</p>
      )}

      <div className="text-[10px] text-muted-foreground/70 mt-5 italic">
        Generated by Claude Haiku 4.5 from indexed audits · findings · multisig · oracles · hacks · economics. Cached 15 days, refresh after material changes. Not financial advice.
      </div>
    </div>
  );
}

function BriefSection({ label, body, accent }: { label: string; body: string; accent?: boolean }) {
  return (
    <div className={accent ? "border-l-2 border-primary/40 pl-3" : "border-l-2 border-white/[0.08] pl-3"}>
      <div className={`text-[10px] uppercase tracking-[0.1em] font-bold mb-1 ${accent ? "text-primary/90" : "text-muted-foreground"}`}>{label}</div>
      <p className="text-[13.5px] text-white/85 leading-relaxed">{body}</p>
    </div>
  );
}

function FindingsSection({ findings }: { findings: any[] }) {
  const total = findings.length;
  const byStatus = new Map<string, number>();
  for (const f of findings) {
    const s = (f.status || "open").toLowerCase();
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
  }
  const fixed = byStatus.get("fixed") ?? 0;
  const ack = byStatus.get("acknowledged") ?? 0;
  const open = total - fixed - ack;
  const fixRate = total > 0 ? (fixed / total) * 100 : null;

  const criticals = findings.filter(f => (f.severity || "").toLowerCase() === "critical");
  const highs = findings.filter(f => (f.severity || "").toLowerCase() === "high");
  const unresolvedCritical = criticals.filter(f => !["fixed", "resolved", "remediated"].includes((f.status || "open").toLowerCase()));

  let verdict: { tone: "good" | "warn" | "alert"; text: string } | null = null;
  if (total === 0) {
    verdict = { tone: "good", text: "No individual findings parsed yet — could mean clean reports or extraction pending." };
  } else if (unresolvedCritical.length > 0) {
    verdict = { tone: "alert", text: `${unresolvedCritical.length} critical finding${unresolvedCritical.length === 1 ? "" : "s"} unresolved. Open the audit report to verify fix status.` };
  } else if (fixRate != null && fixRate >= 80) {
    verdict = { tone: "good", text: `Strong remediation posture — ${fixRate.toFixed(0)}% of findings marked fixed.` };
  } else if (ack > fixed && ack >= 3) {
    verdict = { tone: "warn", text: `${ack} findings acknowledged but not yet fixed — track whether they ship patches.` };
  } else {
    verdict = { tone: "warn", text: `${open} open · ${ack} acknowledged · ${fixed} fixed. Average remediation discipline.` };
  }

  return (
    <SectionCard
      icon={<AlertTriangle className="w-4 h-4 text-rose-300" />}
      title="Top findings"
      count={total}
    >
      {total === 0 ? (
        <Empty msg="No individual findings parsed yet." />
      ) : (
        <>
          {verdict && (
            <div className={`px-4 py-2.5 text-[12px] leading-relaxed border-b ${
              verdict.tone === "alert" ? "bg-rose-500/[0.04] border-rose-500/15 text-rose-200" :
              verdict.tone === "warn" ? "bg-amber-500/[0.04] border-amber-500/15 text-amber-200" :
              "bg-emerald-500/[0.03] border-emerald-500/15 text-emerald-200"
            }`}>
              <span className="font-bold text-[10px] uppercase tracking-wider mr-2 opacity-70">verdict</span>
              {verdict.text}
              <span className="text-[10px] text-muted-foreground ml-2">
                · {criticals.length}C · {highs.length}H · {fixed} fixed / {ack} ack'd / {open} open
              </span>
            </div>
          )}
          <div className="divide-y divide-white/[0.04]">
            {findings.slice(0, 12).map((f, i) => {
              const status = (f.status || "open").toLowerCase();
              const interp =
                status === "fixed" || status === "resolved" || status === "remediated" ? { txt: "fixed", tone: "good" } :
                status === "acknowledged" ? { txt: "acknowledged · not patched", tone: "warn" } :
                status === "won't fix" || status === "wontfix" ? { txt: "won't fix", tone: "warn" } :
                  { txt: "open · unresolved", tone: "alert" };
              return (
                <div key={i} className="px-4 py-2.5 flex items-start gap-2">
                  <SevPill sev={f.severity} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white/90">{f.title}</div>
                    {f.summary && <div className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">{f.summary}</div>}
                  </div>
                  <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 ${
                    interp.tone === "good" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" :
                    interp.tone === "warn" ? "border-amber-500/30 bg-amber-500/10 text-amber-200" :
                    "border-rose-500/30 bg-rose-500/10 text-rose-200"
                  }`}>
                    {interp.txt}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </SectionCard>
  );
}

function AuditPosture({ company, audits, sector }: {
  company: any;
  audits: any[];
  sector: null | { category: string; n_protocols: number; audited_pct: number; median_audit_count: number; median_audits_1y: number; median_unique_firms: number; p75_audit_count: number; avg_days_since_audit: number };
}) {
  // Compute the protocol's own audit signals
  const auditedAudits = audits.filter(a => !!a.audit_firm);
  const totalAudits = auditedAudits.length;
  const firms = Array.from(new Set(auditedAudits.map(a => (a.audit_firm || "").trim()).filter(Boolean)));
  const uniqueFirms = firms.length;

  // Firm frequency
  const firmCounts = new Map<string, number>();
  for (const a of auditedAudits) {
    const f = (a.audit_firm || "").trim();
    if (!f) continue;
    firmCounts.set(f, (firmCounts.get(f) ?? 0) + 1);
  }
  const topFirms = Array.from(firmCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const datedAudits = auditedAudits.filter(a => !!a.audit_date).sort((a, b) => (b.audit_date as string).localeCompare(a.audit_date as string));
  const latest = datedAudits[0]?.audit_date as string | undefined;
  const oldest = datedAudits[datedAudits.length - 1]?.audit_date as string | undefined;
  const daysSinceLatest = latest ? Math.floor((Date.now() - new Date(latest).getTime()) / 86400000) : null;
  const audits1y = datedAudits.filter(a => {
    const d = new Date(a.audit_date as string).getTime();
    return Date.now() - d <= 365 * 86400000;
  }).length;
  const audits2y = datedAudits.filter(a => {
    const d = new Date(a.audit_date as string).getTime();
    return Date.now() - d <= 730 * 86400000;
  }).length;

  // Posture vs sector
  const sectorMedian = sector?.median_audit_count ?? 0;
  const sectorP75 = sector?.p75_audit_count ?? 0;
  const sectorMedian1y = sector?.median_audits_1y ?? 0;
  const sectorMedianFirms = sector?.median_unique_firms ?? 0;

  type Posture = "elite" | "above" | "at_median" | "below" | "absent";
  let postureLabel: Posture = "at_median";
  if (totalAudits === 0) postureLabel = "absent";
  else if (totalAudits >= sectorP75 && audits1y >= 1) postureLabel = "elite";
  else if (totalAudits > sectorMedian) postureLabel = "above";
  else if (totalAudits < sectorMedian) postureLabel = "below";

  // Firm strategy
  const repeatRatio = totalAudits > 0 ? (totalAudits - uniqueFirms) / totalAudits : 0;
  const firmStrategy: "single" | "loyal" | "rotating" | "shopping" =
    uniqueFirms === 0 ? "single" :
    uniqueFirms === 1 ? "single" :
    repeatRatio >= 0.5 ? "loyal" :
    uniqueFirms <= 3 ? "rotating" : "shopping";

  // Cadence: time between most recent two audits
  const cadenceDays = (() => {
    if (datedAudits.length < 2) return null;
    const a = new Date(datedAudits[0].audit_date as string).getTime();
    const b = new Date(datedAudits[1].audit_date as string).getTime();
    return Math.floor((a - b) / 86400000);
  })();

  // Findings interpretation
  const extractedAudits = audits.filter(a => a.findings_extraction_status === "extracted");
  const auditsWithCritical = extractedAudits.filter(a => (a.findings_critical ?? 0) > 0).length;
  const criticalRate = extractedAudits.length > 0 ? (auditsWithCritical / extractedAudits.length) * 100 : null;
  const totalCriticals = audits.reduce((s, a) => s + (a.findings_critical ?? 0), 0);
  const totalHighs = audits.reduce((s, a) => s + (a.findings_high ?? 0), 0);

  // Compose verdict line
  const buildVerdict = (): { tone: "good" | "warn" | "alert"; text: string } => {
    if (totalAudits === 0) {
      return { tone: "alert", text: `${company.name} has no audits on file. ${sector ? `${sector.audited_pct?.toFixed(0)}% of ${sector.category} category is audited at all.` : ""} Significant operational risk.` };
    }
    const sectorTake = sector
      ? totalAudits >= sectorP75 ? `top 25% of ${sector.category} (median is ${sectorMedian}).`
      : totalAudits > sectorMedian ? `above ${sector.category} median (${sectorMedian}).`
      : totalAudits === sectorMedian ? `in line with ${sector.category} median.`
      : `below ${sector.category} median (${sectorMedian}).`
      : "";
    const staleness = daysSinceLatest == null ? "" :
      daysSinceLatest <= 90 ? "Recently audited." :
      daysSinceLatest <= 365 ? `Last audit ${Math.floor(daysSinceLatest / 30)}mo ago — acceptable.` :
      daysSinceLatest <= 730 ? `Last audit ${Math.floor(daysSinceLatest / 30)}mo ago — getting stale.` :
      `Last audit ${Math.floor(daysSinceLatest / 365)}y ago — outdated.`;
    const firmStrat =
      firmStrategy === "single" ? "Single auditor (no second opinion)." :
      firmStrategy === "loyal" ? `Repeat engagement with ${topFirms[0]?.[0]} — high familiarity, low rotation.` :
      firmStrategy === "rotating" ? `Rotating ${uniqueFirms} firms — healthy second-opinion practice.` :
      `Diversified across ${uniqueFirms} firms — broad coverage.`;
    const findingsTake = criticalRate == null ? "" :
      criticalRate >= 50 ? `${criticalRate.toFixed(0)}% of audits found criticals — pattern of recurring issues.` :
      criticalRate >= 20 ? `${criticalRate.toFixed(0)}% of audits surfaced criticals.` :
      "Few criticals across audits — clean code history.";
    const text = `${totalAudits} audit${totalAudits === 1 ? "" : "s"} across ${uniqueFirms} firm${uniqueFirms === 1 ? "" : "s"}, ${sectorTake} ${staleness} ${firmStrat} ${findingsTake}`.trim();
    const tone: "good" | "warn" | "alert" =
      postureLabel === "elite" || postureLabel === "above" ? "good" :
      postureLabel === "absent" || (daysSinceLatest && daysSinceLatest > 730) ? "alert" :
      "warn";
    return { tone, text };
  };

  const verdict = buildVerdict();

  // Should-they-audit-more rubric
  const shouldAuditMore = (() => {
    if (totalAudits === 0) return { yes: true, reason: "no audits on file" };
    if (daysSinceLatest != null && daysSinceLatest > 365) return { yes: true, reason: `${Math.floor(daysSinceLatest / 30)} months since last audit` };
    if (sectorP75 > 0 && totalAudits < sectorMedian) return { yes: true, reason: `below ${sector?.category} median` };
    if (uniqueFirms === 1 && totalAudits >= 3) return { yes: true, reason: "no second-opinion firm yet" };
    return { yes: false, reason: postureLabel === "elite" ? "elite posture — coverage is strong" : "posture is acceptable" };
  })();

  const toneCls = ({ good: "border-emerald-500/25 bg-emerald-500/[0.04]", warn: "border-amber-500/30 bg-amber-500/[0.05]", alert: "border-rose-500/30 bg-rose-500/[0.06]" } as Record<string, string>)[verdict.tone];
  const toneText = ({ good: "text-emerald-200", warn: "text-amber-200", alert: "text-rose-200" } as Record<string, string>)[verdict.tone];

  return (
    <div className="as-card p-5 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <ShieldCheck className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-white">Audit posture analysis</h2>
        <span className="text-[10px] text-muted-foreground ml-auto">interpretation · what these numbers mean</span>
      </div>

      {/* Headline verdict */}
      <div className={`rounded-lg border ${toneCls} p-4`}>
        <div className="flex items-start gap-3">
          <div className={`text-[10px] uppercase tracking-[0.08em] font-bold ${toneText} shrink-0 mt-0.5`}>
            {postureLabel === "elite" ? "Elite" : postureLabel === "above" ? "Above-median" : postureLabel === "at_median" ? "Median" : postureLabel === "below" ? "Below-median" : "Absent"}
          </div>
          <p className={`text-[13.5px] ${toneText} leading-relaxed flex-1`}>{verdict.text}</p>
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground flex items-center gap-2">
          <span className="font-bold opacity-80">Should they audit more?</span>
          <span className={shouldAuditMore.yes ? "text-amber-300" : "text-emerald-300"}>
            {shouldAuditMore.yes ? "Yes" : "No"} — {shouldAuditMore.reason}
          </span>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <PostureMini label="Total audits" value={totalAudits.toString()} sub={sector ? `vs ${sector.category} median ${sectorMedian}` : ""} />
        <PostureMini label="Unique firms" value={uniqueFirms.toString()} sub={sector ? `vs median ${sectorMedianFirms}` : ""} />
        <PostureMini label="Audits last 12mo" value={audits1y.toString()} sub={sector ? `vs median ${sectorMedian1y}` : ""} />
        <PostureMini label="Audits last 24mo" value={audits2y.toString()} sub="pace check" />
        <PostureMini label="Last audit" value={daysSinceLatest != null ? `${daysSinceLatest}d` : "—"} sub={latest || "no record"} tone={daysSinceLatest == null ? "alert" : daysSinceLatest > 365 ? "warn" : "good"} />
        <PostureMini label="Critical hit rate" value={criticalRate != null ? `${criticalRate.toFixed(0)}%` : "—"} sub={`${totalCriticals}C ${totalHighs}H total`} tone={criticalRate != null && criticalRate > 30 ? "warn" : "good"} />
      </div>

      {/* Who they use */}
      {topFirms.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.08em] font-bold text-white/80 mb-2">Who audits this protocol</div>
          <div className="flex flex-wrap gap-2">
            {topFirms.map(([firm, count]) => (
              <Link key={firm} to={`/auditors/${encodeURIComponent(firm.toLowerCase())}`} className="inline-flex items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 hover:border-primary/40">
                <BrandLogo name={firm} className="w-5 h-5 rounded shrink-0" />
                <div>
                  <div className="text-[12.5px] text-white">{firm}</div>
                  <div className="text-[10px] text-muted-foreground">{count} audit{count === 1 ? "" : "s"}</div>
                </div>
              </Link>
            ))}
          </div>
          <div className="text-[11px] text-muted-foreground mt-2.5 flex items-center gap-2 flex-wrap">
            <span className="opacity-80">Firm strategy:</span>
            <span className={
              firmStrategy === "single" ? "text-amber-300" :
              firmStrategy === "loyal" ? "text-white/85" :
              firmStrategy === "rotating" ? "text-emerald-300" :
              "text-emerald-300"
            }>
              {firmStrategy === "single" ? "Single firm — no second opinion" :
                firmStrategy === "loyal" ? `Repeat engagement (${(repeatRatio * 100).toFixed(0)}% repeat rate)` :
                firmStrategy === "rotating" ? `Healthy rotation across ${uniqueFirms} firms` :
                `Diversified across ${uniqueFirms} firms`}
            </span>
            {cadenceDays != null && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span>Cadence: ~{Math.round(cadenceDays)}d between recent audits</span>
              </>
            )}
            {oldest && oldest !== latest && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span>Coverage span: {oldest} → {latest}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PostureMini({ label, value, sub, tone = "neutral" }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "alert" | "neutral" }) {
  const cls = ({
    good: "border-emerald-500/20 bg-emerald-500/[0.03]",
    warn: "border-amber-500/25 bg-amber-500/[0.04]",
    alert: "border-rose-500/30 bg-rose-500/[0.05]",
    neutral: "border-white/[0.06] bg-white/[0.02]",
  } as Record<string, string>)[tone];
  return (
    <div className={`rounded-md border px-3 py-2.5 ${cls}`}>
      <div className="text-[9px] uppercase tracking-[0.08em] font-medium text-muted-foreground/90">{label}</div>
      <div className="text-[20px] leading-none font-bold tabular-nums mt-1.5 text-white">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground/70 mt-1 line-clamp-1">{sub}</div>}
    </div>
  );
}

function EcoTile({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint?: string; tone?: "neutral" | "good" | "warn" | "alert" }) {
  const cls = ({
    neutral: "border-white/[0.06] bg-white/[0.02] text-white",
    good: "border-emerald-500/25 bg-emerald-500/[0.04] text-emerald-200",
    warn: "border-amber-500/30 bg-amber-500/[0.05] text-amber-200",
    alert: "border-rose-500/30 bg-rose-500/[0.06] text-rose-200",
  } as Record<string, string>)[tone];
  return (
    <div className={`rounded-md border px-3 py-2.5 ${cls}`}>
      <div className="text-[9px] uppercase tracking-[0.08em] font-medium opacity-90">{label}</div>
      <div className="text-[20px] leading-none font-bold tabular-nums mt-1.5">{value}</div>
      {hint && <div className="text-[10px] opacity-70 mt-1">{hint}</div>}
    </div>
  );
}

function NotesAndTags({ slug, userId, notes, tags, onChange }: {
  slug: string; userId: string;
  notes: Array<{ id: string; body: string; pinned: boolean; created_at: string }>;
  tags: Array<{ id: string; tag: string }>;
  onChange: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const addNote = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    await supabase.from("protocol_notes").insert({ user_id: userId, company_slug: slug, body: draft.trim() });
    setDraft("");
    setBusy(false);
    onChange();
  };
  const togglePin = async (id: string, pinned: boolean) => {
    await supabase.from("protocol_notes").update({ pinned: !pinned }).eq("id", id);
    onChange();
  };
  const delNote = async (id: string) => {
    await supabase.from("protocol_notes").delete().eq("id", id);
    onChange();
  };
  const addTag = async () => {
    const t = tagDraft.trim().toLowerCase();
    if (!t) return;
    await supabase.from("protocol_tags").insert({ user_id: userId, company_slug: slug, tag: t });
    setTagDraft("");
    onChange();
  };
  const delTag = async (id: string) => {
    await supabase.from("protocol_tags").delete().eq("id", id);
    onChange();
  };

  return (
    <div className="as-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Pencil className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-white">Your notes & tags</h2>
        <span className="text-[11px] text-muted-foreground ml-auto">private to your account</span>
      </div>

      {/* Tags row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        {tags.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30">
            {t.tag}
            <button onClick={() => delTag(t.id)} className="text-primary/60 hover:text-rose-300"><Trash2 className="w-2.5 h-2.5" /></button>
          </span>
        ))}
        <div className="inline-flex items-center gap-1">
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
            placeholder="add tag…"
            className="as-input text-[11px] py-1 px-2 w-24"
          />
          {tagDraft.trim() && (
            <button onClick={addTag} className="text-primary/80 hover:text-primary"><Plus className="w-3 h-3" /></button>
          )}
        </div>
      </div>

      {/* Add note */}
      <div className="flex gap-2 items-start">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Drop a thesis, observation, or follow-up to remember…"
          className="as-input text-xs flex-1 min-h-[60px]"
          rows={2}
        />
        <button
          onClick={addNote}
          disabled={!draft.trim() || busy}
          className="text-[11px] px-3 py-1.5 rounded bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 disabled:opacity-40"
        >
          Save note
        </button>
      </div>

      {/* Notes list */}
      {notes.length > 0 && (
        <div className="space-y-1.5">
          {notes.map((n) => (
            <div key={n.id} className={`rounded-md border px-3 py-2 ${n.pinned ? "border-primary/30 bg-primary/[0.04]" : "border-white/[0.05] bg-white/[0.015]"}`}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0 text-[13px] text-white/90 whitespace-pre-wrap">{n.body}</div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => togglePin(n.id, n.pinned)} className={n.pinned ? "text-primary" : "text-muted-foreground hover:text-white"}><Pin className="w-3 h-3" /></button>
                  <button onClick={() => delNote(n.id)} className="text-muted-foreground hover:text-rose-300"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ContractIntelligence({
  category, pattern, contracts, peerHacks, lastAudit, lastAuditFirm, hasBounty, bountyDetails, auditCount, uniqueAuditorCount,
  selfChains, selfTvl, selfProxyCount,
}: {
  category: string | null;
  pattern: null | {
    category: string; pattern_name: string; description: string;
    common_risks: Array<{ risk: string; severity: string; mitigation: string }>;
    known_exploits: Array<{ protocol: string; year: number; amount_usd: number; technique: string; notes?: string }> | null;
    questions_to_ask: string[] | null;
  };
  contracts: any[];
  peerHacks: Array<{ company_slug: string; name: string; hack_date: string; amount_usd: number; technique: string; returned_funds: number | null; peer: { slug: string; name: string; logo: string | null; url: string | null; audit_count: number | null; unique_auditor_count: number | null; last_audit_date: string | null; has_bug_bounty: boolean } | null; peer_chains: string[]; peer_proxies: number; peer_tvl: number | null }>;
  lastAudit: string | null;
  lastAuditFirm: string | null;
  hasBounty: boolean;
  bountyDetails: any[];
  auditCount: number | null;
  uniqueAuditorCount: number | null;
  selfChains: string[];
  selfTvl: number | null;
  selfProxyCount: number;
}) {
  // Similarity scorer — 0..100. Higher = this protocol looks more like the peer that got hacked.
  const scoreSimilarity = (peer: typeof peerHacks[number]): { score: number; reasons: string[] } => {
    const reasons: string[] = [];
    let score = 30; // baseline: same category match
    reasons.push("same sector");

    // Chain overlap
    if (peer.peer_chains.length > 0 && selfChains.length > 0) {
      const overlap = peer.peer_chains.filter(c => selfChains.includes(c));
      if (overlap.length > 0) {
        score += Math.min(20, overlap.length * 8);
        reasons.push(`shared chain${overlap.length > 1 ? "s" : ""}: ${overlap.slice(0, 2).join(", ")}`);
      }
    }
    // TVL proximity (log10 distance)
    if (selfTvl && peer.peer_tvl) {
      const dist = Math.abs(Math.log10(Math.max(selfTvl, 1)) - Math.log10(Math.max(peer.peer_tvl, 1)));
      if (dist < 0.5) { score += 20; reasons.push("comparable TVL"); }
      else if (dist < 1) { score += 10; reasons.push("similar TVL bucket"); }
    }
    // Audit posture: both light?
    const peerAuditCount = peer.peer?.audit_count ?? 0;
    if (peerAuditCount <= 2 && (auditCount ?? 0) <= 2) {
      score += 12;
      reasons.push("both light on audits");
    }
    // Single-firm coverage
    if ((peer.peer?.unique_auditor_count ?? 0) <= 1 && (uniqueAuditorCount ?? 0) <= 1) {
      score += 8;
      reasons.push("both single-firm audited");
    }
    // No bounty on either side
    if (!peer.peer?.has_bug_bounty && !hasBounty) {
      score += 6;
      reasons.push("neither has bug bounty");
    }
    // Proxy/upgradability
    if (peer.peer_proxies > 0 && selfProxyCount > 0) {
      score += 8;
      reasons.push("both have upgradeable contracts");
    }
    // Recent hack (more relevant)
    if (peer.hack_date) {
      const yearsAgo = (Date.now() - new Date(peer.hack_date).getTime()) / (365 * 86400000);
      if (yearsAgo < 2) score += 6;
    }
    return { score: Math.min(100, Math.round(score)), reasons };
  };

  // Compute scored peers (max 8 ranked by score)
  const scoredPeers = peerHacks
    .map((p) => ({ ...p, _sim: scoreSimilarity(p) }))
    .sort((a, b) => b._sim.score - a._sim.score)
    .slice(0, 8);

  const proxyCount = contracts.filter(c => c.proxy_pattern && c.proxy_pattern !== "non_proxy").length;
  const tokenCount = contracts.filter(c => c.kind === "token").length;
  const chains = Array.from(new Set(contracts.map(c => c.chain).filter(Boolean)));
  const auditAgeDays = lastAudit ? Math.floor((Date.now() - new Date(lastAudit).getTime()) / 86400000) : null;
  const auditCadenceTone =
    auditAgeDays == null ? "alert" :
    auditAgeDays > 365 ? "alert" :
    auditAgeDays > 180 ? "warn" : "good";

  const sortedExploits = (pattern?.known_exploits ?? []).slice().sort((a, b) => (b.amount_usd ?? 0) - (a.amount_usd ?? 0));

  return (
    <div className="as-card p-5 space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <Boxes className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-white">Contract intelligence</h2>
        {category && (
          <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">{category}</span>
        )}
        <span className="text-[11px] text-muted-foreground ml-auto">{contracts.length} addresses · {chains.length} chains</span>
      </div>

      {/* What this protocol is + does */}
      {pattern ? (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="text-[10px] uppercase tracking-[0.08em] font-bold text-primary mb-1.5">What contracts of this kind do</div>
          <div className="text-sm text-white/90 font-medium mb-1">{pattern.pattern_name}</div>
          <div className="text-[12.5px] text-muted-foreground leading-relaxed">{pattern.description}</div>
        </div>
      ) : category ? (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 text-[12px] text-muted-foreground">
          Pattern library not yet populated for category <span className="text-white">{category}</span>. Showing footprint only.
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: Common risks + Posture */}
        <div className="space-y-5">
          {/* Common risks */}
          {pattern && pattern.common_risks.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-300" />
                <div className="text-[10px] uppercase tracking-[0.08em] font-bold text-white">Risks this kind of contract typically faces</div>
              </div>
              <div className="space-y-2">
                {pattern.common_risks.map((r, i) => (
                  <div key={i} className="rounded-md border border-white/[0.05] p-2.5 bg-white/[0.015]">
                    <div className="flex items-start gap-2">
                      <SeverityBadge s={r.severity} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-white/90 font-medium">{r.risk}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 italic"><span className="not-italic text-emerald-300/80">mitigation:</span> {r.mitigation}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Audit cadence + bounty posture */}
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
              <div className="text-[10px] uppercase tracking-[0.08em] font-bold text-white">What they're doing to stay on top</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <PostureCard
                label="Audit cadence"
                tone={auditCadenceTone}
                primary={lastAudit ? `${auditAgeDays}d` : "—"}
                hint={
                  lastAudit
                    ? `last audit ${lastAuditFirm || "unknown"}${auditAgeDays != null ? ` · ${Math.floor(auditAgeDays / 30)}mo ago` : ""}`
                    : "no audit on file"
                }
              />
              <PostureCard
                label="Audit depth"
                tone={(auditCount ?? 0) >= 3 ? "good" : (auditCount ?? 0) >= 1 ? "warn" : "alert"}
                primary={(auditCount ?? 0).toString()}
                hint={`${uniqueAuditorCount ?? 0} unique firm${uniqueAuditorCount === 1 ? "" : "s"}`}
              />
              <PostureCard
                label="Bug bounty"
                tone={hasBounty ? "good" : "alert"}
                primary={hasBounty ? "Live" : "None"}
                hint={
                  hasBounty && bountyDetails[0]?.max_payout_usd
                    ? `max payout $${(bountyDetails[0].max_payout_usd / 1000).toFixed(0)}K · ${bountyDetails[0].platform || "n/a"}`
                    : hasBounty
                      ? "program details unknown"
                      : "no public program"
                }
              />
              <PostureCard
                label="Upgrade risk"
                tone={proxyCount > 0 ? "warn" : "good"}
                primary={proxyCount > 0 ? `${proxyCount} proxy` : "Immutable"}
                hint={proxyCount > 0 ? "admin key can change logic" : "logic frozen"}
              />
            </div>
          </div>
        </div>

        {/* Right: Known exploits in this category + peer hacks */}
        <div className="space-y-5">
          {sortedExploits.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <Skull className="w-3.5 h-3.5 text-rose-300" />
                <div className="text-[10px] uppercase tracking-[0.08em] font-bold text-white">Worst exploits of this kind (reference)</div>
              </div>
              <div className="space-y-1.5">
                {sortedExploits.slice(0, 5).map((e, i) => (
                  <div key={i} className="rounded-md border border-white/[0.05] bg-white/[0.015] px-3 py-2 flex items-center gap-3">
                    <div className="text-[10px] tabular-nums text-muted-foreground w-10 shrink-0">{e.year}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] text-white/90 font-medium truncate">{e.protocol}</div>
                      <div className="text-[10.5px] text-muted-foreground mt-0.5 line-clamp-1">{e.technique}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[12px] tabular-nums font-bold text-rose-300">{compactUsd(e.amount_usd)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {scoredPeers.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
                <div className="text-[10px] uppercase tracking-[0.08em] font-bold text-white">Exploit similarity — peers this protocol resembles</div>
                <span className="text-[10px] text-muted-foreground ml-1">ranked</span>
              </div>
              <div className="space-y-1.5">
                {scoredPeers.slice(0, 5).map((h, i) => (
                  <Link key={i} to={`/protocol/${h.company_slug}`} className="rounded-md border border-white/[0.05] bg-white/[0.015] hover:bg-white/[0.04] px-3 py-2 flex items-center gap-3">
                    <SimChip score={h._sim.score} />
                    <BrandLogo name={h.peer?.name || h.company_slug} url={h.peer?.url} logo={h.peer?.logo} className="w-6 h-6 rounded shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] text-white/90 font-medium truncate">{h.peer?.name || h.company_slug}</div>
                      <div className="text-[10.5px] text-muted-foreground mt-0.5 line-clamp-1">
                        {h.hack_date} · {h.technique || "—"}
                      </div>
                      <div className="text-[10px] text-amber-200/70 mt-0.5 line-clamp-1">
                        {h._sim.reasons.slice(0, 3).join(" · ")}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[12px] tabular-nums font-bold text-rose-300">{compactUsd(Number(h.amount_usd))}</div>
                      {h.returned_funds ? <div className="text-[9px] text-emerald-300">{compactUsd(Number(h.returned_funds))} returned</div> : null}
                    </div>
                  </Link>
                ))}
              </div>
              <div className="text-[10px] text-muted-foreground mt-2 italic">
                Higher score = this protocol matches the peer's risk fingerprint (category, chain, TVL bucket, audit posture). Not a prediction — a pattern call-out.
              </div>
            </div>
          )}

          {pattern?.questions_to_ask && pattern.questions_to_ask.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <div className="text-[10px] uppercase tracking-[0.08em] font-bold text-white">Due-diligence checklist</div>
              </div>
              <div className="rounded-md border border-primary/15 bg-primary/[0.03] p-3 space-y-1.5">
                {pattern.questions_to_ask.map((q: any, i: number) => {
                  const text = typeof q === "string" ? q : (q?.q || q?.question || q?.text || "");
                  if (!text) return null;
                  return (
                    <div key={i} className="text-[12px] text-white/85 flex items-start gap-2">
                      <span className="text-primary/60 text-[10px] mt-0.5">▸</span>
                      <span>{text}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footprint summary at bottom */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 pt-3 border-t border-white/[0.06]">
        <FootprintMini label="Addresses" value={contracts.length.toString()} />
        <FootprintMini label="Tokens" value={tokenCount.toString()} />
        <FootprintMini label="Proxies" value={proxyCount.toString()} tone={proxyCount > 0 ? "warn" : "neutral"} />
        <FootprintMini label="Chains" value={chains.length.toString()} hint={chains.slice(0, 3).join(", ")} />
        <FootprintMini label="Admin keys" value={contracts.filter(c => c.admin_address || c.owner_address).length.toString()} tone="warn" hint="addresses with admin/owner" />
      </div>
    </div>
  );
}

function TokenUnlockCard({ data }: {
  data: { next_unlock_date: string | null; next_unlock_pct_supply: number | null; vesting_kind: string | null; total_vested_remaining_pct: number | null; source: string; source_url: string | null; notes: string | null; updated_at: string };
}) {
  const daysToUnlock = data.next_unlock_date ? Math.ceil((new Date(data.next_unlock_date).getTime() - Date.now()) / 86400000) : null;
  const pct = data.next_unlock_pct_supply;
  const remaining = data.total_vested_remaining_pct;

  const verdict: { tone: "good" | "warn" | "alert"; text: string } = (() => {
    if (remaining != null && remaining < 5) return { tone: "good", text: "Fully circulating — no supply overhang." };
    if (daysToUnlock != null && pct != null && daysToUnlock < 30 && pct >= 2) return { tone: "alert", text: `Major unlock ${daysToUnlock}d out — ${pct.toFixed(1)}% of supply hits market. Expect sell pressure.` };
    if (daysToUnlock != null && daysToUnlock < 30) return { tone: "warn", text: `Unlock in ${daysToUnlock}d. ${pct ? `${pct.toFixed(1)}% of supply.` : "Size not estimated."}` };
    if (remaining != null && remaining > 60) return { tone: "warn", text: `${remaining.toFixed(0)}% of supply still locked. Long-tail dilution risk over coming quarters.` };
    if (daysToUnlock != null) return { tone: "warn", text: `Next unlock ${daysToUnlock}d out. ${pct ? `${pct.toFixed(1)}% of supply.` : ""}` };
    return { tone: "good", text: `${remaining != null ? `${remaining.toFixed(0)}% locked remaining.` : "Vesting schedule logged."} No imminent supply event.` };
  })();

  const toneCls = ({ good: "border-emerald-500/25 bg-emerald-500/[0.04]", warn: "border-amber-500/30 bg-amber-500/[0.05]", alert: "border-rose-500/30 bg-rose-500/[0.06]" } as Record<string, string>)[verdict.tone];
  const toneText = ({ good: "text-emerald-200", warn: "text-amber-200", alert: "text-rose-200" } as Record<string, string>)[verdict.tone];

  return (
    <div className="as-card p-5 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Banknote className="w-4 h-4 text-amber-300" />
        <h2 className="text-sm font-semibold text-white">Token unlocks — supply pressure</h2>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {data.source === "inferred" ? "inferred · verify with docs" : "curated"}
          {data.source_url && <a href={data.source_url} target="_blank" rel="noreferrer" className="ml-1 text-primary hover:underline">source</a>}
        </span>
      </div>
      <div className={`rounded-lg border ${toneCls} p-3 text-[13px] ${toneText} leading-relaxed`}>{verdict.text}</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <PostureMini label="Next unlock" value={data.next_unlock_date || "—"} sub={daysToUnlock != null ? `${daysToUnlock}d away` : "none scheduled"} tone={daysToUnlock != null && daysToUnlock < 30 ? "warn" : "neutral"} />
        <PostureMini label="Size" value={pct != null ? `${pct.toFixed(1)}%` : "—"} sub="of total supply" tone={pct != null && pct > 2 ? "alert" : "neutral"} />
        <PostureMini label="Vesting style" value={data.vesting_kind || "—"} sub="release cadence" />
        <PostureMini label="Still locked" value={remaining != null ? `${remaining.toFixed(0)}%` : "—"} sub="of total supply" tone={remaining != null && remaining > 60 ? "warn" : remaining != null && remaining < 10 ? "good" : "neutral"} />
      </div>
      {data.notes && <div className="text-[11px] text-muted-foreground italic">{data.notes}</div>}
    </div>
  );
}

function MultisigSurveillance({ safes, changes }: {
  safes: Array<{ chain: string; address: string; threshold: number | null; owners: string[]; nonce: number | null; version: string | null; last_synced_at: string }>;
  changes: Array<{ chain: string; safe_address: string; event_kind: string; details: any; observed_at: string }>;
}) {
  const totalSigners = safes.reduce((s, sf) => s + (sf.owners?.length ?? 0), 0);
  const minThreshold = safes.length > 0 ? Math.min(...safes.map(s => s.threshold ?? 99).filter(t => t < 99)) : null;
  const recentChanges = changes.filter(c => c.event_kind !== "initial_observation").slice(0, 5);

  // Verdict
  let verdict: { tone: "good" | "warn" | "alert"; text: string };
  if (safes.length === 0) {
    verdict = { tone: "warn", text: "No multisigs detected — either fully on-chain governance, single key admin, or we haven't mapped the safe yet." };
  } else if (recentChanges.length > 0) {
    verdict = { tone: "alert", text: `${recentChanges.length} signer change${recentChanges.length === 1 ? "" : "s"} in the last sync window — review who joined or left.` };
  } else if (minThreshold !== null && minThreshold < 2) {
    verdict = { tone: "alert", text: `Threshold of 1-of-N detected — a single key can move funds. Treat as a high-risk admin pattern.` };
  } else if (minThreshold !== null && minThreshold === 2) {
    verdict = { tone: "warn", text: `Threshold is 2 — minimal redundancy. Bus-factor is low.` };
  } else {
    verdict = { tone: "good", text: `${safes.length} safe${safes.length > 1 ? "s" : ""} with ${totalSigners} unique signer slot${totalSigners === 1 ? "" : "s"}. No recent signer changes detected.` };
  }

  const toneCls = ({ good: "border-emerald-500/25 bg-emerald-500/[0.04]", warn: "border-amber-500/30 bg-amber-500/[0.05]", alert: "border-rose-500/30 bg-rose-500/[0.06]" } as Record<string, string>)[verdict.tone];
  const toneText = ({ good: "text-emerald-200", warn: "text-amber-200", alert: "text-rose-200" } as Record<string, string>)[verdict.tone];

  return (
    <div className="as-card p-5 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Wallet className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-white">Multisig surveillance</h2>
        <span className="text-[10px] text-muted-foreground ml-auto">via Safe Transaction Service · synced daily</span>
      </div>

      {/* Verdict */}
      <div className={`rounded-lg border ${toneCls} p-3 text-[13px] ${toneText} leading-relaxed`}>
        {verdict.text}
      </div>

      {/* Safes list */}
      {safes.length > 0 && (
        <div className="space-y-2">
          {safes.map((sf, i) => (
            <div key={i} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-white/[0.05] px-1.5 py-0.5 rounded">{sf.chain}</span>
                  <code className="text-[11px] text-white/85 font-mono">{sf.address.slice(0, 10)}…{sf.address.slice(-6)}</code>
                  {sf.version && <span className="text-[10px] text-muted-foreground">v{sf.version}</span>}
                </div>
                <div className="text-[11px] tabular-nums">
                  <span className="font-bold text-white">{sf.threshold}</span>
                  <span className="text-muted-foreground"> of {sf.owners?.length ?? 0}</span>
                </div>
              </div>
              {/* Owners */}
              {sf.owners && sf.owners.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {sf.owners.slice(0, 12).map((o) => (
                    <code key={o} className="text-[10px] font-mono text-muted-foreground bg-white/[0.03] border border-white/[0.05] px-1.5 py-0.5 rounded">
                      {o.slice(0, 6)}…{o.slice(-4)}
                    </code>
                  ))}
                  {sf.owners.length > 12 && (
                    <span className="text-[10px] text-muted-foreground self-center">+{sf.owners.length - 12} more</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Recent changes timeline */}
      {recentChanges.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.08em] font-bold text-white/80 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-3 h-3 text-amber-300" /> Recent signer changes
          </div>
          <div className="space-y-1.5">
            {recentChanges.map((c, i) => (
              <div key={i} className="flex items-center gap-3 text-[12px] rounded border border-amber-500/15 bg-amber-500/[0.03] px-3 py-2">
                <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                  c.event_kind === "added" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" :
                  c.event_kind === "removed" ? "border-rose-500/30 bg-rose-500/10 text-rose-300" :
                  "border-amber-500/30 bg-amber-500/10 text-amber-300"
                }`}>{c.event_kind.replace("_", " ")}</span>
                <code className="text-[10px] font-mono text-muted-foreground">{c.safe_address.slice(0, 8)}…</code>
                <div className="flex-1 min-w-0 text-white/85">
                  {c.event_kind === "added" && c.details?.signers?.length > 0 && `${c.details.signers.length} signer${c.details.signers.length > 1 ? "s" : ""} added`}
                  {c.event_kind === "removed" && c.details?.signers?.length > 0 && `${c.details.signers.length} signer${c.details.signers.length > 1 ? "s" : ""} removed`}
                  {c.event_kind === "threshold_changed" && `Threshold: ${c.details.from} → ${c.details.to}`}
                </div>
                <span className="text-[10px] text-muted-foreground tabular-nums">{daysAgo(c.observed_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SimChip({ score }: { score: number }) {
  const cls = score >= 70 ? "bg-rose-500/20 text-rose-200 border-rose-500/40"
    : score >= 50 ? "bg-orange-500/15 text-orange-200 border-orange-500/30"
    : score >= 30 ? "bg-amber-500/10 text-amber-200 border-amber-500/30"
    : "bg-white/[0.06] text-muted-foreground border-white/[0.08]";
  return (
    <div className={`w-9 h-9 rounded border ${cls} flex flex-col items-center justify-center shrink-0`}>
      <span className="text-[12px] font-bold tabular-nums leading-none">{score}</span>
      <span className="text-[7px] uppercase tracking-wider opacity-70 mt-0.5">match</span>
    </div>
  );
}

function SeverityBadge({ s }: { s: string }) {
  const cls = ({
    critical: "bg-rose-500/25 text-rose-100 border-rose-500/50",
    high: "bg-orange-500/20 text-orange-100 border-orange-500/40",
    medium: "bg-amber-500/15 text-amber-100 border-amber-500/30",
    low: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
  } as Record<string, string>)[s.toLowerCase()] || "bg-white/[0.05] text-muted-foreground border-white/[0.08]";
  return <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border ${cls} shrink-0 mt-0.5`}>{s}</span>;
}

function PostureCard({ label, tone, primary, hint }: { label: string; tone: "good" | "warn" | "alert" | "neutral"; primary: string; hint: string }) {
  const cls = ({
    good: "border-emerald-500/25 bg-emerald-500/[0.04] text-emerald-200",
    warn: "border-amber-500/30 bg-amber-500/[0.05] text-amber-200",
    alert: "border-rose-500/30 bg-rose-500/[0.06] text-rose-200",
    neutral: "border-white/[0.06] bg-white/[0.02] text-white",
  } as Record<string, string>)[tone];
  return (
    <div className={`rounded-md border px-3 py-2.5 ${cls}`}>
      <div className="text-[9px] uppercase tracking-[0.08em] font-medium opacity-90">{label}</div>
      <div className="text-base font-bold tabular-nums mt-1">{primary}</div>
      <div className="text-[10px] opacity-70 mt-0.5 line-clamp-2">{hint}</div>
    </div>
  );
}

function FootprintMini({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint?: string; tone?: "neutral" | "warn" }) {
  return (
    <div className={`rounded-md ${tone === "warn" ? "bg-amber-500/[0.04]" : "bg-white/[0.02]"} px-3 py-2 border border-white/[0.05]`}>
      <div className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground/90">{label}</div>
      <div className={`text-sm font-bold tabular-nums mt-0.5 ${tone === "warn" ? "text-amber-200" : "text-white"}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{hint}</div>}
    </div>
  );
}

function PositionTimeline({ data, current }: {
  data: Array<{ snapshot_date: string; composite_score: number; sub_audit: number | null; sub_onchain: number | null; sub_activity: number | null; sub_team: number | null; sub_funding: number | null }>;
  current: number;
}) {
  // SVG sparkline 800x140
  const W = 800;
  const H = 140;
  const PAD_L = 32;
  const PAD_R = 16;
  const PAD_T = 16;
  const PAD_B = 24;

  const scores = data.map((d) => d.composite_score);
  const minY = Math.max(0, Math.min(...scores, current) - 5);
  const maxY = Math.min(100, Math.max(...scores, current) + 5);
  const range = Math.max(10, maxY - minY);

  const xStep = data.length > 1 ? (W - PAD_L - PAD_R) / (data.length - 1) : 0;
  const yFor = (s: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - (s - minY) / range);

  const path = data.map((d, i) => {
    const x = PAD_L + i * xStep;
    const y = yFor(d.composite_score);
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");

  const fillPath = `${path} L ${(PAD_L + (data.length - 1) * xStep).toFixed(1)} ${H - PAD_B} L ${PAD_L} ${H - PAD_B} Z`;

  // Compute 7d / 30d / 90d deltas
  const findAt = (daysBack: number) => {
    const target = Date.now() - daysBack * 86400000;
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < data.length; i++) {
      const diff = Math.abs(new Date(data[i].snapshot_date).getTime() - target);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    return data[bestIdx];
  };

  const d7 = findAt(7);
  const d30 = findAt(30);
  const d90 = data[0];
  const delta = (then: number) => current - then;

  const lineColor = current >= 60 ? "#fb7185" : current >= 40 ? "#fbbf24" : "#34d399";

  return (
    <div className="as-card p-5">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <TrendingUp className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-white">Risk score timeline</h2>
        <span className="text-[10px] text-muted-foreground">last 90 days · {data.length} snapshots</span>
        <div className="flex-1" />
        <DeltaBadge label="7d" v={delta(d7.composite_score)} />
        <DeltaBadge label="30d" v={delta(d30.composite_score)} />
        <DeltaBadge label="90d" v={delta(d90.composite_score)} />
      </div>
      <div className="overflow-x-auto">
        <svg width={W} height={H} className="block">
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].filter(g => g >= minY && g <= maxY).map((g) => (
            <g key={g}>
              <line x1={PAD_L} y1={yFor(g)} x2={W - PAD_R} y2={yFor(g)} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
              <text x={PAD_L - 6} y={yFor(g) + 3} textAnchor="end" fontSize={9} fill="rgba(255,255,255,0.3)">{g}</text>
            </g>
          ))}
          {/* Risk band thresholds */}
          {[
            { y: 70, color: "rgba(244, 63, 94, 0.12)" },
            { y: 50, color: "rgba(245, 158, 11, 0.08)" },
          ].filter(t => t.y >= minY && t.y <= maxY).map((t) => (
            <line key={t.y} x1={PAD_L} y1={yFor(t.y)} x2={W - PAD_R} y2={yFor(t.y)} stroke={t.color} strokeWidth={1} strokeDasharray="2,3" />
          ))}
          {/* Area fill */}
          <path d={fillPath} fill={lineColor} fillOpacity={0.08} />
          {/* Line */}
          <path d={path} fill="none" stroke={lineColor} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
          {/* Points */}
          {data.map((d, i) => {
            const x = PAD_L + i * xStep;
            const y = yFor(d.composite_score);
            return (
              <circle key={i} cx={x} cy={y} r={i === data.length - 1 ? 3 : 1.5} fill={lineColor} stroke="#0a0a0a" strokeWidth={1} />
            );
          })}
          {/* Latest label */}
          {data.length > 0 && (() => {
            const lastX = PAD_L + (data.length - 1) * xStep;
            const lastY = yFor(current);
            return (
              <g>
                <rect x={lastX + 5} y={lastY - 9} width={28} height={14} rx={3} fill="#0a0a0a" stroke={lineColor} strokeOpacity={0.6} strokeWidth={0.8} />
                <text x={lastX + 19} y={lastY + 1} textAnchor="middle" fontSize={10} fontWeight="bold" fill={lineColor}>{current}</text>
              </g>
            );
          })()}
          {/* X labels at quarters */}
          {[0, Math.floor(data.length / 3), Math.floor((data.length * 2) / 3), data.length - 1].map((i) => {
            if (!data[i]) return null;
            const x = PAD_L + i * xStep;
            return (
              <text key={i} x={x} y={H - 6} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.3)">
                {data[i].snapshot_date.slice(5)}
              </text>
            );
          })}
        </svg>
      </div>
      <div className="text-[10px] text-muted-foreground mt-2">
        Lower is safer. Risk score combines audit posture, on-chain anomalies, team activity, funding cadence, and sentiment.
      </div>
    </div>
  );
}

function DeltaBadge({ label, v }: { label: string; v: number }) {
  const up = v > 0;
  const flat = Math.abs(v) < 1;
  const cls = flat ? "bg-white/[0.05] text-muted-foreground border-white/[0.08]" : up ? "bg-rose-500/15 text-rose-200 border-rose-500/30" : "bg-emerald-500/15 text-emerald-200 border-emerald-500/30";
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-1 rounded border ${cls}`}>
      <span className="opacity-70">{label}</span>
      <span className="font-bold tabular-nums">{v > 0 ? "+" : ""}{v.toFixed(0)}</span>
    </span>
  );
}

function SevPill({ sev }: { sev: string }) {
  const map: Record<string, string> = {
    critical: "bg-rose-600/20 text-rose-200 border-rose-600/50",
    high: "bg-rose-500/15 text-rose-300 border-rose-500/40",
    medium: "bg-amber-500/15 text-amber-300 border-amber-500/40",
    low: "bg-sky-500/10 text-sky-300 border-sky-500/30",
    informational: "bg-white/[0.04] text-muted-foreground border-white/[0.06]",
    gas: "bg-white/[0.04] text-muted-foreground border-white/[0.06]",
    unknown: "bg-white/[0.04] text-muted-foreground border-white/[0.06]",
  };
  return <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${map[sev] || map.unknown} shrink-0 mt-0.5`}>{sev}</span>;
}
