import { Link } from "react-router-dom";
import {
  ArrowRight, ShieldCheck, Activity, Code2, GitBranch, Check,
  Banknote, Building2, Bug, ListChecks, Award, Boxes, Bell,
  Radar, Layers, Search, Lock,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useLandingStats, fmtCount as n } from "@/hooks/useLandingStats";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useForceDarkTheme } from "@/hooks/useTheme";
import { SiteNav } from "@/components/marketing/SiteNav";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { LazyRadar } from "@/components/marketing/LazyRadar";
import { LatestAuditsPreview } from "@/components/marketing/LatestAuditsPreview";
import { Faq } from "@/components/marketing/Faq";
import { PERSONAS } from "@/components/marketing/personas";

const PLAN_TERMS = "$99/month, or $990/year with 2 months free. Cancel any time.";

const FAQS = [
  {
    q: "What is a security audit?",
    a: "Crypto projects run as code that holds real money. Before launch, and after major changes, they pay an independent security firm to review that code for flaws. The firm publishes a report listing each problem it found, graded from critical to low. That report is an audit.",
  },
  {
    q: "Where does the data come from?",
    a: "From public sources only: reports published by audit firms on their websites and GitHub (where code and reports are posted), project documentation, DefiLlama for hacks and project data, and public funding databases. Each audit in the app links back to the original report.",
  },
  {
    q: "How fresh is it?",
    a: "We check audit firms' websites and GitHub every 30 minutes, project documentation every hour, and hack sources every 4 hours. The severity breakdown for a new audit is added after we read the report, so it can appear later than the audit itself.",
  },
  {
    q: "Is there a free version?",
    a: "A free account, with no card needed, shows the latest audits and the dataset totals. The full database, the full API and alerts need a paid plan: $99/month, or $990/year.",
  },
  {
    q: "Can I cancel?",
    a: "Yes, any time, from your account page. There is no contract. You keep access until the end of the period you paid for.",
  },
  {
    q: "Do you cover anything outside crypto?",
    a: "No. AuditScope covers security reviews of smart contracts: code that runs on blockchains such as Ethereum and Solana. We don't track traditional software or financial audits.",
  },
];

