import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";

type BugBounty = {
  platform: string | null;
  max_bounty_usd: number | null;
  program_url: string | null;
  is_active: boolean | null;
  protocol_slug: string | null;
  company_slug: string | null;
};

function fmtBounty(n: number | null | undefined): string {
  if (n == null) return "Undisclosed";
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "Undisclosed";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

export function BugBountyList({
  protocolSlug,
  companySlug,
}: {
  protocolSlug?: string | null;
  companySlug?: string | null;
}) {
  const q = useQuery({
    queryKey: ["bug-bounties", protocolSlug || null, companySlug || null],
    enabled: !!(protocolSlug || companySlug),
    queryFn: async () => {
      const results: BugBounty[] = [];
      if (protocolSlug) {
        const { data, error } = await supabase
          .from("bug_bounties")
          .select("*")
          .eq("protocol_slug", protocolSlug)
          .eq("is_active", true);
        if (error) throw error;
        results.push(...((data || []) as BugBounty[]));
      }
      if (companySlug) {
        const { data, error } = await supabase
          .from("bug_bounties")
          .select("*")
          .eq("company_slug", companySlug)
          .eq("is_active", true);
        if (error) throw error;
        results.push(...((data || []) as BugBounty[]));
      }
      const seen = new Set<string>();
      const dedup: BugBounty[] = [];
      for (const b of results) {
        const key = b.program_url || `${b.platform}|${b.max_bounty_usd}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dedup.push(b);
      }
      dedup.sort((a, b) => (b.max_bounty_usd ?? -1) - (a.max_bounty_usd ?? -1));
      return dedup;
    },
  });

  if (q.isLoading) {
    return <div className="h-16 bg-white/[0.03] rounded animate-pulse" />;
  }
  if (!q.data || q.data.length === 0) {
    return <div className="text-sm text-muted-foreground py-2">No bug bounty program found</div>;
  }
  return (
    <div className="space-y-2">
      {q.data.map((b, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/[0.05]"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm font-medium text-white truncate">{b.platform || "—"}</span>
            <span className="font-mono text-sm font-semibold text-teal-400 whitespace-nowrap">
              {fmtBounty(b.max_bounty_usd)}
            </span>
          </div>
          {b.program_url ? (
            <a
              href={b.program_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 whitespace-nowrap"
            >
              View Program <ExternalLink className="w-3 h-3" />
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}
