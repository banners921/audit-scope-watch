import { Link } from "react-router-dom";
import { ArrowRight, Copy, KeyRound, Zap } from "lucide-react";
import { toast } from "sonner";

const BASE_URL = "https://qktjbtmcjrwzmtqnszbq.supabase.co/functions/v1/api-v1/v1";

export default function Docs() {
  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success("Copied"); };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <DocsNav />

      <main className="max-w-[1100px] mx-auto px-4 lg:px-6 py-12 grid lg:grid-cols-[220px_1fr] gap-10">
        <aside className="lg:sticky lg:top-20 lg:self-start space-y-1 text-[12.5px]">
          {[
            { id: "overview", label: "Overview" },
            { id: "auth", label: "Authentication" },
            { id: "audits", label: "/v1/audits" },
            { id: "hacks", label: "/v1/hacks" },
            { id: "funding", label: "/v1/funding-rounds" },
            { id: "limits", label: "Rate limits" },
            { id: "errors", label: "Errors" },
            { id: "roadmap", label: "Roadmap" },
          ].map((s) => (
            <a key={s.id} href={`#${s.id}`} className="block px-2 py-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-white/[0.03]">
              {s.label}
            </a>
          ))}
        </aside>

        <div className="space-y-16">
          <section id="overview" className="space-y-3">
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-primary">API Reference · v1</div>
            <h1 className="text-4xl font-semibold tracking-tight">AuditScope.ai REST API</h1>
            <p className="text-muted-foreground text-[14px] leading-relaxed">
              Live audit + hack + funding data for crypto protocols. JSON over HTTPS, cursor-paginated, refreshed continuously. Three endpoints, one API key.
            </p>
            <div className="as-card p-4 font-mono text-[12px] flex items-center gap-2">
              <span className="text-primary shrink-0">Base URL</span>
              <code className="text-foreground truncate">{BASE_URL}</code>
              <button onClick={() => copy(BASE_URL)} className="ml-auto text-muted-foreground hover:text-foreground shrink-0">
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </section>

          <section id="auth" className="space-y-3">
            <h2 className="text-2xl font-semibold tracking-tight inline-flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary" /> Authentication
            </h2>
            <p className="text-muted-foreground text-[13px]">
              Every request needs an API key in either the <code className="text-primary">X-Api-Key</code> header or <code className="text-primary">Authorization: Bearer</code> header. Generate one at <Link to="/account" className="text-primary hover:underline">Account &amp; API</Link>.
            </p>
            <CodeBlock code={`curl '${BASE_URL}/audits?limit=10' \\
  -H 'X-Api-Key: ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'

# equivalent:
curl '${BASE_URL}/audits?limit=10' \\
  -H 'Authorization: Bearer ak_live_...'`} />
          </section>

          <Endpoint
            id="audits"
            method="GET"
            path="/v1/audits"
            desc="Audit reports across every firm we scrape (Trail of Bits, Cyfrin, Zellic, Perimeter, OpenZeppelin, Halborn, Spearbit, and 40+ more). Ordered newest first."
            baseUrl={BASE_URL}
            params={[
              { name: "firm", type: "string", desc: 'Exact firm name (case-insensitive). e.g. "Cyfrin", "Trail of Bits"' },
              { name: "protocol_slug", type: "string", desc: "Exact protocol slug. e.g. \"aave\"" },
              { name: "since", type: "date (YYYY-MM-DD)", desc: "Filter audit_date >= since" },
              { name: "chain", type: "string", desc: 'e.g. "Ethereum", "Solana", "Arbitrum"' },
              { name: "limit", type: "int (1–200)", desc: "default 50" },
              { name: "cursor", type: "string", desc: "Pass next_cursor from prior response" },
            ]}
            example={`curl '${BASE_URL}/audits?firm=Cyfrin&since=2026-06-01&limit=10' \\
  -H 'X-Api-Key: ak_live_...'`}
            response={`{
  "data": [
    {
      "id": "b27be416-acea-4893-aa3a-35ee22b10917",
      "protocol_name": "Superstate EVM Report",
      "protocol_slug": null,
      "audit_firm": "Zellic",
      "audit_date": "2026-06-28",
      "audit_type": null,
      "report_url": "https://raw.githubusercontent.com/Zellic/publications/master/...",
      "findings_critical": 0,
      "findings_high": 0,
      "findings_medium": 0,
      "findings_low": 0,
      "findings_informational": null,
      "audited_repo_url": null,
      "audited_commit_hash": null,
      "audited_chains": null,
      "smart_contract_language": "solidity",
      "data_source": "bulk-ingest:zellic",
      "created_at": "2026-06-30T22:30:30.714Z"
    }
  ],
  "next_cursor": "2026-06-30T22:30:30.714Z",
  "count": 1
}`}
          />

          <Endpoint
            id="hacks"
            method="GET"
            path="/v1/hacks"
            desc="Hack + exploit feed. Sourced from DefiLlama, RootData, and manual triage."
            baseUrl={BASE_URL}
            params={[
              { name: "since", type: "date (YYYY-MM-DD)", desc: "Filter hack_date >= since" },
              { name: "min_amount_usd", type: "number", desc: "Minimum loss in USD" },
              { name: "chain", type: "string", desc: 'e.g. "Ethereum"' },
              { name: "target_type", type: "string", desc: '"DeFi Protocol", "Bridge", "CEX", etc.' },
              { name: "limit", type: "int (1–200)", desc: "default 50" },
              { name: "cursor", type: "string", desc: "Cursor from prior response" },
            ]}
            example={`curl '${BASE_URL}/hacks?since=2026-06-01&min_amount_usd=1000000' \\
  -H 'X-Api-Key: ak_live_...'`}
            response={`{
  "data": [
    {
      "id": "a87c874f-5d1b-41e3-948c-8102a41bd286",
      "name": "Edel",
      "company_slug": "edel",
      "hack_date": "2026-06-30",
      "amount_usd": 403000,
      "classification": "Protocol Logic",
      "technique": "Flashloan Price Oracle Attack",
      "target_type": "DeFi Protocol",
      "chains": ["Ethereum"],
      "bridge_hack": false,
      "returned_funds": null,
      "source_url": "https://defillama.com/hacks",
      "created_at": "2026-07-01T04:15:16.481Z"
    }
  ],
  "next_cursor": "2026-07-01T04:15:16.481Z",
  "count": 1
}`}
          />

          <Endpoint
            id="funding"
            method="GET"
            path="/v1/funding-rounds"
            desc="Crypto funding rounds — feed of raises with investors and announcement links. Refreshed every 15 minutes."
            baseUrl={BASE_URL}
            params={[
              { name: "since", type: "date (YYYY-MM-DD)", desc: "Filter round date >= since" },
              { name: "min_amount_usd", type: "number", desc: "Minimum raise" },
              { name: "round_type", type: "string", desc: '"Seed", "Series A", "Strategic", etc.' },
              { name: "category", type: "string", desc: '"DeFi", "Infrastructure", "Gaming", etc.' },
              { name: "limit", type: "int (1–200)", desc: "default 50" },
              { name: "cursor", type: "string", desc: "Cursor from prior response" },
            ]}
            example={`curl '${BASE_URL}/funding-rounds?round_type=Series%20A&min_amount_usd=10000000' \\
  -H 'X-Api-Key: ak_live_...'`}
            response={`{
  "data": [
    {
      "id": "5d835f14-393b-4ed7-bb16-ce1c61686c04",
      "company_name": "Allium",
      "company_slug": "allium",
      "category": "Infrastructure",
      "amount_usd": 40000000,
      "round_type": "Series B",
      "date": "2026-06-23",
      "lead_investors": "Amplify Partners",
      "other_investors": "Kleiner Perkins, Theory Ventures",
      "all_investors": "Amplify Partners, Kleiner Perkins, Theory Ventures",
      "announcement_url": "https://x.com/AlliumLabs/status/...",
      "data_source": "web3leads",
      "created_at": "2026-06-26T20:00:10.475Z"
    }
  ],
  "next_cursor": "2026-06-26T20:00:10.475Z",
  "count": 1
}`}
          />

          <section id="limits" className="space-y-3">
            <h2 className="text-2xl font-semibold tracking-tight">Rate limits</h2>
            <div className="as-card overflow-hidden">
              <table className="w-full text-[12.5px]">
                <thead><tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Tier</th>
                  <th className="px-3 py-2 text-right">Calls / min</th>
                  <th className="px-3 py-2 text-right">Monthly cap</th>
                </tr></thead>
                <tbody>
                  <tr className="border-b border-white/[0.04]"><td className="px-3 py-2">Trial (free)</td><td className="px-3 py-2 text-right tabular-nums">60</td><td className="px-3 py-2 text-right tabular-nums">5,000</td></tr>
                  <tr className="border-b border-white/[0.04]"><td className="px-3 py-2 text-primary">API · $89/mo</td><td className="px-3 py-2 text-right tabular-nums">1,200</td><td className="px-3 py-2 text-right tabular-nums">100,000</td></tr>
                  <tr><td className="px-3 py-2 text-emerald-300">Enterprise</td><td className="px-3 py-2 text-right tabular-nums">6,000</td><td className="px-3 py-2 text-right tabular-nums">Unlimited</td></tr>
                </tbody>
              </table>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Every response returns <code className="text-primary">X-RateLimit-Limit</code> and <code className="text-primary">X-RateLimit-Remaining</code> headers. Over-limit requests return <code className="text-primary">429</code> with <code className="text-primary">Retry-After: 60</code>.
            </p>
          </section>

          <section id="errors" className="space-y-3">
            <h2 className="text-2xl font-semibold tracking-tight">Errors</h2>
            <div className="as-card overflow-hidden">
              <table className="w-full text-[12.5px]">
                <thead><tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Status</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Meaning</th>
                </tr></thead>
                <tbody>
                  <tr className="border-b border-white/[0.04]"><td className="px-3 py-2 font-mono">401</td><td className="px-3 py-2 font-mono text-primary">missing_api_key</td><td className="px-3 py-2 text-foreground/85">No header provided</td></tr>
                  <tr className="border-b border-white/[0.04]"><td className="px-3 py-2 font-mono">401</td><td className="px-3 py-2 font-mono text-primary">invalid_key</td><td className="px-3 py-2 text-foreground/85">Key not found or malformed</td></tr>
                  <tr className="border-b border-white/[0.04]"><td className="px-3 py-2 font-mono">401</td><td className="px-3 py-2 font-mono text-primary">revoked_key</td><td className="px-3 py-2 text-foreground/85">Key was revoked</td></tr>
                  <tr className="border-b border-white/[0.04]"><td className="px-3 py-2 font-mono">404</td><td className="px-3 py-2 font-mono text-primary">not_found</td><td className="px-3 py-2 text-foreground/85">Unknown endpoint path</td></tr>
                  <tr className="border-b border-white/[0.04]"><td className="px-3 py-2 font-mono">429</td><td className="px-3 py-2 font-mono text-primary">rate_limit_exceeded</td><td className="px-3 py-2 text-foreground/85">Retry after 60s</td></tr>
                  <tr><td className="px-3 py-2 font-mono">500</td><td className="px-3 py-2 font-mono text-primary">db_error</td><td className="px-3 py-2 text-foreground/85">Backend query failed — email us the request ID</td></tr>
                </tbody>
              </table>
            </div>
            <CodeBlock code={`{
  "error": "invalid_key"
}`} />
          </section>

          <section id="roadmap" className="space-y-3">
            <h2 className="text-2xl font-semibold tracking-tight inline-flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" /> Roadmap
            </h2>
            <p className="text-muted-foreground text-[13px] leading-relaxed">
              What's coming after the initial 3 endpoints:
            </p>
            <ul className="space-y-2 text-[12.5px] text-foreground/85">
              <li>• <code className="text-primary">/v1/firms</code> — Audit firm profiles with portfolio + finding stats</li>
              <li>• <code className="text-primary">/v1/companies/:slug</code> — Full protocol dossier (audits + bounties + hacks + contracts)</li>
              <li>• <code className="text-primary">/v1/signals</code> — Firm rotations, audit dryspell, vendor-shopping alerts</li>
              <li>• Slack + Telegram webhook alerts on new audits / hacks for your watched protocols</li>
              <li>• Push webhooks (<code className="text-primary">POST /v1/webhooks</code>) with HMAC-signed deliveries</li>
            </ul>
            <p className="text-[11.5px] text-muted-foreground pt-1 italic">
              We ship in daylight — no vaporware. If it's on this page above this section, it works right now. Everything under Roadmap is on our list, not in production.
            </p>
          </section>

          <div className="pt-8 border-t" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}>
            <Link to="/account" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90">
              Get your API key <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

