import { riskTier } from "@/lib/format";

export function RiskBadge({ score }: { score: number | null | undefined }) {
  const tier = riskTier(score);
  const cls =
    tier === "high"
      ? "bg-destructive/15 text-destructive border-destructive/30"
      : tier === "medium"
      ? "bg-warning/15 text-warning border-warning/30"
      : tier === "low"
      ? "bg-success/15 text-success border-success/30"
      : "bg-muted text-muted-foreground border-white/10";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md font-mono text-xs font-semibold border ${cls}`}>
      {score ?? "—"}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string | null | undefined }) {
  const s = (severity || "").toLowerCase();
  const cls =
    s === "critical" || s === "high"
      ? "bg-destructive/15 text-destructive border-destructive/30"
      : s === "medium"
      ? "bg-warning/15 text-warning border-warning/30"
      : s === "low"
      ? "bg-success/15 text-success border-success/30"
      : "bg-muted text-muted-foreground border-white/10";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border uppercase tracking-wide ${cls}`}>
      {severity || "info"}
    </span>
  );
}
