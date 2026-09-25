// insert-cyberscope-shells — idempotent bulk insert of company shell rows for CyberScope audits.
// Body: { shells: Array<{slug, name, data_source, last_audit_firm, canonical_status, canonical_status_reason}> }
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
  const body = await req.json().catch(() => ({})) as { shells?: any[] };
  const shells = body.shells || [];
  if (!shells.length) return new Response(JSON.stringify({ error: 'no shells' }), { status: 400 });

  // Page-fetch existing slugs once to skip work
  const existing = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/companies?select=slug&slug=in.(${shells.slice(offset, offset + 1000).map(s => encodeURIComponent(s.slug)).join(',')})`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!r.ok) break;
    const page = await r.json() as any[];
    for (const row of page) existing.add(row.slug);
    if (offset + 1000 >= shells.length) break;
  }
  const toInsert = shells.filter(s => !existing.has(s.slug));

  let inserted = 0;
  const errors: any[] = [];
  const batchSize = 100;
  for (let i = 0; i < toInsert.length; i += batchSize) {
    const batch = toInsert.slice(i, i + batchSize);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/companies`, {
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
    } else {
      // Retry row-by-row to bypass any single bad row
      for (const row of batch) {
        const r2 = await fetch(`${SUPABASE_URL}/rest/v1/companies`, {
          method: 'POST',
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify([row]),
        });
        if (r2.ok) inserted++;
        else if (errors.length < 5) errors.push({ slug: row.slug, status: r2.status, body: (await r2.text()).slice(0, 150) });
      }
    }
  }
  return new Response(JSON.stringify({
    received: shells.length,
    already_existing: shells.length - toInsert.length,
    inserted,
    errors_first_5: errors,
    elapsed_ms: Date.now() - t0,
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
