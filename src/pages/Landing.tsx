import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, ShieldCheck, Activity, Code2, GitBranch, Lock,
  Banknote, Building2, Users, Bug, ListChecks, Award, Boxes, Bell,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export default function Landing() {
  const { user } = useAuth();

  const statsQ = useQuery({
    queryKey: ["landing-stats-v2"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const [audits, findings, auditors, companies, funding, hacks, onchain, audits24h] = await Promise.all([
        supabase.from("audit_history").select("id", { count: "exact", head: true }),
        supabase.from("audit_findings_detail").select("id", { count: "exact", head: true }),
        supabase.from("audit_firm_meta").select("firm_name", { count: "exact", head: true }),
        supabase.from("companies").select("slug", { count: "exact", head: true }),
        supabase.from("funding_rounds").select("id", { count: "exact", head: true }),
        supabase.from("hacks").select("id", { count: "exact", head: true }),
        supabase.from("chain_addresses").select("id", { count: "exact", head: true }),
        supabase.from("audit_history").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 24 * 3600000).toISOString()),
      ]);
      return {
        audits: audits.count ?? 0, findings: findings.count ?? 0, auditors: auditors.count ?? 0,
        companies: companies.count ?? 0, funding: funding.count ?? 0, hacks: hacks.count ?? 0,
        onchain: onchain.count ?? 0, audits24h: audits24h.count ?? 0,
      };
    },
  });
  const s = statsQ.data;
  const n = (x?: number) => (x == null ? "—" : x.toLocaleString());

  const primaryHref = user ? "/dashboard" : "/signup";
  const primaryLabel = user ? "Open app" : "Start free";

  const CARDS = [
    { icon: <ShieldCheck className="w-5 h-5" />, title: "Audits", stat: n(s?.audits), sub: "Every report, severity-scored", locked: false },
    { icon: <ListChecks className="w-5 h-5" />, title: "Findings", stat: n(s?.findings), sub: "Individual issues — Crit / High / Med / Low", locked: true },
    { icon: <Award className="w-5 h-5" />, title: "Auditors", stat: n(s?.auditors), sub: "Firm portfolios & auditor rotations", locked: false },
    { icon: <Building2 className="w-5 h-5" />, title: "Company database", stat: n(s?.companies), sub: "Protocols, profiles & categories", locked: false },
    { icon: <Banknote className="w-5 h-5" />, title: "Funding rounds", stat: n(s?.funding), sub: "Investors, amounts & dates", locked: true },
    { icon: <Users className="w-5 h-5" />, title: "Contacts & contact info", stat: "Verified", sub: "Decision-makers, emails & LinkedIn", locked: true },
    { icon: <GitBranch className="w-5 h-5" />, title: "GitHub activity", stat: "Live", sub: "Commit signals — who's shipping now", locked: true },
    { icon: <Boxes className="w-5 h-5" />, title: "On-chain footprint", stat: n(s?.onchain), sub: "Contracts & deployments per protocol", locked: false },
    { icon: <Bug className="w-5 h-5" />, title: "Hacks & exploits", stat: n(s?.hacks), sub: "Amount lost, technique & vector", locked: false },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="sticky top-0 z-30 backdrop-blur bg-background/70 border-b" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}>
        <div className="max-w-[1100px] mx-auto px-4 lg:px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-bold tracking-tight">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <span className="text-[15px]">AuditScope<span className="text-primary">.ai</span></span>
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/docs" className="text-[12.5px] text-muted-foreground hover:text-foreground px-3 py-1.5 hidden sm:inline">API docs</Link>
            {user ? (
              <Link to="/dashboard" className="text-[12.5px] inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-semibold hover:bg-primary/90">
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
      <section className="max-w-[1100px] mx-auto px-4 lg:px-6 pt-16 pb-10 text-center">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/30 bg-primary/[0.08] text-[10.5px] uppercase tracking-[0.14em] text-primary font-semibold">
          <Activity className="w-3 h-3 animate-pulse" />
          {s ? `${n(s.audits)} audits · ${n(s.audits24h)} added today` : "Live data"}
        </div>
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05] mt-5 max-w-[820px] mx-auto">
          The web3 security<br /><span className="text-primary">data platform.</span>
        </h1>
        <p className="text-[15px] md:text-lg text-muted-foreground max-w-[600px] mx-auto leading-relaxed mt-5">
          Audits, findings, auditors, protocols, funding, contacts and on-chain signals —
          one database for security teams that need to know who to reach and when.
        </p>
        <div className="flex flex-wrap gap-2 justify-center mt-6">
          <Link to={primaryHref} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90">
            {primaryLabel} <ArrowRight className="w-4 h-4" />
          </Link>
          <Link to="/docs" className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-md border border-white/[0.10] text-[13px] font-semibold hover:bg-white/[0.04]">
            <Code2 className="w-4 h-4" /> Get the API
          </Link>
        </div>
        <div className="text-[11px] text-muted-foreground mt-3">Free to start · No card required</div>
      </section>

      {/* THE CARD GRID — what you get */}
      <section className="max-w-[1100px] mx-auto px-4 lg:px-6 pb-6">
        <div className="text-center mb-6">
          <div className="text-[10px] uppercase tracking-[0.16em] text-primary font-semibold">Inside the app</div>
          <h2 className="text-xl md:text-2xl font-semibold tracking-tight mt-1">Everything we track, in one place</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {CARDS.map((c) => <DataCard key={c.title} {...c} />)}
        </div>
        <div className="text-center text-[11.5px] text-muted-foreground mt-4">
          <Lock className="w-3 h-3 inline mr-1 -mt-0.5" />
          Locked modules unlock with a paid plan. Start free to explore the rest.
        </div>
      </section>

      {/* API + Alerts */}
      <section className="max-w-[1100px] mx-auto px-4 lg:px-6 py-14 grid md:grid-cols-2 gap-3">
        <div className="as-card p-6 space-y-3">
          <div className="w-9 h-9 rounded-md bg-primary/[0.10] text-primary flex items-center justify-center"><Code2 className="w-5 h-5" /></div>
          <div className="text-[15px] font-semibold text-foreground">Developer API</div>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            Pull audits, trends-by-firm, hacks and funding straight into your pipeline. Generate a key
            in one click on your account page — trial keys work in minutes.
          </p>
          <Link to="/docs" className="text-[12.5px] text-primary font-semibold inline-flex items-center gap-1 hover:underline">
            Read the API docs <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="as-card p-6 space-y-3">
          <div className="w-9 h-9 rounded-md bg-primary/[0.10] text-primary flex items-center justify-center"><Bell className="w-5 h-5" /></div>
          <div className="text-[15px] font-semibold text-foreground">Signal alerts</div>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            Get pinged the moment a protocol you care about ships a new audit, raises a round, or an
            auditor rotates — Slack &amp; Telegram, tailored to exactly the signals you pick.
          </p>
          <span className="text-[11px] text-amber-300 font-semibold">Telegram live · Slack coming soon</span>
        </div>
      </section>

      {/* Upsell */}
      <section className="max-w-[1100px] mx-auto px-4 lg:px-6 pb-24">
        <div className="as-card p-8 md:p-10 text-center space-y-4">
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">Start free. Upgrade when it pays for itself.</h2>
          <p className="text-[13.5px] text-muted-foreground max-w-[560px] mx-auto">
            Free trial browses the open modules and a capped API. Paid unlocks findings, funding,
            contacts, GitHub signals, full history and alerts.
          </p>
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
        <div className="max-w-[1100px] mx-auto px-4 lg:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-[12px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span>AuditScope<span className="text-primary">.ai</span></span>
          </div>
          <div className="flex items-center gap-5">
            <Link to="/docs" className="hover:text-foreground">API docs</Link>
            <Link to="/pricing" className="hover:text-foreground">Pricing</Link>
            <a href="https://t.me/web3leads" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">Telegram</a>
            <Link to="/login" className="hover:text-foreground">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function DataCard({ icon, title, stat, sub, locked }: { icon: React.ReactNode; title: string; stat: string; sub: string; locked: boolean }) {
  return (
    <div className={`as-card p-5 relative overflow-hidden ${locked ? "" : "hover:border-primary/40 transition-colors"}`}>
      {locked && (
        <div className="absolute top-3 right-3 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[9.5px] font-semibold uppercase tracking-wider">
          <Lock className="w-2.5 h-2.5" /> Paid
        </div>
      )}
      <div className="w-9 h-9 rounded-md bg-primary/[0.10] text-primary flex items-center justify-center">{icon}</div>
      <div className={`text-2xl font-semibold tabular-nums mt-3 ${locked ? "text-foreground/70 blur-[3px] select-none" : "text-foreground"}`}>
        {stat}
      </div>
      <div className="text-[14px] font-semibold text-foreground mt-1">{title}</div>
      <div className="text-[12px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}
