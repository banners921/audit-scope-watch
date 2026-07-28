import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { Users, Activity, KeyRound, Crown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

type Row = {
  user_id: string; email: string; plan_tier: string | null; subscription_status: string | null;
  signed_up: string; active_keys: number; calls_30d: number; last_activity: string | null;
};

export default function Admin() {
  const { user } = useAuth();

  const meQ = useQuery({
    queryKey: ["admin-me", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("user_profiles").select("is_admin").eq("user_id", user!.id).maybeSingle();
      return !!data?.is_admin;
    },
  });

  const rowsQ = useQuery({
    queryKey: ["admin-overview"],
    enabled: meQ.data === true,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_user_overview");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  if (meQ.isLoading) return <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>;
  if (meQ.data !== true) return <Navigate to="/dashboard" replace />;

  const rows = rowsQ.data ?? [];
  const paying = rows.filter((r) => r.plan_tier && r.plan_tier !== "free").length;
  const active30 = rows.filter((r) => r.calls_30d > 0).length;

  return (
    <div className="max-w-[1200px] mx-auto space-y-5">
      <header>
        <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary">Admin</div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight mt-0.5">Users &amp; activity</h1>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={<Users className="w-4 h-4" />} label="Total users" value={rows.length} />
        <Stat icon={<Crown className="w-4 h-4" />} label="Paying" value={paying} tone="good" />
        <Stat icon={<Activity className="w-4 h-4" />} label="Active (30d API)" value={active30} />
        <Stat icon={<KeyRound className="w-4 h-4" />} label="Total keys" value={rows.reduce((n, r) => n + (r.active_keys || 0), 0)} />
      </div>

      <div className="as-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2.5">User</th>
                <th className="px-3 py-2.5">Plan</th>
                <th className="px-3 py-2.5">Signed up</th>
                <th className="px-3 py-2.5 text-right">Keys</th>
                <th className="px-3 py-2.5 text-right">API calls 30d</th>
                <th className="px-3 py-2.5">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rowsQ.isLoading && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>}
              {rows.map((r) => {
                const paid = r.plan_tier && r.plan_tier !== "free";
                return (
                  <tr key={r.user_id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 text-foreground">{r.email}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wider font-semibold ${paid ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300" : "bg-white/[0.04] border-white/10 text-muted-foreground"}`}>
                        {r.plan_tier || "free"}{r.subscription_status ? ` · ${r.subscription_status}` : ""}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground tabular-nums">{fmt(r.signed_up)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.active_keys}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-primary">{(r.calls_30d ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-muted-foreground tabular-nums">{r.last_activity ? fmt(r.last_activity) : "—"}</td>
                  </tr>
                );
              })}
              {!rowsQ.isLoading && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No users yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone?: "good" }) {
  return (
    <div className="as-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">{icon}{label}</div>
      <div className={`text-2xl font-semibold tabular-nums mt-1 ${tone === "good" ? "text-emerald-300" : "text-foreground"}`}>{value.toLocaleString()}</div>
    </div>
  );
}

function fmt(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}
