import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Radar as RadarIcon, AlertTriangle, Sparkles, Clock, Banknote, ArrowUpRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";

type Lead = {
  slug: string; name: string; category: string | null; logo: string | null; url: string | null;
  last_audit: string | null; last_firm: string | null; months_since: number | null; audit_count: number;
  raised_usd: number | null; hacked_recently: boolean; score: number; lead_type: string; reasons: string[];
};

const CATS = ["All", "DeFi", "DEX", "Lending", "Infrastructure", "Real World Assets", "Stablecoin", "Liquid Staking", "Derivatives", "Payments"];

const TYPE_META: Record<string, { cls: string; icon: any }> = {
  "Recently hacked": { cls: "text-rose-300 bg-rose-500/12 border-rose-500/30", icon: AlertTriangle },
  "Funded, never audited": { cls: "text-emerald-300 bg-emerald-500/12 border-emerald-500/30", icon: Sparkles },
  "Overdue for re-audit": { cls: "text-amber-300 bg-amber-500/12 border-amber-500/30", icon: Clock },
  "Freshly funded": { cls: "text-sky-300 bg-sky-500/12 border-sky-500/30", icon: Banknote },
  "Audit dryspell": { cls: "text-muted-foreground bg-white/[0.04] border-white/10", icon: Clock },
};
const LEAD_TYPES = ["All leads", "Recently hacked", "Funded, never audited", "Overdue for re-audit", "Freshly funded"];

export default function Radar() {
  const [cat, setCat] = useState("All");
  const [type, setType] = useState("All leads");

  const q = useQuery({
    queryKey: ["audit-radar-v2", cat],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("audit_radar", { p_limit: 100, p_category: cat === "All" ? null : cat });
      if (error) throw error;
      return (data ?? []) as Lead[];
    },
  });

  const leads = (q.data ?? []).filter((l) => type === "All leads" || l.lead_type === type);

  return (
    <div className="max-w-[1040px] mx-auto space-y-5">
      <header>
        <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary inline-flex items-center gap-1.5">
          <RadarIcon className="w-3.5 h-3.5" /> Audit Radar
        </div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight mt-0.5">Who to pitch this week</h1>
        <p className="text-[13px] text-muted-foreground mt-1 max-w-[640px]">
          Protocols that likely need a security review right now — ranked by urgency, with the reason and their current auditor to displace.
        </p>
      </header>

      {/* lead-type filter */}
      <div className="flex flex-wrap gap-1.5">
        {LEAD_TYPES.map((t) => (
          <button key={t} onClick={() => setType(t)}
            className={`text-[11.5px] px-2.5 py-1 rounded-md border ${type === t ? "border-primary/40 bg-primary/[0.08] text-primary" : "border-white/[0.06] text-muted-foreground hover:text-foreground"}`}>
            {t}
          </button>
        ))}
      </div>
      {/* category filter */}
      <div className="flex flex-wrap gap-1.5">
        {CATS.map((c) => (
          <button key={c} onClick={() => setCat(c)}
            className={`text-[10.5px] px-2 py-1 rounded-md border ${cat === c ? "border-primary/40 bg-primary/[0.08] text-primary" : "border-white/[0.06] text-muted-foreground hover:text-foreground"}`}>
            {c}
          </button>
        ))}
      </div>

      {q.isLoading && <div className="as-card p-6 text-center text-sm text-muted-foreground">Scanning…</div>}
      {!q.isLoading && leads.length === 0 && <div className="as-card p-6 text-center text-sm text-muted-foreground">No leads for this filter.</div>}

      <div className="space-y-2.5">
        {leads.map((l, i) => {
          const meta = TYPE_META[l.lead_type] || TYPE_META["Audit dryspell"];
          const Icon = meta.icon;
          return (
            <Link key={l.slug} to={`/protocol/${l.slug}`}
              className="as-card p-4 flex items-center gap-4 hover:border-primary/40 transition-colors group">
              <div className="text-[11px] font-mono text-muted-foreground/40 w-5 text-right shrink-0">{i + 1}</div>
              <BrandLogo name={l.name} url={l.url} logo={l.logo} className="w-11 h-11 rounded-lg shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[15px] font-semibold text-foreground group-hover:text-primary truncate">{l.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${meta.cls}`}>
                    <Icon className="w-2.5 h-2.5" />{l.lead_type}
                  </span>
                  {l.category && <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-muted-foreground">{l.category}</span>}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                  {l.reasons.map((r, j) => (
                    <span key={j} className="text-[11.5px] text-muted-foreground inline-flex items-center gap-1">
                      <span className="w-1 h-1 rounded-full bg-primary/50" />{r}
                    </span>
                  ))}
                </div>
                {l.last_firm && (
                  <div className="text-[10.5px] text-muted-foreground/70 mt-1">
                    Current auditor: <span className="text-foreground/80">{l.last_firm}</span>
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className={`text-lg font-semibold tabular-nums ${l.score >= 90 ? "text-rose-300" : l.score >= 70 ? "text-amber-300" : "text-primary"}`}>{l.score}</div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">urgency</div>
              </div>
              <ArrowUpRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary shrink-0" />
            </Link>
          );
        })}
      </div>

      <div className="text-[11px] text-muted-foreground text-center pt-2">
        Signals: recent hacks · funding · audit cadence. GitHub activity + live news coming soon.
      </div>
    </div>
  );
}
