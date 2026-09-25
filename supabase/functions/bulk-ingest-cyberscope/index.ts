// bulk-ingest-cyberscope v5 — pre-filters case-collisions on lower(report_url), retries failed batches row-by-row.
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


function slugToProtocolName(slug: string): string {
  return slug.replace(/^\$/, '').replace(/[\/_-]+/g, ' ').split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ').trim();
}
function slugToCompanySlug(slug: string): string {
  const base = slug.split('/')[0].replace(/^\$/, '').toLowerCase();
  return base.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}
function slugToProtocolSlug(slug: string): string {
  return slug.replace(/^\$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

async function restGet(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  return r.ok ? r.json() : [];
}

async function insertBatch(batch: any[]): Promise<{ inserted: number; status: number; bodyExcerpt?: string }> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/audit_history`, {
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
  let n = 0;
  try { n = JSON.parse(text).length || 0; } catch {}
  return { inserted: n, status: r.status, bodyExcerpt: r.status >= 400 ? text.slice(0, 300) : undefined };
}

Deno.serve(async (req) => {
  if (!authorised(req)) return UNAUTH();
  const t0 = Date.now();
  const body = await req.json().catch(() => ({})) as { paths?: string[] };
  const pdfPaths = (body.paths || []).filter(p => typeof p === 'string' && p.endsWith('audit.pdf'));
  if (pdfPaths.length === 0) return new Response(JSON.stringify({ error: 'no paths' }), { status: 400 });

  const result: Record<string, unknown> = { started_at: new Date().toISOString(), received_paths: pdfPaths.length };

  // Build sets from existing rows for BOTH raw_pdf_url and lower(report_url)
  const existingRawPdf = new Set<string>();
  const existingReportUrlLower = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const page = await restGet(`audit_history?select=raw_pdf_url,report_url&audit_firm=eq.CyberScope&limit=1000&offset=${offset}`);
    if (!page || page.length === 0) break;
    for (const r of page as any[]) {
      if (r.raw_pdf_url) existingRawPdf.add(r.raw_pdf_url);
      if (r.report_url) existingReportUrlLower.add(r.report_url.toLowerCase());
    }
    if (page.length < 1000) break;
  }
  result.existing_raw_pdf = existingRawPdf.size;
  result.existing_report_url_lower = existingReportUrlLower.size;

  // Build candidate rows, dedupe by lower(report_url) within new set too
  const rows: any[] = [];
  const seenLowerInBatch = new Set<string>();
  for (const path of pdfPaths) {
    const folder = path.slice(0, -'/audit.pdf'.length);
    const segments = folder.split('/').map(encodeURIComponent).join('/');
    const pdfUrl = `https://raw.githubusercontent.com/cyberscope-io/audits/main/${segments}/audit.pdf`;
    const reportUrl = `https://github.com/cyberscope-io/audits/blob/main/${segments}/audit.pdf`;
    const rurlLower = reportUrl.toLowerCase();
    if (existingRawPdf.has(pdfUrl)) continue;
    if (existingReportUrlLower.has(rurlLower)) continue;
    if (seenLowerInBatch.has(rurlLower)) continue;
    seenLowerInBatch.add(rurlLower);
    rows.push({
      company_slug: slugToCompanySlug(folder),
      protocol_slug: slugToProtocolSlug(folder),
      protocol_name: slugToProtocolName(folder),
      raw_pdf_url: pdfUrl,
      report_url: reportUrl,
      audit_firm: 'CyberScope',
      data_source: 'github:cyberscope-io',
    });
  }
  result.rows_to_insert = rows.length;

  let inserted = 0;
  const errors: any[] = [];
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const r = await insertBatch(batch);
    if (r.status >= 400) {
      // Retry one-by-one
      for (const row of batch) {
        const r2 = await insertBatch([row]);
        if (r2.status < 400) inserted += r2.inserted;
        else errors.push({ slug: row.protocol_slug, status: r2.status, body: r2.bodyExcerpt?.slice(0, 150) });
      }
    } else {
      inserted += r.inserted;
    }
  }
  result.inserted = inserted;
  result.errors_count = errors.length;
  result.errors_sample = errors.slice(0, 5);
  result.elapsed_ms = Date.now() - t0;
  return new Response(JSON.stringify(result, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
