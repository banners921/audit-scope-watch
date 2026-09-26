// rd-mass-pull v4 — verbose error reporting on insert
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function rd(endpoint: string, apikey: string, body: unknown): Promise<any> {
  const r = await fetch(`https://api.rootdata.com/open/${endpoint}`, {
    method: 'POST',
    headers: { apikey, 'Content-Type': 'application/json', language: 'en' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${endpoint} HTTP ${r.status}: ${text.slice(0, 300)}`);
  const j = JSON.parse(text);
  if (j.result !== 200) throw new Error(`${endpoint} RD result ${j.result}: ${j.message || JSON.stringify(j).slice(0, 200)}`);
  return j;
}

async function bulkInsert(table: string, rows: any[], errors: string[]): Promise<{ inserted: number; debug: any }> {
  if (!rows.length) return { inserted: 0, debug: 'empty' };
  let inserted = 0;
  const debug: any = { calls: [] };
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify(batch),
    });
    const text = await r.text();
    let parsed: any = null;
    let parsedLen = 0;
    try { parsed = JSON.parse(text); if (Array.isArray(parsed)) parsedLen = parsed.length; } catch {}
    if (r.ok) inserted += parsedLen;
    else if (errors.length < 3) errors.push(`${table} POST ${r.status}: ${text.slice(0, 250)}`);
    if (debug.calls.length < 2) debug.calls.push({ batch_size: batch.length, status: r.status, response_len: parsedLen, body_preview: text.slice(0, 200), first_row: batch[0] });
  }
  return { inserted, debug };
}

// Auth: this endpoint runs service-role queries against the database, so it
// must never be anonymously callable.
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
  const t0 = Date.now();
  const body = await req.json().catch(() => ({})) as { apikey?: string; months_back?: number; type?: number; chunk_days?: number };
  const apikey = body.apikey || Deno.env.get('ROOTDATA_API_KEY') || '';
  if (!apikey) return new Response(JSON.stringify({ error: 'apikey required' }), { status: 400 });
  const monthsBack = Math.max(1, Math.min(60, body.months_back ?? 12));
  const type = body.type ?? 1;
  const chunkDays = Math.max(1, Math.min(30, body.chunk_days ?? 14));

  const now = Date.now();
  const rangeEnd = now;
  const rangeStart = now - monthsBack * 30 * 86400_000;
  const chunkMs = chunkDays * 86400_000;

  let chunks = 0;
  let itemsSeen = 0;
  const projectIds = new Set<number>();
  const financingRows: any[] = [];
  const errors: string[] = [];

  for (let start = rangeStart; start < rangeEnd; start += chunkMs) {
    chunks++;
    const end = Math.min(start + chunkMs, rangeEnd);
    try {
      const resp = await rd('ser_change', apikey, { begin_time: start, end_time: end, type });
      const arr: any[] = Array.isArray(resp.data) ? resp.data : [];
      itemsSeen += arr.length;
      for (const it of arr) {
        if (type === 1) {
          const pid = Number(it.id ?? 0);
          if (pid) projectIds.add(pid);
        } else if (type === 6) {
          const pid = Number(it.project_id ?? it.id ?? 0) || null;
          if (pid) projectIds.add(pid);
          const publishIso = it.update_time ? new Date(Number(it.update_time)).toISOString() : null;
          financingRows.push({
            rd_event_id: String(it.id ?? `${pid}-${it.update_time}`),
            rd_project_id: pid,
            project_name: it.name || null,
            round_type: it.round || null,
            amount_usd: Number(it.amount || 0) || null,
            publish_time: publishIso,
            raw_payload: it,
          });
        }
      }
    } catch (e) {
      errors.push(`chunk ${chunks}: ${String(e).slice(0, 200)}`);
    }
    await new Promise(r => setTimeout(r, 60));
  }

  const projectShells = Array.from(projectIds).map(pid => ({ rd_project_id: pid, name: `__pending_${pid}__` }));
  const projRes = await bulkInsert('rootdata_companies_staging', projectShells, errors);
  const finRes = await bulkInsert('rootdata_funding_rounds_staging', financingRows, errors);

  return new Response(JSON.stringify({
    months_back: monthsBack,
    type,
    chunks,
    items_seen: itemsSeen,
    projects_seen: projectIds.size,
    projects_inserted: projRes.inserted,
    projects_debug: projRes.debug,
    financings_inserted: finRes.inserted,
    financings_debug: finRes.debug,
    errors_count: errors.length,
    errors_first_3: errors.slice(0, 3),
    elapsed_ms: Date.now() - t0,
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
