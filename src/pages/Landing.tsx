import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, ShieldCheck, Activity, Code2, GitBranch,
  TrendingUp, Banknote, Target, Check,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export default function Landing() {
  const { user } = useAuth();

  const statsQ = useQuery({
    queryKey: ["landing-stats"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const [audits, firms, companies, audits24h] = await Promise.all([
        supabase.from("audit_history").select("id", { count: "exact", head: true }),
        supabase.from("audit_firm_meta").select("firm_name", { count: "exact", head: true }),
        supabase.from("companies").select("slug", { count: "exact", head: true }),
        supabase.from("audit_history").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 24 * 3600000).toISOString()),
      ]);
      return {
        audits: audits.count ?? 0, firms: firms.count ?? 0,
        companies: companies.count ?? 0, audits24h: audits24h.count ?? 0,
      };
    },
  });
  const s = statsQ.data;
  const n = (x?: number) => (x ?? 0).toLocaleString();

  const primaryHref = user ? "/audit-firms" : "/signup";
  const primaryLabel = user ? "Open app" : "Start free";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav — minimal */}
      <nav className="sticky top-0 z-30 backdrop-blur bg-background/70 border-b" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}>
        <div className="max-w-[1080px] mx-auto px-4 lg:px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-bold tracking-tight">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <span className="text-[15px]">AuditScope<span className="text-primary">.ai</span></span>
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/docs" className="text-[12.5px] text-muted-foreground hover:text-foreground px-3 py-1.5 hidden sm:inline">API docs</Link>
            {user ? (
              <Link to="/audit-firms" className="text-[12.5px] inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-semibold hover:bg-primary/90">
                Open app <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            ) : (
              <>
                <Link to="/login" className="text-[12.5px] text-muted-foreground hover:text-foreground px-3 py-1.5">Sign in</Link>
                <Link to="/signup" className="text-[12.5px] inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-semibold hover:bg-primary/90">
                  Start free <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-[1080px] mx-auto px-4 lg:px-6 pt-20 pb-14 text-center">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/30 bg-primary/[0.08] text-[10.5px] uppercase tracking-[0.14em] text-primary font-semibold">
          <Activity className="w-3 h-3 animate-pulse" />
          {s ? `Tracking ${n(s.audits)} audits · ${n(s.audits24h)} added today` : "Live audit data"}
        </div>
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05] mt-5 max-w-[820px] mx-auto">
          Every web3 audit, tracked.<br /><span className="text-primary">Find your next client.</span>
        </h1>
        <p className="text-[15px] md:text-lg text-muted-foreground max-w-[600px] mx-auto leading-relaxed mt-5">
          AuditScope tracks every security audit in crypto, breaks down the findings, and surfaces the
          protocols shopping for a review — so security firms know exactly who to sell to.
        </p>
        <div className="flex flex-wrap gap-2 justify-center mt-7">
          <Link to={primaryHref} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90">
            {primaryLabel} <ArrowRight className="w-4 h-4" />
          </Link>
          <Link to="/docs" className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-md border border-white/[0.10] text-[13px] font-semibold hover:bg-white/[0.04]">
            <Code2 className="w-4 h-4" /> Get the API
          </Link>
        </div>
        <div className="text-[11px] text-muted-foreground mt-3">Free to start · No card required</div>
      </section>

      {/* Live stat strip */}
      <section className="border-y bg-surface/40" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}>
        <div className="max-w-[1080px] mx-auto px-4 lg:px-6 py-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat value={n(s?.audits)} label="Audits tracked" />
          <Stat value={n(s?.firms)} label="Audit firms" />
          <Stat value={n(s?.companies)} label="Protocols" />
          <Stat value={n(s?.audits24h)} label="Added today" tone />
        </div>
      </section>

      {/* What you get — 3 tiles */}
      <section className="max-w-[1080px] mx-auto px-4 lg:px-6 py-20">
        <div className="grid md:grid-cols-3 gap-4">
          <Tile
            icon={<ShieldCheck className="w-5 h-5" />}
            title="Every audit, broken down"
            desc="Firm, protocol, date, and severity breakdown (Critical / High / Medium / Low) for every report — the freshest in crypto, updated continuously."
          />
          <Tile
            icon={<Target className="w-5 h-5" />}
            title="Buying signals"
            desc="GitHub activity, fresh funding rounds, security hiring, and auditor rotations — the leading indicators that a protocol is about to need a review."
          />
          <Tile
            icon={<Code2 className="w-5 h-5" />}
            title="One simple API"
            desc="Pull audits, trends-by-firm, hacks, and funding straight into your pipeline. Generate a key in one click and start in minutes."
          />
        </div>

        {/* signal chips */}
        <div className="flex flex-wrap justify-center gap-2 mt-8 text-[12px] text-muted-foreground">
          {[
            { i: <GitBranch className="w-3.5 h-3.5" />, l: "GitHub commits" },
            { i: <Banknote className="w-3.5 h-3.5" />, l: "Funding rounds" },
            { i: <TrendingUp className="w-3.5 h-3.5" />, l: "Security hiring" },
            { i: <Target className="w-3.5 h-3.5" />, l: "Auditor switches" },
          ].map((c) => (
            <span key={c.l} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.02]">
              {c.i}{c.l}
            </span>
          ))}
        </div>
      </section>

      {/* Upsell — trial → paid */}
      <section className="max-w-[1080px] mx-auto px-4 lg:px-6 pb-24">
        <div className="as-card p-8 md:p-10 text-center space-y-5">
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">Start free. Upgrade when it pays for itself.</h2>
          <div className="flex flex-col sm:flex-row gap-3 justify-center text-[13px] text-muted-foreground max-w-[720px] mx-auto">
            <div className="flex-1 rounded-md border border-white/[0.08] p-4 text-left">
              <div className="text-foreground font-semibold text-[14px] mb-1.5">Free trial</div>
              <ul className="space-y-1.5">
                <li className="flex gap-1.5"><Check className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" /> Browse audits, firms & signals</li>
                <li className="flex gap-1.5"><Check className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" /> API access (recent window, capped)</li>
              </ul>
            </div>
            <div className="flex-1 rounded-md border border-primary/30 bg-primary/[0.04] p-4 text-left">
              <div className="text-primary font-semibold text-[14px] mb-1.5">Paid</div>
              <ul className="space-y-1.5">
                <li className="flex gap-1.5"><Check className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" /> Full history + report URLs</li>
                <li className="flex gap-1.5"><Check className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" /> Higher limits, alerts & webhooks</li>
              </ul>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 justify-center pt-1">
            <Link to={primaryHref} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90">
              {primaryLabel} <ArrowRight className="w-4 h-4" />
            </Link>
            <Link to="/pricing" className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-md border border-white/[0.10] text-[13px] font-semibold hover:bg-white/[0.04]">
              See pricing
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}>
        <div className="max-w-[1080px] mx-auto px-4 lg:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-[12px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span>AuditScope<span className="text-primary">.ai</span></span>
          </div>
          <div className="flex items-center gap-5">
            <Link to="/docs" className="hover:text-foreground">API docs</Link>
            <Link to="/pricing" className="hover:text-foreground">Pricing</Link>
            <Link to="/login" className="hover:text-foreground">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: boolean }) {
  return (
    <div className="text-center">
      <div className={`text-2xl md:text-3xl font-semibold tabular-nums ${tone ? "text-primary" : "text-foreground"}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function Tile({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="as-card p-5 space-y-3">
      <div className="w-9 h-9 rounded-md bg-primary/[0.10] text-primary flex items-center justify-center">{icon}</div>
      <div className="text-[15px] font-semibold text-foreground">{title}</div>
      <p className="text-[13px] text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}
