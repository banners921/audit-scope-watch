// resolve-cyberscope-audit-ids — returns raw_pdf_url → (audit_id, company_slug) for all CyberScope audits.
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

Deno.serve(async (req: Request) => {
  if (!authorised(req)) return UNAUTH();
  const result: Record<string, { id: string; company_slug: string }> = {};
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/audit_history?select=id,raw_pdf_url,company_slug&audit_firm=eq.CyberScope&raw_pdf_url=not.is.null&limit=1000&offset=${offset}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!r.ok) break;
    const page = await r.json() as any[];
    for (const row of page) result[row.raw_pdf_url] = { id: row.id, company_slug: row.company_slug };
    if (page.length < 1000) break;
  }
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
});
