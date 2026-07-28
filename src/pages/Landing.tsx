import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { RadarScanner } from "@/components/RadarScanner";
import {
  ArrowRight, ShieldCheck, Activity, Code2, GitBranch, Check,
  Banknote, Building2, Users, Bug, ListChecks, Award, Boxes, Bell,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { Logo } from "@/components/Logo";

export default function Landing() {
  const { user } = useAuth();

  const statsQ = useQuery({
    queryKey: ["landing-stats-v3"],
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
    { icon: <ShieldCheck className="w-5 h-5" />, title: "Audits", stat: n(s?.audits), sub: "Every report, severity-scored" },
    { icon: <ListChecks className="w-5 h-5" />, title: "Findings", stat: n(s?.findings), sub: "Individual issues — Crit / High / Med / Low" },
    { icon: <Award className="w-5 h-5" />, title: "Auditors", stat: n(s?.auditors), sub: "Firm portfolios & auditor rotations" },
    { icon: <Building2 className="w-5 h-5" />, title: "Company database", stat: n(s?.companies), sub: "Protocols, profiles & categories" },
    { icon: <Banknote className="w-5 h-5" />, title: "Funding rounds", stat: n(s?.funding), sub: "Investors, amounts & dates" },
    { icon: <Users className="w-5 h-5" />, title: "Contacts & contact info", stat: "Verified", sub: "Decision-makers, emails & LinkedIn" },
    { icon: <GitBranch className="w-5 h-5" />, title: "GitHub activity", stat: "Live", sub: "Commit signals — who's shipping now" },
    { icon: <Boxes className="w-5 h-5" />, title: "On-chain footprint", stat: n(s?.onchain), sub: "Contracts & deployments per protocol" },
    { icon: <Bug className="w-5 h-5" />, title: "Hacks & exploits", stat: n(s?.hacks), sub: "Amount lost, technique & vector" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="sticky top-0 z-30 backdrop-blur bg-background/70 border-b" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}>
        <div className="max-w-[1100px] mx-auto px-4 lg:px-6 h-14 flex items-center justify-between">
          <Link to="/"><Logo size={22} /></Link>
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
      <section className="relative max-w-[1100px] mx-auto px-4 lg:px-6 pt-20 pb-10 text-center">
        <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[720px] h-[420px] rounded-full bg-primary/[0.10] blur-[120px]" />
        <div className="relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/30 bg-primary/[0.08] text-[10.5px] uppercase tracking-[0.14em] text-primary font-semibold">
          <Activity className="w-3 h-3 animate-pulse" />
          {s ? `${n(s.audits)} audits · ${n(s.audits24h)} added today` : "Live security data"}
        </div>
        <h1 className="relative text-5xl md:text-7xl font-bold tracking-[-0.03em] leading-[0.98] mt-6 max-w-[860px] mx-auto">
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

        {/* On-brand radar — continuously sweeping + surfacing targets */}
        <div className="relative flex flex-col items-center mt-10">
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="w-[340px] h-[340px] rounded-full bg-primary/[0.06] blur-[90px]" />
          </div>
          <RadarScanner active size={300} />
          <div className="relative text-[11.5px] text-muted-foreground mt-3 inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Continuously scanning {s ? n(s.companies) : "22,000+"} protocols for new audits &amp; targets
          </div>
        </div>
      </section>

      {/* Card grid */}
      <section className="max-w-[1100px] mx-auto px-4 lg:px-6 pb-6">
        <div className="text-center mb-8">
          <div className="text-[10px] uppercase tracking-[0.16em] text-primary font-semibold">Inside the app</div>
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mt-1.5">Everything we track, in one place</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {CARDS.map((c) => (
            <div
              key={c.title}
              className="group relative rounded-2xl p-5 bg-gradient-to-b from-white/[0.04] to-white/[0.01] border border-white/[0.07] ring-1 ring-inset ring-white/[0.02] transition-all duration-200 hover:border-primary/40 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_-12px_rgba(34,211,238,0.35)]"
            >
              {/* verified check — echoes the audit/security brand */}
              <div className="absolute top-4 right-4 w-5 h-5 rounded-full bg-emerald-400/15 text-emerald-300 flex items-center justify-center ring-1 ring-emerald-400/25">
                <Check className="w-3 h-3" strokeWidth={3} />
              </div>
              <div className="w-11 h-11 rounded-xl bg-primary/[0.12] text-primary flex items-center justify-center ring-1 ring-primary/20 group-hover:bg-primary/[0.18] transition-colors">
                {c.icon}
              </div>
              <div className="text-[28px] leading-none font-semibold tabular-nums mt-4 text-foreground tracking-tight">{c.stat}</div>
              <div className="text-[14.5px] font-semibold text-foreground mt-2">{c.title}</div>
              <div className="text-[12px] text-muted-foreground mt-1 leading-relaxed">{c.sub}</div>
            </div>
          ))}
        </div>
        <div className="text-center text-[11.5px] text-muted-foreground mt-5">Sign up free to explore every module.</div>
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
            App access is $49.99/mo for every module and alerts. Add the developer API for $89/mo.
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
          <Logo size={18} />
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