export default function Landing() {
  useForceDarkTheme();
  const { user } = useAuth();
  usePageMeta(
    "AuditScope: security audit data for crypto projects",
    "Check any crypto project's security record: published audits, the issues they found, and past hacks, in one searchable database and API. $99/month or $990/year.",
    "/",
  );
  const { data: s } = useLandingStats();

  const primaryHref = user ? "/radar" : "/signup";
  const primaryLabel = user ? "Open app" : "Get started";

  const CARDS = [
    { icon: ShieldCheck, title: "Audits", stat: n(s?.audits), sub: "See whether a project's code was independently reviewed, by which firm, and when." },
    { icon: ListChecks, title: "Findings", stat: n(s?.findings), sub: "Read the actual problems each review found, graded critical to low, so you can judge how serious they were." },
    { icon: Award, title: "Audit firms", stat: n(s?.auditors), sub: "Compare security firms by who they have reviewed and what they find. Spot when a project switches firms." },
    { icon: Building2, title: "Projects", stat: n(s?.companies), sub: "Look up a crypto project and see its whole security history on one page." },
    { icon: Bug, title: "Hacks", stat: n(s?.hacks), sub: "Study past hacks: how much was lost and how the attacker got in." },
    { icon: Banknote, title: "Funding rounds", stat: n(s?.funding), sub: "See who backed a project, how much they put in, and when." },
    { icon: GitBranch, title: "Code activity", stat: "Live", sub: "See whether a project's code is still being worked on, and what changed after its last audit." },
    { icon: Boxes, title: "On-chain contracts", stat: n(s?.onchain), sub: "Find the programs a project has deployed on a blockchain (\"on-chain\"), so you can match what is live to what was reviewed." },
  ];

  const STEPS = [
    { icon: Radar, title: "We collect", body: "Every 30 minutes we check the websites and GitHub accounts where audit firms publish their reports, plus project documentation every hour." },
    { icon: Layers, title: "We organize", body: "Each report is matched to the right project and its code, and every issue is put on one severity scale, whatever format the firm used." },
    { icon: Search, title: "You get answers", body: "Search it in the web app, pull it into your own tools through the API, or get a Telegram or Slack alert when something changes." },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded-md focus:bg-primary focus:text-primary-foreground">Skip to content</a>
      <SiteNav />

      <main id="main">
        {/* 1. Hero */}
        <section className="relative max-w-[1100px] mx-auto px-4 lg:px-6 pt-14 md:pt-20 pb-10 text-center">
          <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[min(720px,100vw)] h-[420px] rounded-full bg-primary/[0.10] blur-[120px]" />
          <div className="relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-primary/30 bg-primary/[0.08] text-[11px] uppercase tracking-[0.12em] text-primary font-semibold min-h-[26px]">
            <Activity className="w-3 h-3 motion-safe:animate-pulse" aria-hidden />
            {s ? `${n(s.audits)} audits tracked${s.audits24h > 0 ? ` · ${n(s.audits24h)} added today` : ""}` : "Live security data"}
          </div>
          <h1 className="relative text-[34px] sm:text-5xl md:text-6xl font-bold tracking-[-0.03em] leading-[1.05] mt-6 max-w-[860px] mx-auto">
            Check any crypto project's <span className="text-primary">security record</span> in seconds.
          </h1>
          <p className="relative text-[15.5px] md:text-lg text-muted-foreground max-w-[640px] mx-auto leading-relaxed mt-5">
            Crypto projects hire independent firms to review their code for flaws; those reviews are called audits.
            AuditScope collects {s ? n(s.audits) : "tens of thousands of"} published audits, the issues each one found, and the hacks that followed, so you can judge risk without digging through PDFs.
          </p>
          <div className="relative flex flex-col sm:flex-row gap-2 justify-center mt-7">
            <Link to={primaryHref} className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-5 rounded-md bg-primary text-primary-foreground text-[14px] font-semibold hover:bg-primary/90">
              {primaryLabel} <ArrowRight className="w-4 h-4" aria-hidden />
            </Link>
            <Link to="/docs" className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-5 rounded-md border border-white/[0.14] text-[14px] font-semibold hover:bg-white/[0.04]">
              <Code2 className="w-4 h-4" aria-hidden /> Explore the API
            </Link>
          </div>
          {!user && <p className="relative text-[12.5px] text-muted-foreground mt-3">Free account shows a preview, no card needed. Full access is $99/month or $990/year.</p>}

          <div className="relative flex flex-col items-center mt-10">
            <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="w-[300px] h-[300px] rounded-full bg-primary/[0.06] blur-[90px]" />
            </div>
            <LazyRadar size={300} />
            <p className="relative text-[12.5px] text-muted-foreground mt-3 inline-flex items-center gap-1.5">
              <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse" />
              Tracking {s ? n(s.companies) : "21,000+"} crypto projects for new audits
            </p>
          </div>
        </section>

        {/* 2. Live stats band */}
        <section aria-label="Live counts" className="border-y" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}>
          <dl className="max-w-[1100px] mx-auto px-4 lg:px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {([
              ["Audits", "published security reviews", s?.audits],
              ["Findings", "individual issues found", s?.findings],
              ["Audit firms", "security companies covered", s?.auditors],
              ["Projects", "crypto projects tracked", s?.companies],
            ] as const).map(([label, gloss, v]) => (
              <div key={label} className="flex flex-col-reverse">
                <dt>
                  <span className="block text-[13px] font-semibold text-foreground">{label}</span>
                  <span className="block text-[12px] text-muted-foreground">{gloss}</span>
                </dt>
                <dd className="text-3xl md:text-4xl font-semibold tabular-nums tracking-tight text-primary mb-1 min-h-[1.2em]">{n(v)}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* 3. What you get */}
        <section id="data" className="max-w-[1100px] mx-auto px-4 lg:px-6 py-16 scroll-mt-16">
          <div className="text-center mb-8">
            <div className="text-[11px] uppercase tracking-[0.16em] text-primary font-semibold">What you get</div>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mt-1.5">What you can do with it</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {CARDS.map(({ icon: Icon, title, stat, sub }) => (
              <div
                key={title}
                className="group relative rounded-2xl p-5 bg-gradient-to-b from-white/[0.04] to-white/[0.01] border border-white/[0.07] ring-1 ring-inset ring-white/[0.02] transition-colors duration-200 hover:border-primary/40"
              >
                <div aria-hidden className="absolute top-4 right-4 w-5 h-5 rounded-full bg-emerald-400/15 text-emerald-300 flex items-center justify-center ring-1 ring-emerald-400/25">
                  <Check className="w-3 h-3" strokeWidth={3} />
                </div>
                <div aria-hidden className="w-11 h-11 rounded-xl bg-primary/[0.12] text-primary flex items-center justify-center ring-1 ring-primary/20">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="text-[26px] leading-none font-semibold tabular-nums mt-4 text-foreground tracking-tight">{stat}</div>
                <h3 className="text-[15px] font-semibold text-foreground mt-2">{title}</h3>
                <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">{sub}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Product teaser */}
        <section className="max-w-[1100px] mx-auto px-4 lg:px-6 pb-16">
          <div className="text-center mb-6">
            <div className="text-[11px] uppercase tracking-[0.16em] text-primary font-semibold">Live preview</div>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mt-1.5">The 10 newest audits</h2>
            <p className="text-[13.5px] text-muted-foreground mt-2 max-w-[560px] mx-auto">
              Pulled from the database right now. Subscribers get the full report, the audited code, and every finding.
            </p>
          </div>
          <LatestAuditsPreview ctaHref={user ? "/radar" : "/signup"} ctaLabel={user ? "Open the full database" : "Unlock the full database"} total={s?.audits} />
        </section>

        {/* 4. Who it's for */}
        <section className="max-w-[1100px] mx-auto px-4 lg:px-6 pb-16">
          <div className="text-center mb-8">
            <div className="text-[11px] uppercase tracking-[0.16em] text-primary font-semibold">Who it's for</div>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mt-1.5">Built for people who need to judge crypto risk</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {PERSONAS.map((p, i) => (
              <div key={p.title} className={`as-card p-5 space-y-2 ${i === 0 ? "border-primary/40 bg-gradient-to-br from-primary/[0.06] to-transparent" : ""}`}>
                <p.icon className="w-5 h-5 text-primary" aria-hidden />
                <h3 className="text-[15px] font-semibold text-foreground">{p.title}</h3>
                <p className="text-[13px] text-muted-foreground leading-relaxed">{p.job}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 5. How it works */}
        <section className="max-w-[1100px] mx-auto px-4 lg:px-6 pb-16">
          <div className="text-center mb-8">
            <div className="text-[11px] uppercase tracking-[0.16em] text-primary font-semibold">How it works</div>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mt-1.5">From scattered PDFs to one answer</h2>
          </div>
          <ol className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="as-card p-5 space-y-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-full bg-primary/[0.14] text-primary text-[13px] font-semibold flex items-center justify-center tabular-nums" aria-hidden>{i + 1}</span>
                  <Icon className="w-4 h-4 text-primary" aria-hidden />
                </div>
                <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
                <p className="text-[13px] text-muted-foreground leading-relaxed">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* 6 + 7. API and alerts */}
        <section className="max-w-[1100px] mx-auto px-4 lg:px-6 pb-16 grid md:grid-cols-2 gap-3.5">
          <div className="as-card p-6 space-y-3">
            <div aria-hidden className="w-9 h-9 rounded-md bg-primary/[0.10] text-primary flex items-center justify-center"><Code2 className="w-5 h-5" /></div>
            <h2 className="text-[17px] font-semibold text-foreground">API for your own tools</h2>
            <p className="text-[13.5px] text-muted-foreground leading-relaxed">
              Pull audits, hacks and funding rounds into your spreadsheets, dashboards or risk models as JSON.
              Create a key on your account page; free accounts get a limited key.
            </p>
            <Link to="/docs" className="inline-flex items-center gap-1 min-h-[44px] text-[13.5px] text-primary font-semibold hover:underline rounded">
              Read the API docs <ArrowRight className="w-3.5 h-3.5" aria-hidden />
            </Link>
          </div>
          <div className="as-card p-6 space-y-3">
            <div aria-hidden className="w-9 h-9 rounded-md bg-primary/[0.10] text-primary flex items-center justify-center"><Bell className="w-5 h-5" /></div>
            <h2 className="text-[17px] font-semibold text-foreground">Signal alerts</h2>
            <p className="text-[13.5px] text-muted-foreground leading-relaxed">
              Get a Telegram or Slack message when a project you follow publishes a new audit, raises money, or switches audit firms.
              You pick which signals matter.
            </p>
            <p className="text-[12.5px] font-semibold"><span className="text-emerald-300">Telegram: live</span> <span className="text-muted-foreground">·</span> <span className="text-emerald-300">Slack: live</span></p>
          </div>
        </section>

        {/* 8. Pricing teaser */}
        <section className="max-w-[1100px] mx-auto px-4 lg:px-6 pb-16">
          <div className="as-card p-6 md:p-10 grid md:grid-cols-[1fr_auto] gap-6 items-center border-primary/30 bg-gradient-to-br from-primary/[0.05] to-transparent">
            <div className="space-y-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-primary font-semibold">Pricing</div>
              <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">One plan: $99 a month, or $990 a year</h2>
              <ul className="space-y-1.5 text-[13.5px]">
                {["The full web app and audit archive", "The API", "Signal alerts"].map((f) => (
                  <li key={f} className="flex items-start gap-2"><Check className="w-4 h-4 text-primary shrink-0 mt-0.5" aria-hidden />{f}</li>
                ))}
              </ul>
              <p className="text-[12.5px] text-muted-foreground">{PLAN_TERMS}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Link to={primaryHref} className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-5 rounded-md bg-primary text-primary-foreground text-[14px] font-semibold hover:bg-primary/90">
                {primaryLabel} <ArrowRight className="w-4 h-4" aria-hidden />
              </Link>
              <Link to="/pricing" className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-md border border-white/[0.14] text-[14px] font-semibold hover:bg-white/[0.04]">
                See pricing details
              </Link>
            </div>
          </div>
        </section>

        {/* 9. FAQ */}
        <section className="max-w-[800px] mx-auto px-4 lg:px-6 pb-16">
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-center mb-6">Questions</h2>
          <Faq items={FAQS} />
        </section>

        {/* 10. Final CTA */}
        <section className="max-w-[1100px] mx-auto px-4 lg:px-6 pb-20">
          <div className="as-card p-8 md:p-10 text-center space-y-4">
            <Lock className="w-6 h-6 text-primary mx-auto" aria-hidden />
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">Know the security record before you commit.</h2>
            <p className="text-[13.5px] text-muted-foreground max-w-[520px] mx-auto">{PLAN_TERMS}</p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center pt-1">
              <Link to={primaryHref} className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-5 rounded-md bg-primary text-primary-foreground text-[14px] font-semibold hover:bg-primary/90">
                {primaryLabel} <ArrowRight className="w-4 h-4" aria-hidden />
              </Link>
              <Link to="/docs" className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-5 rounded-md border border-white/[0.14] text-[14px] font-semibold hover:bg-white/[0.04]">
                <Code2 className="w-4 h-4" aria-hidden /> Explore the API
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

