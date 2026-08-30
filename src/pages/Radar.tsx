import { useMemo, useState } from "react";
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

const TYPE_META: Record<string, { cls: string; icon: any }> = {
  "Recently exploited": { cls: "text-rose-300 bg-rose-500/12 border-rose-500/30", icon: AlertTriangle },
  "Funded, no audit on file": { cls: "text-emerald-300 bg-emerald-500/12 border-emerald-500/30", icon: Sparkles },
  "Freshly funded": { cls: "text-sky-300 bg-sky-500/12 border-sky-500/30", icon: Banknote },
  "Overdue for re-audit": { cls: "text-amber-300 bg-amber-500/12 border-amber-500/30", icon: Clock },
  "Audit dryspell": { cls: "text-muted-foreground bg-white/[0.04] border-white/10", icon: Clock },
};
const TYPES = ["All", "Recently exploited", "Freshly funded", "Funded, no audit on file", "Overdue for re-audit"];

export default function Radar() {
  const [type, setType] = useState("All");
  const [cat, setCat] = useState("All");

  const q = useQuery({
    queryKey: ["audit-radar-v3"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("audit_radar", { p_limit: 200, p_category: null });
      if (error) throw error;
      return (data ?? []) as Lead[];
    },
  });
  const all = q.data ?? [];

  // categories that actually have leads, by frequency
  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of all) if (l.category) m.set(l.category, (m.get(l.category) ?? 0) + 1);
    return ["All", ...Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([c]) => c)];
  }, [all]);

  const leads = all.filter((l) => (type === "All" || l.lead_type === type) && (cat === "All" || l.category === cat));

  return (
    <div className="max-w-[1040px] mx-auto space-y-4">
      <header>
        <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary inline-flex items-center gap-1.5">
          <RadarIcon className="w-3.5 h-3.5" /> Audit Radar
        </div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight mt-0.5">Who to pitch this week</h1>
        <p className="text-[13px] text-muted-foreground mt-1 max-w-[640px]">
          Smart-contract protocols that likely need a security review now — with the reason and their current auditor to displace.
        </p>
      </header>

      {/* one clean filter row: lead-type chips + category dropdown */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap gap-1.5">
          {TYPES.map((t) => (
            <button key={t} onClick={() => setType(t)}
              className={`text-[11.5px] px-2.5 py-1.5 rounded-md border ${type === t ? "border-primary/40 bg-primary/[0.08] text-primary" : "border-white/[0.06] text-muted-foreground hover:text-foreground"}`}>
              {t}
            </button>
          ))}
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)}
          className="text-[12px] bg-white/[0.03] border border-white/[0.08] rounded-md px-2.5 py-1.5 text-muted-foreground hover:text-foreground">
          {cats.map((c) => <option key={c} value={c}>{c === "All" ? "All sectors" : c}</option>)}
        </select>
      </div>

      <div className="text-[11px] text-muted-foreground">{leads.length} leads</div>

      {q.isLoading && <div className="as-card p-6 text-center text-sm text-muted-foreground">Scanning…</div>}
      {!q.isLoading && leads.length === 0 && <div className="as-card p-6 text-center text-sm text-muted-foreground">No leads for this filter.</div>}

      <div className="space-y-2">
        {leads.map((l, i) => {
          const meta = TYPE_META[l.lead_type] || TYPE_META["Audit dryspell"];
          const Icon = meta.icon;
          return (
            <Link key={l.slug} to={`/protocol/${l.slug}`}
              className="as-card p-4 flex items-center gap-4 hover:border-primary/40 transition-colors group">
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
    </div>
  );
}
