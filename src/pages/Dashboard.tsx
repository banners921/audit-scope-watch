import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import { ShieldCheck, Banknote, Wallet, Building2, Award, ArrowRight, Code2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export default function Dashboard() {
  const { user } = useAuth();

  const profileQ = useQuery({
    queryKey: ["dashboard-profile", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("plan_tier,company_name")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const stats = useQuery({
    queryKey: ["dashboard-hub-stats"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const [auditCnt, auditLast24, firmCnt, fundingCnt, fundingLast7, companyCnt, hackLast30] = await Promise.all([
        supabase.from("audit_history").select("id", { count: "exact", head: true }),
        supabase.from("audit_history").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 24 * 3600000).toISOString()),
        supabase.from("audit_firm_meta").select("firm_name", { count: "exact", head: true }),
        supabase.from("funding_rounds").select("id", { count: "exact", head: true }),
        supabase.from("funding_rounds").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
        supabase.from("companies").select("slug", { count: "exact", head: true }),
        supabase.from("hacks").select("id", { count: "exact", head: true }).gte("hack_date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)),
      ]);
      return {
        audits: auditCnt.count ?? 0,
        audits_24h: auditLast24.count ?? 0,
        firms: firmCnt.count ?? 0,
        funding: fundingCnt.count ?? 0,
        funding_7d: fundingLast7.count ?? 0,
        companies: companyCnt.count ?? 0,
        hacks_30d: hackLast30.count ?? 0,
      };
    },
  });

  if (profileQ.isLoading) return <div className="p-10 text-center text-xs text-muted-foreground">Loading…</div>;
  if (!profileQ.data) return <Navigate to="/onboarding" replace />;

  const isFree = (profileQ.data.plan_tier || "free") === "free";

  return (
    <div className="max-w-[1200px] mx-auto px-1 py-6 space-y-8">
      <header>
        <h1 className="text-2xl md:text-3xl font-semibold text-foreground tracking-tight">
          {profileQ.data.company_name ? `Welcome back, ${profileQ.data.company_name}.` : "Welcome back."}
        </h1>
        <p className="text-[13px] text-muted-foreground mt-1">Where do you want to go?</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <HubCard
          to="/audit-reports"
          icon={<ShieldCheck className="w-7 h-7" />}
          title="Audits"
          count={stats.data?.audits}
          countLabel="reports indexed"
          ticker={stats.data?.audits_24h ? `${stats.data.audits_24h} new in last 24h` : "Live ingestion"}
        />
        <HubCard
          to="/audit-firms"
          icon={<Award className="w-7 h-7" />}
          title="Auditors"
          count={stats.data?.firms}
          countLabel="audit firms tracked"
          ticker="Portfolios + finding totals"
        />
        <HubCard
          to="/companies"
          icon={<Building2 className="w-7 h-7" />}
          title="Companies"
          count={stats.data?.companies}
          countLabel="protocols indexed"
          ticker={stats.data?.hacks_30d ? `${stats.data.hacks_30d} hacks in last 30d` : "Live"}
        />
        <HubCard
          to="/funding-rounds"
          icon={<Banknote className="w-7 h-7" />}
          title="Funding rounds"
          count={stats.data?.funding}
          countLabel="rounds tracked"
          ticker={stats.data?.funding_7d ? `${stats.data.funding_7d} new this week` : "Live"}
        />
        <HubCard
          to="/funds"
          icon={<Wallet className="w-7 h-7" />}
          title="Funds"
          count={undefined}
          countLabel="Every crypto fund + portfolio"
          ticker="5,000+ funds"
        />
      </div>

      {isFree && (
        <Link
          to="/pricing"
          className="as-card p-5 flex items-center gap-4 border-primary/25 hover:border-primary/50 bg-gradient-to-br from-primary/[0.05] to-transparent transition-colors group"
        >
          <div className="w-11 h-11 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
            <Code2 className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-foreground">Pipe AuditScope into your stack.</div>
            <div className="text-[12px] text-muted-foreground">Full app $49.99/mo · developer API $89/mo.</div>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground/60 group-hover:text-primary group-hover:translate-x-1 transition-all" />
        </Link>
      )}
    </div>
  );
}

function HubCard({
  to, icon, title, count, countLabel, ticker,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  count?: number;
  countLabel: string;
  ticker: string;
}) {
  return (
    <Link
      to={to}
      className="as-card p-6 hover:border-primary/40 transition-all group flex items-center gap-5 min-h-[128px]"
    >
      <div className="w-14 h-14 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[19px] font-semibold text-foreground tracking-tight">{title}</div>
        {count !== undefined ? (
          <div className="text-[12.5px] text-muted-foreground mt-0.5">
            <span className="text-foreground font-mono tabular-nums">{count.toLocaleString()}</span> {countLabel}
          </div>
        ) : (
          <div className="text-[12.5px] text-muted-foreground mt-0.5">{countLabel}</div>
        )}
        <div className="text-[11px] text-muted-foreground mt-2 inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {ticker}
        </div>
      </div>
      <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-1 transition-all shrink-0" />
    </Link>
  );
}
