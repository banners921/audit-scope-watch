import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Row = {
  project: string | null; firm: string | null; date: string | null; scored: boolean;
  critical: number | null; high: number | null; medium: number | null; low: number | null;
};

const SEV = [
  { key: "critical", label: "Critical", cls: "text-rose-300" },
  { key: "high", label: "High", cls: "text-orange-300" },
  { key: "medium", label: "Medium", cls: "text-amber-200" },
  { key: "low", label: "Low", cls: "text-sky-200" },
] as const;

// Public teaser of the 10 newest audits. public_latest_audits() returns only
// project, firm, date and severity counts; report links stay subscriber-only.
export function LatestAuditsPreview({ ctaHref, ctaLabel, total }: { ctaHref: string; ctaLabel: string; total?: number }) {
  const q = useQuery({
    queryKey: ["public-latest-audits"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("public_latest_audits");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  const rows = q.data ?? [];
  const sev = (r: Row, k: (typeof SEV)[number]["key"]) => (r.scored && r[k] != null ? String(r[k]) : "–");

  return (
    <div className="as-card overflow-hidden">
      {/* Desktop table */}
      <table className="hidden md:table w-full text-[13px]">
        <caption className="sr-only">The 10 most recent security audits in AuditScope</caption>
        <thead>
          <tr className="border-b border-white/[0.06] text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <th scope="col" className="px-4 py-3 font-semibold">Project</th>
            <th scope="col" className="px-4 py-3 font-semibold">Audit firm</th>
            <th scope="col" className="px-4 py-3 font-semibold">Date</th>
            {SEV.map((s) => <th key={s.key} scope="col" className="px-3 py-3 font-semibold text-right">{s.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-white/[0.04]">
              <td className="px-4 py-2.5 font-medium text-foreground max-w-[260px] truncate">{r.project || "Unnamed project"}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{r.firm}</td>
              <td className="px-4 py-2.5 text-muted-foreground font-mono tabular-nums">{r.date}</td>
              {r.scored
                ? SEV.map((s) => <td key={s.key} className={`px-3 py-2.5 text-right tabular-nums ${s.cls}`}>{sev(r, s.key)}</td>)
                : <td colSpan={4} className="px-3 py-2.5 text-right text-muted-foreground text-[12px]">Severity pending</td>}
            </tr>
          ))}
          {q.isLoading && Array.from({ length: 10 }, (_, i) => (
            <tr key={i} className="border-b border-white/[0.04]"><td colSpan={7} className="px-4 py-2.5"><div className="h-4 rounded bg-white/[0.04]" /></td></tr>
          ))}
        </tbody>
      </table>

      {/* Mobile list */}
      <ul className="md:hidden divide-y divide-white/[0.05]" aria-label="The 10 most recent security audits">
        {rows.map((r, i) => (
          <li key={i} className="px-4 py-3">
            <div className="font-medium text-foreground text-[14px] break-words">{r.project || "Unnamed project"}</div>
            <div className="text-[12.5px] text-muted-foreground mt-0.5">{r.firm} · <span className="font-mono tabular-nums">{r.date}</span></div>
            <div className="text-[12px] mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {r.scored
                ? SEV.map((s) => <span key={s.key} className={s.cls}>{s.label} {sev(r, s.key)}</span>)
                : <span className="text-muted-foreground">Severity pending</span>}
            </div>
          </li>
        ))}
        {q.isLoading && Array.from({ length: 10 }, (_, i) => <li key={i} className="px-4 py-3"><div className="h-10 rounded bg-white/[0.04]" /></li>)}
      </ul>
      {q.isError && <p className="px-4 py-6 text-[13px] text-muted-foreground">The preview couldn't load right now.</p>}

      {/* Locked row */}
      <div className="relative border-t border-white/[0.06]">
        <div aria-hidden className="select-none blur-[3px] opacity-50 px-4 py-3 text-[13px] text-muted-foreground font-mono">
          Full report · audited code · every finding · {total ? `${total.toLocaleString()} audits in total` : "the full archive"}
        </div>
        <div className="absolute inset-0 flex items-center justify-center gap-3 px-4 bg-background/40">
          <Lock className="w-4 h-4 text-primary shrink-0" aria-hidden />
          <Link to={ctaHref} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-md bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90">
            {ctaLabel} <ArrowRight className="w-4 h-4" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}
