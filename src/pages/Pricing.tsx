import { Link } from "react-router-dom";
import { ArrowRight, Check, Crown, Building2, Code2, Bell, Database, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { startCheckout } from "@/lib/checkout";
import { useLandingStats, fmtCount as n } from "@/hooks/useLandingStats";
import { usePageMeta } from "@/hooks/usePageMeta";
import { SiteNav } from "@/components/marketing/SiteNav";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { Faq, type FaqItem } from "@/components/marketing/Faq";
import { PERSONAS } from "@/components/marketing/personas";

const EVERYTHING_FEATURES = [
  "The full web app: audits, findings, audit firms, projects, funding, hacks and on-chain contracts",
  "Full audit history with links to the original reports",
  "The API: JSON, up to 100,000 calls a month",
  "Signal alerts for new audits, funding and firm switches (Telegram now, Slack soon)",
  "Unlimited watched projects",
  "Cancel any time",
];

const FREE_FEATURES = [
  "Free account, no card needed",
  "Preview of the latest audits and dataset totals",
  "Trial API key (60 calls a minute, 5,000 a month)",
];

const FAQS: FaqItem[] = [
  { q: "Is there a free tier?", a: "A free account shows a preview of the latest audits and comes with a capped trial API key. The full database is for subscribers: $79/month after a 7-day free trial." },
  { q: "What do I get for $79?", a: "Everything: the full web app, the complete audit archive with report links, the API, and signal alerts. One plan, no add-ons." },
  { q: "Do I need a card for the trial?", a: "Yes. The 7-day trial is for first-time subscribers and asks for a card. Cancel before day 7 and you are not charged. A free account without a trial does not need a card." },
  { q: "Where does the data come from?", a: "Public sources: reports published by audit firms on their websites and GitHub, project documentation, DefiLlama, Solodit, Immunefi, HackenProof, RootData and web3leads. Each audit links back to its original report." },
  { q: "How fresh is it?", a: "Audit firms' websites and GitHub are checked every 30 minutes, project documentation every hour, and hack sources every 4 hours. Severity breakdowns are added after we read each report, so they can appear later than the audit." },
  { q: "Can I cancel any time?", a: "Yes. Cancel from your account page. No contract; you keep access until the end of the period you paid for." },
  { q: "What if I need more than 100,000 API calls a month?", a: "Message us. Higher volume, bulk exports and custom feeds are quoted separately." },
];

export default function Pricing() {
  const { user } = useAuth();
  const { data: s } = useLandingStats();
  usePageMeta(
    "Pricing: AuditScope",
    "One plan: $79/month for the full crypto security audit database, the API and alerts. 7-day free trial for first-time subscribers, card required, cancel any time.",
    "/pricing",
  );

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <SiteNav current="pricing" />

      <main className="max-w-[1200px] mx-auto px-4 lg:px-6 py-16">
        {/* Header */}
        <div className="text-center max-w-[720px] mx-auto space-y-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-primary font-semibold">Pricing</div>
          <h1 className="text-[34px] sm:text-4xl md:text-5xl font-semibold tracking-tight">One plan. Everything included.</h1>
          <p className="text-muted-foreground text-[14.5px] leading-relaxed max-w-[600px] mx-auto">
            The full web app, the API and alerts for <span className="text-foreground font-semibold">$79 a month</span>. Try it free for 7 days.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mt-12 max-w-[820px] mx-auto">
          {/* Free */}
          <div className="as-card p-6 flex flex-col gap-5">
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Free</div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold text-foreground tabular-nums">$0</span>
                <span className="text-[12.5px] text-muted-foreground">forever</span>
              </div>
              <div className="text-[12.5px] text-muted-foreground mt-1.5">A look before you start the trial.</div>
            </div>
            <ul className="space-y-2 text-[13px] flex-1">
              {FREE_FEATURES.map((f, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link to={user ? "/dashboard" : "/signup"} className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-md border border-white/[0.10] text-[13px] font-semibold hover:bg-white/[0.04]">
              {user ? "Open app" : "Sign up free"} <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* $79 Everything */}
          <div className="as-card p-6 flex flex-col gap-5 border-primary/40 shadow-[0_0_0_1px_rgba(34,211,238,0.25),0_0_40px_-12px_rgba(34,211,238,0.3)] bg-gradient-to-br from-primary/[0.05] to-transparent relative">
            <div className="absolute -top-2.5 left-6 px-2 py-0.5 rounded bg-primary text-primary-foreground text-[9.5px] uppercase tracking-[0.16em] font-bold">Everything</div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-primary font-semibold inline-flex items-center gap-1.5">
                <Crown className="w-3 h-3" /> Full access
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-5xl font-semibold text-foreground tabular-nums">$79</span>
                <span className="text-[13px] text-muted-foreground">/mo</span>
              </div>
              <div className="text-[12.5px] text-muted-foreground mt-1.5">Web app, API and alerts.</div>
            </div>
            <ul className="space-y-2 text-[13px] flex-1">
              {EVERYTHING_FEATURES.map((f, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            {user ? (
              <button onClick={startCheckout} className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-4 rounded-md bg-primary text-primary-foreground text-[13.5px] font-semibold hover:bg-primary/90">
                Start 7-day free trial <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <Link to="/signup" className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-4 rounded-md bg-primary text-primary-foreground text-[13.5px] font-semibold hover:bg-primary/90">
                Start 7-day free trial <ArrowRight className="w-4 h-4" />
              </Link>
            )}
            <div className="text-[11px] text-muted-foreground text-center -mt-1">7 days free, then $79/month. Card required. Cancel before day 7 and you pay nothing.</div>
          </div>
        </div>

        {/* What you get */}
        <section className="mt-20 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <ValueProp icon={<Database className="w-5 h-5" />} title="The full archive" body={`${n(s?.audits)} audits, ${n(s?.findings)} findings, ${n(s?.auditors)} audit firms and ${n(s?.hacks)} hacks.`} />
          <ValueProp icon={<Code2 className="w-5 h-5" />} title="API" body="Audits (including lookup by code repository), hacks and funding rounds as JSON, paginated." />
          <ValueProp icon={<Bell className="w-5 h-5" />} title="Alerts" body="A Telegram message when a project you follow publishes an audit, raises money or switches firms. Slack coming soon." />
          <ValueProp icon={<ShieldCheck className="w-5 h-5" />} title="Signals" body="Spot projects that switch audit firms or change their code after the last audit." />
        </section>

        {/* Enterprise / bespoke: simple contact, no separate tier */}
        <section className="mt-20 as-card p-6 md:p-8 bg-gradient-to-br from-emerald-500/[0.04] to-transparent border-emerald-500/20 text-center">
          <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-300 font-semibold inline-flex items-center gap-1.5 justify-center">
            <Building2 className="w-3.5 h-3.5" /> Need more?
          </div>
          <h2 className="text-xl md:text-2xl font-semibold tracking-tight mt-2">Bulk exports, higher limits, or a custom feed?</h2>
          <p className="text-[13px] text-muted-foreground leading-relaxed max-w-[480px] mx-auto mt-2">
            For funds, exchanges, insurers and security firms that need more than the standard plan. We'll scope it and send a quote.
          </p>
          <a href="https://t.me/web3leads" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-[12.5px] font-semibold mt-4">
            Message us on Telegram <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </section>

        {/* Who it's for */}
        <section className="mt-20">
          <h2 className="text-2xl font-semibold tracking-tight text-center mb-8">Who it's for</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {PERSONAS.map((p) => (
              <UseCase key={p.title} icon={<p.icon className="w-4 h-4" aria-hidden />} title={p.title} body={p.job} />
            ))}
          </div>
        </section>

        {/* FAQs */}
        <div className="mt-20 max-w-[800px] mx-auto">
          <h2 className="text-2xl font-semibold tracking-tight text-center mb-8">Frequently asked</h2>
          <Faq items={FAQS} />
        </div>

        {/* CTA */}
        <div className="mt-20 text-center as-card p-10">
          <h2 className="text-2xl font-semibold tracking-tight">Try it on your next diligence request.</h2>
          <p className="text-muted-foreground text-[13px] mt-2 max-w-[520px] mx-auto">
            7 days free, then $79/month. Cancel before day 7 and you pay nothing.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 mt-5">
            <Link to={user ? "/account" : "/signup"} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-md bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90">
              {user ? "Get API key" : "Start trial"} <ArrowRight className="w-4 h-4" />
            </Link>
            <Link to="/docs" className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-md border border-white/[0.10] text-[13px] font-semibold hover:bg-white/[0.04]">
              Read the docs
            </Link>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

function ValueProp({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="as-card p-5 space-y-2">
      <div className="w-9 h-9 rounded-md bg-primary/15 text-primary flex items-center justify-center">{icon}</div>
      <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
      <p className="text-[13px] text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function UseCase({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="as-card p-5 space-y-1.5">
      <div className="text-primary">{icon}</div>
      <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
      <p className="text-[13px] text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
