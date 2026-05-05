export function formatTvl(value: number | null | undefined): string {
  if (value == null) return "—";
  const n = Number(value);
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(0)}`;
}

export function formatPct(value: number | null | undefined): string {
  if (value == null) return "—";
  const n = Number(value);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function riskTier(score: number | null | undefined): "high" | "medium" | "low" | "unknown" {
  if (score == null) return "unknown";
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export function normalizeTwitterUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("@")) return `https://x.com/${v.slice(1)}`;
  return `https://x.com/${v}`;
}

export function auditStatusOf(date: string | null | undefined): "never" | "stale" | "recent" {
  if (!date) return "never";
  const days = (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24);
  return days > 365 ? "stale" : "recent";
}
