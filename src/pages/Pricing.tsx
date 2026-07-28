import { Link } from "react-router-dom";
import { ArrowRight, Check, Crown, Building2, Code2, Bell, Zap, Database, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const EVERYTHING_FEATURES = [
  "Full platform — audits, findings, auditors, companies, funding, contacts, on-chain",
  "Full history + report URLs (the entire 21K+ archive)",
  "Full REST API — all endpoints, JSON, cursor pagination",
  "Signal alerts — new audits, funding, auditor rotations (Telegram; Slack soon)",
  "Unlimited watched protocols",
  "Cancel anytime",
];

const FREE_FEATURES = [
  "Browse audits, auditors, companies, funding & hacks",
  "Search the 21K+ audit archive",
  "Finding counts + severity breakdown",
  "Trial API key (recent window, capped rows)",
];

const FAQS = [
  { q: "Is there a free tier?", a: "Yes. Sign up free to browse the platform and try a trial API key (recent window, capped). Everything ($59/mo) unlocks the full platform, the complete archive with report URLs, the full API, and alerts." },
  { q: "What do I get for $59?", a: "Everything — the full web app, the complete 21K+ audit archive with report URLs, the full REST API, and signal alerts. One plan, no add-ons." },
  { q: "Where does the data come from?", a: "We crawl per-firm GitHub repos (50+ audit firms), protocol docs (Mintlify/GitBook), DefiLlama, web3leads, RootData, Solodit, Immunefi, HackenProof. Every record cites its sources." },
  { q: "How fresh is it?", a: "Audit firm GitHub repos polled every 30 min. Per-protocol /audits folders hourly. New audits visible within ~5 minutes of GitHub publish. Hacks every 4h. Funding rounds every 15 min." },
  { q: "What's your data accuracy policy?", a: "If we don't have a value, the API returns null — never a guess. Dead projects are flagged. Audit dates come from PDF metadata or filenames, not inferred." },
  { q: "Can I cancel anytime?", a: "Yes. No long-term contracts on Pro. You can export your entire dataset as JSON or CSV before canceling." },
  { q: "Do you offer a trial?", a: "Pro includes a 14-day trial. Enterprise gets a 30-day pilot with an engineer in your Slack." },
  { q: "What if I need more than 100K calls?", a: "Talk to us. Most teams stay well under it — webhooks mean you don't have to poll. If you're genuinely doing high volume, that's Enterprise territory and we'll quote it." },
];

export default function Pricing() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav user={user} />

      <main className="max-w-[1200px] mx-auto px-4 lg:px-6 py-16">
        {/* Header */}
        <div className="text-center max-w-[720px] mx-auto space-y-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-primary font-semibold">Pricing</div>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Simple, honest pricing.</h1>
          <p className="text-muted-foreground text-[14.5px] leading-relaxed max-w-[600px] mx-auto">
            Start free. Unlock everything — full platform, API and alerts — for <span className="text-foreground font-semibold">$59/mo</span>. One plan, no add-ons.
          </p>
        </div>

        {/* === Three cards: Free / App $49.99 / API $89 === */}
        <div className="grid md:grid-cols-2 gap-4 mt-12 max-w-[820px] mx-auto">
          {/* Free */}
          <div className="as-card p-6 flex flex-col gap-5">
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Free</div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold text-foreground tabular-nums">$0</span>
                <span className="text-[12.5px] text-muted-foreground">forever</span>
              </div>
              <div className="text-[12.5px] text-muted-foreground mt-1.5">Try it before you pay.</div>
            </div>
            <ul className="space-y-2 text-[12.5px] flex-1">
              {FREE_FEATURES.map((f, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link to={user ? "/dashboard" : "/signup"} className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-md border border-white/[0.10] text-[13px] font-semibold hover:bg-white/[0.04]">
              {user ? "Open app" : "Sign up free"} <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* $59 Everything */}
          <div className="as-card p-6 flex flex-col gap-5 border-primary/40 shadow-[0_0_0_1px_rgba(34,211,238,0.25),0_0_40px_-12px_rgba(34,211,238,0.3)] bg-gradient-to-br from-primary/[0.05] to-transparent relative">
            <div className="absolute -top-2.5 left-6 px-2 py-0.5 rounded bg-primary text-primary-foreground text-[9.5px] uppercase tracking-[0.16em] font-bold">Everything</div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-primary font-semibold inline-flex items-center gap-1.5">
                <Crown className="w-3 h-3" /> Full access
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-5xl font-semibold text-foreground tabular-nums">$59</span>
                <span className="text-[13px] text-muted-foreground">/mo</span>
              </div>
              <div className="text-[12.5px] text-muted-foreground mt-1.5">Full platform + API + alerts. One plan.</div>
            </div>
            <ul className="space-y-2 text-[12.5px] flex-1">
              {EVERYTHING_FEATURES.map((f, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link to={user ? "/account" : "/signup"} className="inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-md bg-primary text-primary-foreground text-[13.5px] font-semibold hover:bg-primary/90">
              {user ? "Upgrade — $59/mo" : "Start free"} <ArrowRight className="w-4 h-4" />
            </Link>
            <div className="text-[11px] text-muted-foreground text-center -mt-1">No credit card to start. Cancel anytime.</div>
          </div>
        </div>

        {/* What you get — visual */}
        <section className="mt-20 grid md:grid-cols-4 gap-3">
          <ValueProp icon={<Code2 className="w-5 h-5" />} title="REST API" body="14 endpoints — audits, firms, companies, hacks, funding, signals. JSON. Cursor-paginated." />
          <ValueProp icon={<Bell className="w-5 h-5" />} title="Real-time alerts" body="Webhooks fire seconds after an audit drops or a hack hits. Slack + Telegram pre-built." />
          <ValueProp icon={<Database className="w-5 h-5" />} title="The full archive" body="17K+ audits, 5K+ protocols, 50+ firms, every funding round + hack since 2020." />
          <ValueProp icon={<ShieldCheck className="w-5 h-5" />} title="Custom signals" body="Audit-rotation, dryspell, vendor-shopping, hiring surge — query the patterns you care about." />
        </section>

        {/* Enterprise / bespoke — simple contact, no separate tier */}
        <section className="mt-20 as-card p-6 md:p-8 bg-gradient-to-br from-emerald-500/[0.04] to-transparent border-emerald-500/20 text-center">
          <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-300 font-semibold inline-flex items-center gap-1.5 justify-center">
            <Building2 className="w-3.5 h-3.5" /> Need more?
          </div>
          <h2 className="text-xl md:text-2xl font-semibold tracking-tight mt-2">Bulk exports, higher limits, or a custom feed?</h2>
          <p className="text-[13px] text-muted-foreground leading-relaxed max-w-[480px] mx-auto mt-2">
            For funds, exchanges, insurance and security firms that need volume beyond the standard plan — we'll scope and quote it.
          </p>
          <a href="https://t.me/web3leads" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-[12.5px] font-semibold mt-4">
            Message us on Telegram <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </section>

        {/* Built for */}
        <section className="mt-20">
          <h2 className="text-2xl font-semibold tracking-tight text-center mb-8">Built for</h2>
          <div className="grid md:grid-cols-4 gap-3">
            <UseCase title="Risk teams" body="Get pinged the moment a portfolio protocol drops a fresh audit — or a stale one expires." />
            <UseCase title="Listing committees" body="Filter exchange listing candidates by audit posture before the review meeting." />
            <UseCase title="Audit firm GTM" body="See which competitors are about to lose a relationship. Hit them before the RFP." />
            <UseCase title="Insurance underwriters" body="Price coverage off real-time finding severity + fix rates instead of a 9-month-old PDF." />
          </div>
        </section>

        {/* FAQs */}
        <div className="mt-20 max-w-[800px] mx-auto">
          <h2 className="text-2xl font-semibold tracking-tight text-center mb-8">Frequently asked</h2>
          <div className="space-y-3">
            {FAQS.map((f, i) => (
              <details key={i} className="as-card p-4 group">
                <summary className="cursor-pointer text-[13.5px] font-semibold text-foreground list-none flex items-center justify-between">
                  {f.q}
                  <span className="text-muted-foreground group-open:rotate-180 transition-transform">▾</span>
                </summary>
                <p className="text-[12.5px] text-muted-foreground mt-2 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="mt-20 text-center as-card p-10">
          <h2 className="text-2xl font-semibold tracking-tight">Stop sourcing audits in Excel.</h2>
          <p className="text-muted-foreground text-[13px] mt-2 max-w-[520px] mx-auto">
            14-day trial. No card. If the API doesn't replace at least one analyst-day per week, don't pay us.
          </p>
          <div className="flex items-center justify-center gap-2 mt-5">
            <Link to={user ? "/account" : "/signup"} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90">
              {user ? "Get API key" : "Start trial"} <ArrowRight className="w-4 h-4" />
            </Link>
            <Link to="/docs" className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-md border border-white/[0.10] text-[13px] font-semibold hover:bg-white/[0.04]">
              Read the docs
            </Link>
          </div>
        </div>
      </main>

      <footer className="py-10 border-t" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}>
        <div className="max-w-[1200px] mx-auto px-4 lg:px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-[12px] text-muted-foreground">
          <div>© AuditScope.ai · Live audit intelligence for crypto</div>
          <div className="flex items-center gap-5">
            <Link to="/" className="hover:text-foreground">Home</Link>
            <Link to="/docs" className="hover:text-foreground">Docs</Link>
            <a href="https://t.me/web3leads" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">Telegram</a>
            <Link to="/login" className="hover:text-foreground">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Nav({ user }: { user: any }) {
  return (
    <nav className="sticky top-0 z-30 backdrop-blur bg-background/70 border-b" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}>
      <div className="max-w-[1200px] mx-auto px-4 lg:px-6 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-bold tracking-tight text-[15px]">
          <RadarLogo size={22} />
          AuditScope<span className="text-primary">.ai</span>
        </Link>
        <div className="hidden md:flex items-center gap-6 text-[12.5px] text-muted-foreground">
          <Link to="/#data" className="hover:text-foreground">Data</Link>
          <Link to="/docs" className="hover:text-foreground">Docs</Link>
          <Link to="/pricing" className="text-foreground">Pricing</Link>
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <Link to="/account" className="text-[12.5px] inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-semibold hover:bg-primary/90">
              Account <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          ) : (
            <>
              <Link to="/login" className="text-[12.5px] text-muted-foreground hover:text-foreground px-3 py-1.5">Sign in</Link>
              <Link to="/signup" className="text-[12.5px] inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-semibold hover:bg-primary/90">
                Get started <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

function ValueProp({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="as-card p-5 space-y-2">
      <div className="w-9 h-9 rounded-md bg-primary/15 text-primary flex items-center justify-center">{icon}</div>
      <div className="text-[13px] font-semibold text-foreground">{title}</div>
      <div className="text-[11.5px] text-muted-foreground leading-relaxed">{body}</div>
    </div>
  );
}

function UseCase({ title, body }: { title: string; body: string }) {
  return (
    <div className="as-card p-5 space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider text-primary inline-flex items-center gap-1.5">
        <Zap className="w-3 h-3" />Use case
      </div>
      <div className="text-[13px] font-semibold text-foreground">{title}</div>
      <div className="text-[11.5px] text-muted-foreground leading-relaxed">{body}</div>
    </div>
  );
}

function RadarLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="text-primary">
      <circle cx={12} cy={12} r={10} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.2} />
      <circle cx={12} cy={12} r={6} fill="none" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.2} />
      <circle cx={12} cy={12} r={2} fill="currentColor" />
      <path d="M12 12 L22 7 A11 11 0 0 1 22 17 Z" fill="currentColor" fillOpacity={0.35}>
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="3.5s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}
