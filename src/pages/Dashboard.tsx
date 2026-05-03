import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { supabase, type Protocol, type SignalAlert } from "@/lib/supabase";
import { formatTvl } from "@/lib/format";
import { SeverityBadge } from "@/components/RiskBadge";

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="as-card p-5">
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`mt-2 text-3xl font-bold font-mono ${accent || "text-white"}`}>{value}</div>
    </div>
  );
}

export default function Dashboard() {
  const stats = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [tracked, highRisk, unaudited, bountied] = await Promise.all([
        supabase.from("protocols").select("*", { count: "exact", head: true }),
        supabase.from("protocols").select("*", { count: "exact", head: true }).gte("security_score", 70),
        supabase
          .from("protocols")
          .select("*", { count: "exact", head: true })
          .is("last_audit_date", null)
          .gte("tvl_usd", 500000),
        supabase.from("protocols").select("*", { count: "exact", head: true }).is("has_bug_bounty", true),
      ]);
      return {
        tracked: tracked.count ?? 0,
        highRisk: highRisk.count ?? 0,
        unaudited: unaudited.count ?? 0,
        bountied: bountied.count ?? 0,
      };
    },
  });

  const topRisk = useQuery({
    queryKey: ["top-by-tvl"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("protocols")
        .select("slug,name,category,tvl_usd,security_score")
        .order("tvl_usd", { ascending: false, nullsFirst: false })
        .limit(5);
      if (error) throw error;
      return data as Protocol[];
    },
  });

  const signals = useQuery({
    queryKey: ["recent-signals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("signal_alerts")
        .select("*")
        .order("fired_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as SignalAlert[];
    },
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Protocols Tracked" value={stats.data?.tracked ?? "—"} />
        <StatCard label="High Risk" value={stats.data?.highRisk ?? "—"} accent="text-destructive" />
        <StatCard label="Unaudited (≥$500K TVL)" value={stats.data?.unaudited ?? "—"} accent="text-warning" />
        <StatCard label="Have Bug Bounty" value={stats.data?.bountied ?? "—"} accent="text-success" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="as-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Top Risk Protocols</h3>
            <Link to="/protocols" className="text-xs text-primary hover:underline">
              View all →
            </Link>
          </div>
          {topRisk.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 bg-white/[0.03] rounded animate-pulse" />)}</div>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {topRisk.data?.map((p) => (
                <Link
                  to={`/protocols/${p.slug}`}
                  key={p.slug}
                  className="flex items-center justify-between py-3 hover:bg-white/[0.02] -mx-2 px-2 rounded"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.category || "—"}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono text-xs text-muted-foreground">{formatTvl(p.tvl_usd)}</span>
                    <RiskBadge score={p.security_score} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="as-card p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Recent Signals</h3>
          {signals.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 bg-white/[0.03] rounded animate-pulse" />)}</div>
          ) : signals.data && signals.data.length > 0 ? (
            <div className="divide-y divide-white/[0.05]">
              {signals.data.map((s) => (
                <div key={s.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-white truncate">{s.protocol_name || s.protocol_slug}</div>
                    <div className="text-xs text-muted-foreground font-mono">{s.alert_type}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <SeverityBadge severity={s.severity} />
                    <span className="text-xs text-muted-foreground font-mono">
                      {formatDistanceToNow(new Date(s.fired_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-8 text-center">No signals yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
