// insert-cyberscope-findings — bulk inserts pre-resolved findings into audit_findings_detail.
// Body: { findings: Array<{audit_id, company_slug, severity, title, summary, status, affected_addresses}> }
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Auth: these endpoints write directly into audit_history / companies /
// audit_findings_detail, so they must never be anonymously callable.
const CRON_KEY = Deno.env.get("CRON_KEY") || "";
function authorised(req: Request): boolean {
  // An unset secret must not authorise everyone ("" === "" would).
  return CRON_KEY !== "" && req.headers.get("x-cron-key") === CRON_KEY;
}
const UNAUTH = () => new Response(JSON.stringify({ error: "Unauthorized" }), {
  status: 401, headers: { "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (!authorised(req)) return UNAUTH();
  const t0 = Date.now();
  const body = await req.json().catch(() => ({})) as { findings?: any[] };
  const findings = body.findings || [];
  if (!findings.length) return new Response(JSON.stringify({ error: 'no findings' }), { status: 400 });

  let inserted = 0;
  const errors: any[] = [];
  const batchSize = 200;
  for (let i = 0; i < findings.length; i += batchSize) {
    const batch = findings.slice(i, i + batchSize);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/audit_findings_detail`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(batch),
    });
    const text = await r.text();
    if (r.ok) {
      try { inserted += JSON.parse(text).length; } catch { inserted += batch.length; }
    } else if (errors.length < 5) {
      errors.push({ i, status: r.status, body: text.slice(0, 300) });
    }
  }
  return new Response(JSON.stringify({
    received: findings.length,
    inserted,
    errors_first_5: errors,
    elapsed_ms: Date.now() - t0,
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
