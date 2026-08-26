import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Radar as RadarIcon, TrendingUp, ArrowUpRight, Building2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Lead = {
  slug: string; name: string; category: string | null; logo: string | null;
  last_audit: string | null; last_firm: string | null; months_since: number | null;
  raised_usd: number | null; score: number; reasons: string[];
};

const CATS = ["All", "DeFi", "DEX", "Lending", "Infrastructure", "Real World Assets", "Stablecoin", "Liquid Staking", "Payments"];

export default function Radar() {
  const [cat, setCat] = useState("All");

  const q = useQuery({
    queryKey: ["audit-radar", cat],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("audit_radar", { p_limit: 60, p_category: cat === "All" ? null : cat });
      if (error) throw error;
      return (data ?? []) as Lead[];
    },
  });

  const leads = q.data ?? [];

  return (
    <div className="max-w-[1000px] mx-auto space-y-5">
      <header>
        <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary inline-flex items-center gap-1.5">
          <RadarIcon className="w-3.5 h-3.5" /> Audit Radar
        </div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight mt-0.5">Protocols likely to need an audit</h1>
        <p className="text-[13px] text-muted-foreground mt-1 max-w-[620px]">
          Ranked by audit cadence, recent funding, and time since last review — so you know who to reach out to, and why.
        </p>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {CATS.map((c) => (
          <button key={c} onClick={() => setCat(c)}
            className={`text-[11px] px-2.5 py-1 rounded-md border ${cat === c ? "border-primary/40 bg-primary/[0.08] text-primary" : "border-white/[0.06] text-muted-foreground hover:text-foreground"}`}>
            {c}
          </button>
        ))}
      </div>

      {q.isLoading && <div className="as-card p-6 text-center text-sm text-muted-foreground">Scanning…</div>}
      {!q.isLoading && leads.length === 0 && <div className="as-card p-6 text-center text-sm text-muted-foreground">No leads for this filter.</div>}

      <div className="space-y-2.5">
        {leads.map((l, i) => (
          <Link key={l.slug} to={`/protocol/${l.slug}`}
            className="as-card p-4 flex items-center gap-4 hover:border-primary/40 transition-colors group">
            <div className="text-[11px] font-mono text-muted-foreground/50 w-6 text-right shrink-0">{i + 1}</div>
            <div className="w-10 h-10 rounded-lg bg-white/[0.04] flex items-center justify-center overflow-hidden shrink-0">
              {l.logo ? <img src={l.logo} alt="" className="w-full h-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
                : <Building2 className="w-5 h-5 text-muted-foreground" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[14.5px] font-semibold text-foreground group-hover:text-primary truncate">{l.name}</span>
                {l.category && <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-muted-foreground shrink-0">{l.category}</span>}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                {l.reasons.map((r, j) => (
                  <span key={j} className="text-[11.5px] text-muted-foreground inline-flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-primary/50" />{r}
                  </span>
                ))}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className={`text-lg font-semibold tabular-nums ${l.score >= 80 ? "text-emerald-300" : l.score >= 50 ? "text-amber-300" : "text-muted-foreground"}`}>{l.score}</div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">signal</div>
            </div>
            <ArrowUpRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary shrink-0" />
          </Link>
        ))}
      </div>

      <div className="text-[11px] text-muted-foreground text-center pt-2 inline-flex items-center gap-1.5 justify-center w-full">
        <TrendingUp className="w-3 h-3" /> Signals from audit cadence + funding data. GitHub commit velocity coming soon.
      </div>
    </div>
  );
}
