import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Globe, Twitter, Linkedin, TrendingUp, Building2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { normalizeTwitterUrl } from "@/lib/format";
import { CompanyLogo } from "@/components/CompanyLogo";
import { ViewToggle, type ViewMode } from "@/components/ViewToggle";
import {
  RoundListRow,
  RoundGridCard,
  fmtAmount,
  type FundingRoundRow,
} from "@/components/FundingRoundCard";

type Fund = {
  slug: string;
  name: string;
  website: string | null;
  twitter: string | null;
  linkedin: string | null;
  investment_count: number | null;
};

type CompanyLite = {
  slug: string;
  name: string;
  logo: string | null;
  category: string | null;
};

const ROUNDS_VIEW_KEY = "as_fund_rounds_view";
const PORTCO_VIEW_KEY = "as_fund_portco_view";

export default function FundDetail() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();

  const [roundsView, setRoundsView] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "grid";
    return (window.localStorage.getItem(ROUNDS_VIEW_KEY) as ViewMode) || "grid";
  });
  const [portcoView, setPortcoView] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "grid";
    return (window.localStorage.getItem(PORTCO_VIEW_KEY) as ViewMode) || "grid";
  });

  useEffect(() => {
    window.localStorage.setItem(ROUNDS_VIEW_KEY, roundsView);
  }, [roundsView]);
  useEffect(() => {
    window.localStorage.setItem(PORTCO_VIEW_KEY, portcoView);
  }, [portcoView]);

  const fund = useQuery({
    queryKey: ["fund", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funds")
        .select("slug,name,website,twitter,linkedin,investment_count")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      return data as Fund | null;
    },
  });

  const fundName = fund.data?.name;

  const rounds = useQuery({
    queryKey: ["fund-rounds", fundName],
    enabled: !!fundName,
    queryFn: async (): Promise<FundingRoundRow[]> => {
      const safe = fundName!.replace(/[%,()]/g, " ").trim();
      if (!safe) return [];
      const orParts = [
        `lead_investors.ilike.%${safe}%`,
        `other_investors.ilike.%${safe}%`,
        `all_investors.ilike.%${safe}%`,
      ].join(",");
      const { data, error } = await supabase
        .from("funding_rounds")
        .select(
          "id,company_slug,company_name,round_type,amount_usd,date,lead_investors,other_investors,all_investors,announcement_url,category",
        )
        .or(orParts)
        .order("date", { ascending: false, nullsFirst: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as FundingRoundRow[];
    },
  });

  // Aggregate portfolio companies from rounds
  const portfolioAgg = useMemo(() => {
    const m = new Map<string, { name: string; rounds: number; totalRaised: number; lastDate: string | null }>();
    for (const r of rounds.data || []) {
      if (!r.company_slug) continue;
      const e = m.get(r.company_slug) || { name: r.company_name || r.company_slug, rounds: 0, totalRaised: 0, lastDate: null };
      e.rounds += 1;
      e.totalRaised += Number(r.amount_usd) || 0;
      if (r.date && (!e.lastDate || r.date > e.lastDate)) e.lastDate = r.date;
      m.set(r.company_slug, e);
    }
    return m;
  }, [rounds.data]);

  const portfolioSlugs = useMemo(() => Array.from(portfolioAgg.keys()), [portfolioAgg]);

  const portfolioCompanies = useQuery({
    queryKey: ["fund-portfolio-companies-lite", portfolioSlugs.join(",")],
    enabled: portfolioSlugs.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("slug,name,logo,category")
        .in("slug", portfolioSlugs);
      if (error) throw error;
      const map = new Map<string, CompanyLite>();
      (data || []).forEach((c: CompanyLite) => map.set(c.slug, c));
      return map;
    },
  });

  if (fund.isLoading) return <div className="text-muted-foreground">Loading fund…</div>;
  if (!fund.data) return <div className="text-muted-foreground">Fund not found.</div>;

  const f = fund.data;
  const tw = normalizeTwitterUrl(f.twitter);

  const totalDeployed = (rounds.data || []).reduce((s, r) => s + (Number(r.amount_usd) || 0), 0);
  const numRounds = rounds.data?.length ?? 0;
  const numPortcos = portfolioAgg.size;

  return (
    <div className="space-y-5 max-w-[1400px]">
      <button
        onClick={() => navigate(-1)}
        className="text-muted-foreground hover:text-white text-sm flex items-center gap-1.5"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="as-card p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-white">{f.name}</h2>
            <div className="flex items-center gap-3 mt-3">
              {f.website && <a href={f.website} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary"><Globe className="w-4 h-4" /></a>}
              {tw && <a href={tw} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary"><Twitter className="w-4 h-4" /></a>}
              {f.linkedin && <a href={f.linkedin} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary"><Linkedin className="w-4 h-4" /></a>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
          <Stat label="Rounds tracked" value={numRounds} icon={<TrendingUp className="w-3.5 h-3.5" />} accent="text-white" />
          <Stat label="Portfolio companies" value={numPortcos} icon={<Building2 className="w-3.5 h-3.5" />} accent="text-white" />
          <Stat label="Total deployed (sum)" value={fmtAmount(totalDeployed)} accent="text-teal-400" />
        </div>
      </div>

      <div className="as-card overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-white">Investments</h3>
          {numRounds > 0 && <ViewToggle value={roundsView} onChange={setRoundsView} />}
        </div>
        {rounds.isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 bg-white/[0.03] rounded animate-pulse" />
            ))}
          </div>
        ) : numRounds === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">No funding rounds matched to this fund.</div>
        ) : roundsView === "grid" ? (
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(rounds.data || []).map((r) => (
              <RoundGridCard key={r.id} r={r} />
            ))}
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {(rounds.data || []).map((r) => (
              <RoundListRow key={r.id} r={r} />
            ))}
          </div>
        )}
      </div>

      <div className="as-card overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-white">Portfolio Companies</h3>
          {numPortcos > 0 && <ViewToggle value={portcoView} onChange={setPortcoView} />}
        </div>
        {numPortcos === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">No portfolio companies recorded.</div>
        ) : portcoView === "grid" ? (
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from(portfolioAgg.entries()).map(([cslug, e]) => {
              const c = portfolioCompanies.data?.get(cslug);
              return (
                <Link
                  key={cslug}
                  to={`/companies/${cslug}`}
                  className="as-card p-4 hover:border-white/20 transition-colors block"
                >
                  <div className="flex items-start gap-3">
                    <CompanyLogo logo={c?.logo || null} url={null} name={c?.name || e.name} className="w-10 h-10 rounded-md shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-white truncate">{c?.name || e.name}</div>
                      {c?.category && (
                        <div className="text-[11px] text-muted-foreground truncate">{c.category}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 text-[11px] font-mono">
                    <span className="text-muted-foreground">{e.rounds} round{e.rounds === 1 ? "" : "s"}</span>
                    <span className="text-teal-400">{fmtAmount(e.totalRaised)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-white/[0.02]">
                <tr>
                  <th className="text-left px-4 py-3">Company</th>
                  <th className="text-left px-4 py-3">Category</th>
                  <th className="text-right px-4 py-3">Rounds</th>
                  <th className="text-right px-4 py-3">Total raised</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(portfolioAgg.entries()).map(([cslug, e]) => {
                  const c = portfolioCompanies.data?.get(cslug);
                  return (
                    <tr
                      key={cslug}
                      onClick={() => navigate(`/companies/${cslug}`)}
                      className="border-t border-white/[0.04] hover:bg-white/[0.02] cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <CompanyLogo logo={c?.logo || null} url={null} name={c?.name || e.name} className="w-6 h-6 rounded" />
                          <span className="font-medium text-white">{c?.name || e.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{c?.category || "—"}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground font-mono">{e.rounds}</td>
                      <td className="px-4 py-3 text-right font-mono text-teal-400">{fmtAmount(e.totalRaised)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent, icon }: { label: string; value: React.ReactNode; accent?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-xl font-bold font-mono ${accent || "text-white"}`}>{value}</div>
    </div>
  );
}
