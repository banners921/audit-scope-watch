const CRON_KEY = Deno.env.get("CRON_KEY") || "__cron_key_unset__";
// The placeholder above can never equal a caller-supplied header, so an
// unset CRON_KEY secret denies every request instead of authorising them.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://qktjbtmcjrwzmtqnszbq.supabase.co";
const JOBS: Record<string, { fn: string; body: Record<string, unknown> }> = {
  "web3leads-raises": { fn: "collect-web3leads-raises", body: { days: 14, max_pages: 3 } },
  "scrape-ackee-blockchain": { fn: "scrape-audit-firm", body: { firm_slug: "ackee-blockchain", limit: 500 } },
  "scrape-statemind": { fn: "scrape-audit-firm", body: { firm_slug: "statemind", limit: 500 } },
  "onchain-events": { fn: "collect-onchain-events", body: { limit: 200 } },
  "onchain-events-test": { fn: "collect-onchain-events", body: { company_slugs: ["lido"], limit: 5 } },
  "protocol-metrics": { fn: "collect-protocol-metrics", body: { limit: 300 } },
  "hackenproof": { fn: "collect-hackenproof", body: {} },
  "solana-onchain": { fn: "collect-onchain-events-solana", body: { limit: 100 } },
};
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Use POST" }), { status: 405 });
  const key = req.headers.get("x-cron-key") || "";
  if (key !== CRON_KEY) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  const url = new URL(req.url);
  const jobName = url.searchParams.get("job") || "";
  const job = JOBS[jobName];
  if (!job) return new Response(JSON.stringify({ error: "unknown_job", available: Object.keys(JOBS) }), { status: 400 });
  const t0 = Date.now();
  let response;
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${job.fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-key": CRON_KEY },
      body: JSON.stringify(job.body),
    });
    response = { status: r.status, body: await r.json().catch(() => null) };
  } catch (e) {
    response = { status: 0, error: e instanceof Error ? e.message : String(e) };
  }
  return new Response(JSON.stringify({ job: jobName, took_ms: Date.now() - t0, result: response }), { status: 200, headers: { "Content-Type": "application/json" } });
});
