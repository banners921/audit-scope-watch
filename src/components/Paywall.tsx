import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Lock, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { startCheckout } from "@/lib/checkout";

type Preview = {
  stats: { audits: number; findings: number; auditors: number; companies: number; funding: number; hacks: number };
  recent: { project: string | null; firm: string | null; date: string | null }[];
};

const INCLUDED = [
  "Every audit, finding, audit firm and project, with full history and report links",
  "Funding rounds, funds, security investors, hacks and bug bounties",
  "Radar, monitors and signal alerts",
  "Full REST API access",
];

// Shown in place of any data page for a signed-in user without paid access.
// The preview comes from paywall_preview(): counts plus the newest audits'
// project, firm and date; nothing else is readable until they subscribe.
export function Paywall() {
  const [starting, setStarting] = useState(false);
  const previewQ = useQuery({
    queryKey: ["paywall-preview"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("paywall_preview");
      if (error) throw error;
      return data as Preview;
    },
  });
  const p = previewQ.data;
  const n = (x?: number) => (x == null ? "…" : x.toLocaleString());

  const start = async () => {
    setStarting(true);
    await startCheckout();
    setStarting(false);
  };

  return (
    <div className="max-w-[880px] mx-auto space-y-4">
      <section className="as-card p-6 md:p-8 border-primary/30 bg-gradient-to-br from-primary/[0.05] to-transparent">
        <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary inline-flex items-center gap-1.5">
          <Lock className="w-3 h-3" /> Subscription required
        </div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight mt-1.5">Unlock the full AuditScope dataset</h1>
        <p className="text-[13px] text-muted-foreground mt-2 max-w-[560px]">
          Start a 7-day free trial, then $79/month. Card required; cancel any time before the trial ends and you won't be charged.
        </p>
        <ul className="mt-4 space-y-1.5 text-[12.5px]">
          {INCLUDED.map((f) => (
            <li key={f} className="flex items-start gap-2"><Check className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" /><span>{f}</span></li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={start}
            disabled={starting}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-60"
          >
            {starting ? "Opening checkout…" : "Start 7-day free trial"} <ArrowRight className="w-4 h-4" />
          </button>
          <span className="text-[11.5px] text-muted-foreground">Then $79/mo · the trial is for first-time subscribers</span>
        </div>
      </section>

      <section className="as-card p-5">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {([
            ["Audits", p?.stats.audits], ["Findings", p?.stats.findings], ["Auditors", p?.stats.auditors],
            ["Companies", p?.stats.companies], ["Funding rounds", p?.stats.funding], ["Hacks", p?.stats.hacks],
          ] as const).map(([label, v]) => (
            <div key={label}>
              <div className="text-lg font-semibold tabular-nums text-foreground">{n(v)}</div>
              <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="as-card p-5">
        <div className="flex items-center gap-2 mb-3 text-primary">
          <ShieldCheck className="w-4 h-4" /><h2 className="text-[13px] font-semibold text-foreground">Latest audits</h2>
          <span className="text-[11px] text-muted-foreground ml-1">findings, reports and repos unlock with a subscription</span>
        </div>
        <div className="space-y-1.5">
          {(p?.recent ?? []).map((r, i) => (
            <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-lg border border-white/[0.05] text-[12.5px]">
              <span className="flex-1 min-w-0 truncate text-foreground font-medium">{r.project || "Unknown project"}</span>
              <span className="text-muted-foreground truncate max-w-[200px]">{r.firm}</span>
              <span className="text-muted-foreground font-mono tabular-nums">{r.date}</span>
              <Lock className="w-3 h-3 text-muted-foreground/60 shrink-0" />
            </div>
          ))}
          {previewQ.isLoading && <div className="text-[12.5px] text-muted-foreground">Loading…</div>}
        </div>
      </section>
    </div>
  );
}
