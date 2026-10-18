import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type LandingStats = {
  audits: number; findings: number; auditors: number; companies: number;
  funding: number; hacks: number; onchain: number; audits24h: number;
};

// Data tables are subscriber-only; marketing pages read counts from a public
// function backed by a cache table refreshed every 10 minutes.
export function useLandingStats() {
  return useQuery({
    queryKey: ["landing-stats-v4"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("public_landing_stats");
      if (error) throw error;
      return data as LandingStats;
    },
  });
}

export const fmtCount = (x?: number) => (x == null ? "…" : x.toLocaleString());