function DocsNav() {
  return (
    <nav className="sticky top-0 z-30 backdrop-blur bg-background/70 border-b" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}>
      <div className="max-w-[1280px] mx-auto px-4 lg:px-6 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-bold tracking-tight text-[15px]">
          <svg width={22} height={22} viewBox="0 0 24 24" className="text-primary">
            <circle cx={12} cy={12} r={10} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.2} />
            <circle cx={12} cy={12} r={6} fill="none" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.2} />
            <circle cx={12} cy={12} r={2} fill="currentColor" />
            <path d="M12 12 L22 7 A11 11 0 0 1 22 17 Z" fill="currentColor" fillOpacity={0.35}>
              <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="3.5s" repeatCount="indefinite" />
            </path>
          </svg>
          AuditScope<span className="text-primary">.ai</span> <span className="text-[11px] uppercase tracking-wider text-muted-foreground ml-2">Docs</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link to="/pricing" className="text-[12.5px] text-muted-foreground hover:text-foreground px-3 py-1.5">Pricing</Link>
          <Link to="/account" className="text-[12.5px] inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-semibold hover:bg-primary/90">
            Get API key <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Endpoint({ id, method, path, desc, params, example, response }: { id: string; method: string; path: string; desc: string; baseUrl: string; params: { name: string; type: string; desc: string }[]; example: string; response: string }) {
  return (
    <section id={id} className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono font-semibold">{method}</span>
        <code className="text-[15px] font-mono text-foreground">{path}</code>
      </div>
      <p className="text-muted-foreground text-[13px]">{desc}</p>
      {params.length > 0 && (
        <div className="as-card overflow-hidden">
          <table className="w-full text-[12px]">
            <thead><tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2">Param</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Description</th>
            </tr></thead>
            <tbody>
              {params.map((p) => (
                <tr key={p.name} className="border-b border-white/[0.04]">
                  <td className="px-3 py-2 font-mono text-primary">{p.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.type}</td>
                  <td className="px-3 py-2 text-foreground/85">{p.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CodeBlock code={example} label="curl" />
      <CodeBlock code={response} label="response" highlight />
    </section>
  );
}

function CodeBlock({ code, label, highlight }: { code: string; label?: string; highlight?: boolean }) {
  return (
    <div className="as-card overflow-hidden">
      <div className="flex items-center gap-1.5 px-4 py-2 border-b" style={{ borderColor: "rgb(var(--line-1) / var(--line-1-alpha))" }}>
        <span className="w-2.5 h-2.5 rounded-full bg-rose-400/70" />
        <span className="w-2.5 h-2.5 rounded-full bg-amber-400/70" />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/70" />
        {label && <span className="ml-2 text-[11px] text-muted-foreground font-mono">{label}</span>}
        <button onClick={() => { navigator.clipboard.writeText(code); toast.success("Copied"); }} className="ml-auto text-muted-foreground hover:text-foreground"><Copy className="w-3.5 h-3.5" /></button>
      </div>
      <pre className={`p-4 text-[11.5px] font-mono leading-relaxed overflow-x-auto whitespace-pre ${highlight ? "text-emerald-300" : "text-foreground/85"}`}>{code}</pre>
    </div>
  );
}
