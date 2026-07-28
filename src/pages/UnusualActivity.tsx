import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Activity, ShieldAlert, Server, TrendingUp, TrendingDown, Flame, AlertCircle, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/lib/supabase";
import { CompanyLogo } from "@/components/CompanyLogo";

type Anomaly = {
  id: string;
  company_slug: string | null;
  chain: string | null;
  metric_kind: string;
  audience: string;
  date: string;
  value: number | null;
  mean_30d: number | null;
  stdev_30d: number | null;
  z_score: number | null;
  direction: string | null;
  detail: string | null;
  created_at: string;
};

type CompanyLite = { slug: string; name: string; logo: string | null; category: string | null };
type AudienceTab = "security" | "infra";

function fmtUsd(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

/** Convert a raw anomaly + audience into a sales-rep-friendly story. */
function composeStory(a: Anomaly, audience: AudienceTab, companyName: string): {
  headline: string;
  severity: "hot" | "warm" | "watch";
  whyMatters: string;
  whatToDo: string;
  pitch: string;
} {
  const dir = a.direction === "up" ? "up" : "down";
  const factor = a.mean_30d && a.mean_30d > 0 && a.value != null ? a.value / a.mean_30d : null;
  const factorStr = factor != null ? `${factor.toFixed(1)}×` : "an unusual amount";
  const absZ = Math.abs(a.z_score || 0);
  const severity: "hot" | "warm" | "watch" = absZ >= 3.5 ? "hot" : absZ >= 2.5 ? "warm" : "watch";

  // Fees anomalies
  if (a.metric_kind === "fees" && dir === "up") {
    return {
      headline: `${companyName} is generating ${factorStr} the fees it normally does`,
      severity,
      whyMatters: audience === "security"
        ? `Fee revenue jumped — usually means a new product, contract, or user wave just hit mainnet. Each of those is an audit moment. Either fresh code was shipped (audit it before it scales), or existing scope grew past what their last audit covered.`
        : `Fee revenue jumped — that maps directly to transaction throughput. Their RPC bill went up this week. If they're on a basic/free RPC tier, they're now feeling the pain. Pre-paid-tier conversation window is open.`,
      whatToDo: audience === "security"
        ? `DM their CTO or Head of Security. Open with a specific observation about the ramp (don't lead with metrics) — ask if their next audit is scoped for what's now on mainnet.`
        : `Reach out to their infra/devops lead. Ask about RPC reliability under the new load — premium RPC, archival, dedicated nodes are all on the table.`,
      pitch: audience === "security"
        ? `"Saw ${companyName} growing fast this week — curious if your audit coverage maps to what's on mainnet now, or if there's anything new since the last review."`
        : `"Saw transaction volume on ${companyName} climbing this week. Happy to chat if your RPC is starting to feel the strain — we've helped teams hit similar walls."`,
    };
  }
  if (a.metric_kind === "fees" && dir === "down") {
    return {
      headline: `${companyName} fee revenue collapsed to ${factorStr} of normal`,
      severity,
      whyMatters: audience === "security"
        ? `Fee revenue cratered. Could be an incident (paused contracts, exploit, oracle issue) — or just a quiet week. If sudden and sharp, check their X account and Etherscan before reaching out; don't cold-pitch a team that's putting out a fire.`
        : `Activity dropped. If sustained, users may have migrated. Lower priority — wait for recovery or further drop to confirm pattern.`,
      whatToDo: audience === "security"
        ? `Investigate first. If it's an incident, you can offer post-mortem/fix-review work — but only if you can land genuine help, not vulture-style outreach.`
        : `Park and revisit in 7 days. If volume continues falling, drop them. If it recovers fast, the dip itself is interesting (capacity test? bridge issue?).`,
      pitch: audience === "security"
        ? `Hold off until you understand what happened. Cold-pitching a team mid-incident burns the relationship.`
        : `No outreach this week. Set a reminder for next week's read.`,
    };
  }

  // Volume anomalies (DEX trading volume)
  if (a.metric_kind === "volume" && dir === "up") {
    return {
      headline: `${companyName} is doing ${factorStr} its usual trade volume`,
      severity,
      whyMatters: audience === "security"
        ? `Volume spike means traders found them — usually a new pool, listing, integration, or vampire moment. With volume comes new contract surface (router, vaults, hooks). High-velocity protocols are audit-hungry because every shipped change matters more.`
        : `Trade volume = state-changing transactions = direct RPC load. Every quote, every swap, every settlement hits their nodes. Their infra cost just spiked alongside the volume. If they hit rate limits or latency, users churn fast. Right moment to sell premium RPC, archival, or co-located nodes.`,
      whatToDo: audience === "security"
        ? `Reach out to their protocol engineer or Head of Security. Reference the specific ramp ("saw the spike on X chain"), ask if anything new ships in next few weeks that needs eyes on.`
        : `Reach out to their DevOps/Infra lead. Most DEXs run premium RPC the moment they care about latency — find out who they use and what's broken about it.`,
      pitch: audience === "security"
        ? `"Saw ${companyName} doing big volume this week — what's on the roadmap for the next two months? Happy to keep eyes on whatever ships next."`
        : `"Volume on ${companyName} spiked this week. If your RPC layer is feeling it, we should talk — most DEXs at this scale need dedicated nodes or premium tier."`,
    };
  }
  if (a.metric_kind === "volume" && dir === "down") {
    return {
      headline: `${companyName} volume dropped to ${factorStr} of normal`,
      severity: "watch",
      whyMatters: audience === "security"
        ? `DEX volume is streaky by nature — a single quiet week isn't meaningful. Watch if it continues or if a competitor poached liquidity.`
        : `Volume drop = less RPC pressure short-term. Park them. If they were a prospect, the sales urgency just dropped.`,
      whatToDo: `Lower priority. Add a 7-day reminder to re-check. Look at what their team is publicly saying — sometimes a drop precedes a major migration.`,
      pitch: `No immediate outreach. Watch for recovery or further drop.`,
    };
  }

  // tx_count / write_tx_count (future)
  if (a.metric_kind === "tx_count" || a.metric_kind === "write_tx_count") {
    return {
      headline: `${companyName} transaction count is ${factorStr} normal (${dir})`,
      severity,
      whyMatters: audience === "security"
        ? `Transaction count spike usually means new product or user wave. Touch the team early — protocols that scale fast often skip audit cadence updates.`
        : `Higher tx count = direct RPC and indexing pressure. If write-heavy, their backend is sweating.`,
      whatToDo: audience === "security"
        ? `Cold DM with a forward-looking framing — ask what ships next, offer to be on call when it does.`
        : `Talk to their infra lead about dedicated RPC, indexing throughput, or archival.`,
      pitch: audience === "security"
        ? `"Looks like ${companyName} is busy this week — would love to be on your shortlist for the next audit window."`
        : `"Volume jumped on ${companyName} — happy to chat if your infra is creaking."`,
    };
  }

  // Fallback
  return {
    headline: `${companyName}: ${a.metric_kind} ${dir} (${factorStr} normal)`,
    severity,
    whyMatters: `Metric moved meaningfully outside the protocol's normal range. Worth investigating context before reaching out.`,
    whatToDo: `Look at their X account, GitHub, and any recent governance posts to understand what changed.`,
    pitch: `Skip cold outreach until you know what caused this.`,
  };
}

function MetricLabel({ kind }: { kind: string }) {
  const map: Record<string, string> = { fees: "Fee revenue", volume: "Trade volume", tx_count: "Transactions", write_tx_count: "Write txs", deploy_count: "Contract deploys" };
  return <span>{map[kind] || kind}</span>;
}

function SeverityPill({ s }: { s: "hot" | "warm" | "watch" }) {
  if (s === "hot") return <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 inline-flex items-center gap-1"><Flame className="w-3 h-3" /> HOT</span>;
  if (s === "warm") return <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 inline-flex items-center gap-1"><Sparkles className="w-3 h-3" /> WARM</span>;
  return <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-white/[0.04] text-muted-foreground border border-white/10 inline-flex items-center gap-1"><AlertCircle className="w-3 h-3" /> WATCH</span>;
}

export default function UnusualActivity() {
  const [tab, setTab] = useState<AudienceTab>("security");
  const [days, setDays] = useState<7 | 14 | 30>(7);
  const [chainFilter, setChainFilter] = useState<string | null>(null);

  const sinceDate = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }, [days]);

  const anomaliesQ = useQuery({
    queryKey: ["unusual-activity-anomalies", tab, sinceDate],
    queryFn: async (): Promise<Anomaly[]> => {
      const audienceFilter = tab === "security" ? "audience.eq.security,audience.eq.both" : "audience.eq.infra,audience.eq.both";
      const { data, error } = await supabase
        .from("metric_anomalies")
        .select("id,company_slug,chain,metric_kind,audience,date,value,mean_30d,stdev_30d,z_score,direction,detail,created_at")
        .gte("date", sinceDate)
        .or(audienceFilter)
        .order("date", { ascending: false })
        .order("z_score", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as Anomaly[];
    },
  });

  const slugs = useMemo(
    () => Array.from(new Set((anomaliesQ.data || []).map((a) => a.company_slug).filter(Boolean) as string[])),
    [anomaliesQ.data],
  );

  const companiesQ = useQuery({
    queryKey: ["unusual-activity-companies", slugs.join(",")],
    enabled: slugs.length > 0,
    queryFn: async (): Promise<Map<string, CompanyLite>> => {
      const { data } = await supabase.from("companies").select("slug,name,logo,category").in("slug", slugs);
      const m = new Map<string, CompanyLite>();
      for (const c of (data || []) as CompanyLite[]) m.set(c.slug, c);
      return m;
    },
  });

  const anomaliesAll = anomaliesQ.data || [];
  const companies = companiesQ.data || new Map<string, CompanyLite>();

  // Chains available in the current result set (for the chip filter)
  const chainsAvailable = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of anomaliesAll) {
      if (!a.chain || a.chain === "unknown") continue;
      counts.set(a.chain, (counts.get(a.chain) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [anomaliesAll]);

  const anomalies = useMemo(() => {
    if (!chainFilter) return anomaliesAll;
    return anomaliesAll.filter((a) => a.chain === chainFilter);
  }, [anomaliesAll, chainFilter]);

  // Sort: HOT first, then WARM, then WATCH; within each, by date desc.
  const stories = useMemo(() => {
    return anomalies.map((a) => {
      const c = a.company_slug ? companies.get(a.company_slug) : null;
      const name = c?.name || a.company_slug || a.chain || "Unknown";
      const story = composeStory(a, tab, name);
      return { a, c, story };
    }).sort((x, y) => {
      const order: Record<string, number> = { hot: 0, warm: 1, watch: 2 };
      const d = order[x.story.severity] - order[y.story.severity];
      if (d !== 0) return d;
      return x.a.date < y.a.date ? 1 : -1;
    });
  }, [anomalies, companies, tab]);

  const hotCount = stories.filter((s) => s.story.severity === "hot").length;
  const warmCount = stories.filter((s) => s.story.severity === "warm").length;

  return (
    <div className="space-y-5 max-w-5xl">
      <header>
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Activity className="w-3.5 h-3.5" /> Unusual Activity
        </div>
        <h1 className="text-2xl font-bold text-white mt-1">Protocols moving differently than they normally do</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Every protocol has a "normal." This page surfaces protocols where the last reading is way outside that normal —
          a strong, dated reason to reach out <em>this week</em>, before the prospect even tells you they're in a moment.
        </p>
      </header>

      {/* Tabs */}
      <div className="border-b border-white/[0.06] flex gap-1">
        <button
          type="button"
          onClick={() => setTab("security")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "security" ? "border-primary text-white" : "border-transparent text-muted-foreground hover:text-white"
          }`}
        >
          <ShieldAlert className="w-4 h-4 inline mr-1.5" /> If you sell security
        </button>
        <button
          type="button"
          onClick={() => setTab("infra")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "infra" ? "border-primary text-white" : "border-transparent text-muted-foreground hover:text-white"
          }`}
        >
          <Server className="w-4 h-4 inline mr-1.5" /> If you sell RPC / infra
        </button>
        <div className="ml-auto flex gap-1 bg-white/[0.04] rounded-md p-0.5">
          {([7, 14, 30] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`text-[11px] px-2.5 py-1 rounded font-medium ${
                days === d ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-white"
              }`}
            >
              last {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Lead-in for the active tab */}
      <div className="as-card p-4 bg-white/[0.02]">
        {tab === "security" ? (
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="text-white font-semibold">Why each protocol is flagged:</span> their on-chain fees or trading volume
            just blew past their own 30-day average by &gt;2 standard deviations. For a security firm, that usually means
            <span className="text-white"> new code shipped</span>, <span className="text-white">user surge</span>, or
            <span className="text-white"> incident</span> — all three are reasons to reach out with relevant timing.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="text-white font-semibold">Why each protocol is flagged:</span> their on-chain activity (fees / trade volume)
            just blew past their own 30-day baseline by &gt;2 standard deviations. For an infra / RPC vendor, that's a direct
            tell that their <span className="text-white">request load just spiked</span> — and the conversation about premium RPC,
            archival, dedicated nodes, or indexing has a real anchor.
          </p>
        )}
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-3 gap-3">
        <div className="as-card p-3 flex items-center gap-3">
          <Flame className="w-5 h-5 text-rose-400" />
          <div>
            <div className="text-xs text-muted-foreground">Hot leads (z &ge; 3.5σ)</div>
            <div className="text-lg font-bold text-white">{hotCount}</div>
          </div>
        </div>
        <div className="as-card p-3 flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-amber-400" />
          <div>
            <div className="text-xs text-muted-foreground">Warm (z &ge; 2.5σ)</div>
            <div className="text-lg font-bold text-white">{warmCount}</div>
          </div>
        </div>
        <div className="as-card p-3 flex items-center gap-3">
          <Activity className="w-5 h-5 text-primary" />
          <div>
            <div className="text-xs text-muted-foreground">Protocols moving</div>
            <div className="text-lg font-bold text-white">{slugs.length}</div>
          </div>
        </div>
      </div>

      {/* Chain filter chips */}
      {chainsAvailable.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Chain</span>
          <button
            type="button"
            onClick={() => setChainFilter(null)}
            className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${
              chainFilter === null ? "bg-primary/15 text-primary border-primary/40" : "bg-white/[0.03] text-muted-foreground border-white/10 hover:border-white/20"
            }`}
          >
            All <span className="text-muted-foreground/60">({anomaliesAll.length})</span>
          </button>
          {chainsAvailable.map(([chain, n]) => (
            <button
              key={chain}
              type="button"
              onClick={() => setChainFilter(chainFilter === chain ? null : chain)}
              className={`text-[11px] px-2 py-0.5 rounded-full border font-medium capitalize ${
                chainFilter === chain ? "bg-primary/15 text-primary border-primary/40" : "bg-white/[0.03] text-muted-foreground border-white/10 hover:border-white/20"
              }`}
            >
              {chain} <span className="text-muted-foreground/60">({n})</span>
            </button>
          ))}
        </div>
      )}

      {/* Story cards */}
      {anomaliesQ.isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading anomalies…</div>
      ) : stories.length === 0 ? (
        <div className="as-card p-8 text-center">
          <div className="text-sm font-semibold text-white">No protocols outside their normal range</div>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            The daily collector runs at 6 AM UTC and flags every protocol that drifted &gt;2σ from its 30-day baseline.
            On a calm market day, this page can be empty — that's accurate, not broken.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {stories.map(({ a, c, story }) => {
            const factor = a.mean_30d && a.mean_30d > 0 && a.value != null ? a.value / a.mean_30d : null;
            return (
              <div key={a.id} className="as-card p-4">
                <div className="flex items-start gap-3">
                  {c ? (
                    <Link to={`/companies/${c.slug}`} className="shrink-0">
                      <CompanyLogo logo={c.logo} url={null} name={c.name} className="w-11 h-11 rounded-lg" />
                    </Link>
                  ) : (
                    <div className="w-11 h-11 rounded-lg bg-white/[0.04] shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <SeverityPill s={story.severity} />
                      <span className="text-[11px] text-muted-foreground">
                        <MetricLabel kind={a.metric_kind} /> · {a.direction === "up" ? <TrendingUp className="w-3 h-3 inline text-emerald-400" /> : <TrendingDown className="w-3 h-3 inline text-rose-400" />}
                      </span>
                      {c?.category && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-muted-foreground border border-white/[0.06]">
                          {c.category}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {a.date} · {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-white">{story.headline}</h3>

                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="rounded-md bg-white/[0.02] border border-white/[0.04] p-3">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Why this matters</div>
                        <div className="text-[13px] text-white/90 leading-snug">{story.whyMatters}</div>
                      </div>
                      <div className="rounded-md bg-primary/[0.04] border border-primary/[0.15] p-3">
                        <div className="text-[10px] uppercase tracking-wider text-primary font-semibold mb-1">What to do</div>
                        <div className="text-[13px] text-white/90 leading-snug">{story.whatToDo}</div>
                      </div>
                    </div>

                    {story.pitch && story.pitch.length > 10 && story.severity !== "watch" && (
                      <div className="mt-2 rounded-md border border-emerald-500/20 bg-emerald-500/[0.05] p-3">
                        <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold mb-1">Suggested cold open</div>
                        <div className="text-[13px] text-white/90 italic leading-snug">{story.pitch}</div>
                      </div>
                    )}

                    {/* Collapsed evidence */}
                    <details className="mt-2">
                      <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-white">Show evidence (numbers)</summary>
                      <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                        <div><div className="text-muted-foreground">This day</div><div className="text-white font-mono">{fmtUsd(a.value)}</div></div>
                        <div><div className="text-muted-foreground">30-day avg</div><div className="text-white font-mono">{fmtUsd(a.mean_30d)}</div></div>
                        <div><div className="text-muted-foreground">vs avg</div><div className={`font-mono ${factor && factor > 1 ? "text-emerald-400" : "text-rose-400"}`}>{factor != null ? `${factor.toFixed(2)}×` : "—"}</div></div>
                        <div><div className="text-muted-foreground">Z-score</div><div className="text-white font-mono">{a.z_score?.toFixed(2) || "—"}</div></div>
                      </div>
                      {a.detail && (
                        <div className="mt-1 text-[11px] text-muted-foreground">Source detail: {a.detail}</div>
                      )}
                    </details>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Glossary at the bottom for first-time visitors */}
      <details className="as-card p-4">
        <summary className="text-xs uppercase tracking-wider text-muted-foreground cursor-pointer">How this list is built</summary>
        <div className="mt-3 space-y-2 text-[13px] text-muted-foreground leading-relaxed">
          <p>
            <span className="text-white font-semibold">Source:</span> DefiLlama's daily fee + trade-volume series per protocol.
            We pull the last 90 days every morning at 6 AM UTC.
          </p>
          <p>
            <span className="text-white font-semibold">Normal:</span> for each protocol, we compute the mean and standard deviation
            of the prior 30 days. A reading is "unusual" if today's value is 2+ standard deviations away from that mean.
          </p>
          <p>
            <span className="text-white font-semibold">Hot vs warm vs watch:</span> Hot = ≥3.5σ (rare; strong signal).
            Warm = 2.5–3.5σ. Watch = 2.0–2.5σ. Within each tier, sorted by recency.
          </p>
          <p>
            <span className="text-white font-semibold">Why not all protocols show up:</span> DefiLlama only tracks protocols with
            measurable fee/volume — purely-CeFi exchanges, infra plays, or pre-launch projects often don't have a series here.
            We add other on-chain signals (upgrades, pauses, multisig changes) via the on-chain monitor — those appear on the
            account-level dashboard.
          </p>
        </div>
        <div className="mt-3 text-[12px] text-muted-foreground">
          <Link to="/saved" className="text-primary hover:underline inline-flex items-center gap-0.5">
            See your saved targets <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
      </details>
    </div>
  );
}
