// rd-enrich-staging v3 — retry-with-backoff + only mark gone after 2 consecutive 404/410
// Strict serial worker mode (parallel default 3, configurable) to be polite to RD.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_KEY = Deno.env.get('CRON_KEY') || '';

async function rdGetOnce(apikey: string, projectId: number): Promise<{ ok: true; data: any } | { ok: false; code: number; hint: string }> {
  try {
    const r = await fetch('https://api.rootdata.com/open/get_item', {
      method: 'POST',
      headers: { apikey, 'Content-Type': 'application/json', language: 'en' },
      body: JSON.stringify({ project_id: projectId, include_team: true, include_investors: true }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, code: r.status, hint: `http_${r.status}` };
    let j: any;
    try { j = JSON.parse(text); } catch { return { ok: false, code: -1, hint: 'bad_json' }; }
    if (j.result !== 200) return { ok: false, code: j.result, hint: `rd_${j.result}` };
    return { ok: true, data: j.data ?? j };
  } catch (e) {
    return { ok: false, code: -1, hint: `fetch_err:${String(e).slice(0, 50)}` };
  }
}

// Try up to 3x; only consider 404/410 "definitive" after 2 consecutive
async function rdGet(apikey: string, projectId: number): Promise<{ ok: true; data: any } | { ok: false; final: boolean; code: number; hint: string }> {
  let lastHint = '';
  let lastCode = -1;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await rdGetOnce(apikey, projectId);
    if (r.ok) return r;
    lastHint = r.hint;
    lastCode = r.code;
    // Definitive errors only after 2nd consecutive identical 404/410
    if (attempt >= 2 && (r.code === 404 || r.code === 410)) {
      return { ok: false, final: true, code: r.code, hint: lastHint };
    }
    await new Promise(rr => setTimeout(rr, 500 * attempt));
  }
  return { ok: false, final: false, code: lastCode, hint: lastHint };
}

async function rest(method: string, path: string, body?: unknown, prefer = 'return=minimal'): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: prefer },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok && r.status !== 201 && r.status !== 409) throw new Error(`${method} ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

async function restGet(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  return r.ok ? r.json() : [];
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  const cronKey = req.headers.get('x-cron-key');
  const body = await req.json().catch(() => ({})) as { apikey?: string; limit?: number; parallel?: number };
  let apikey = body.apikey || '';
  if (!apikey && CRON_KEY !== '' && cronKey === CRON_KEY) apikey = Deno.env.get('ROOTDATA_API_KEY') || '';
  if (!apikey) return new Response(JSON.stringify({ error: 'apikey required' }), { status: 400 });
  const limit = Math.max(1, Math.min(200, body.limit ?? 60));
  const parallel = Math.max(1, Math.min(5, body.parallel ?? 3));

  const pending = await restGet(`rootdata_companies_staging?select=rd_project_id&name=like.__pending_*&order=rd_project_id.asc&limit=${limit}`);
  if (!pending.length) {
    return new Response(JSON.stringify({ message: 'queue empty', enriched: 0, gone: 0, transient: 0, elapsed_ms: Date.now() - t0 }), { headers: { 'Content-Type': 'application/json' } });
  }

  let enriched = 0;
  let gone = 0;
  let transient = 0;
  const errors: string[] = [];
  const queue = [...pending];

  const workers = Array.from({ length: parallel }, () => (async () => {
    while (queue.length) {
      const row = queue.shift()!;
      const pid = Number(row.rd_project_id);
      const res = await rdGet(apikey, pid);
      if (!res.ok) {
        if (res.final) {
          try { await rest('PATCH', `rootdata_companies_staging?rd_project_id=eq.${pid}`, { name: `__gone_${pid}__` }); gone++; } catch {}
        } else {
          transient++;
          if (errors.length < 10) errors.push(`pid ${pid}: ${res.hint}`);
        }
        await new Promise(rr => setTimeout(rr, 150));
        continue;
      }
      const item = res.data;
      const investorsArr = (item.investors || []) as any[];
      const investorNames = investorsArr.map(i => i.name).filter(Boolean);
      const leadNames = investorsArr.filter(i => i.lead_investor === 1 || i.lead_investor === true).map(i => i.name);
      const social = item.social_media || {};
      const patch: any = {
        name: item.project_name || item.name || `rd_${pid}`,
        one_liner: item.one_liner || null,
        description: item.description || null,
        logo: item.logo || null,
        tags: Array.isArray(item.tags) ? item.tags : null,
        ecosystem: Array.isArray(item.ecosystem) ? item.ecosystem : null,
        countries: Array.isArray(item.countries) ? item.countries : null,
        establishment_date: item.establishment_date || null,
        token_symbol: item.token_symbol || null,
        rt_score: item.rt_score ? Number(item.rt_score) : null,
        heat: item.heat ? Number(item.heat) : null,
        influence: item.influence ? Number(item.influence) : null,
        transparency: item.transparency || null,
        x_followers: Number(item.X_followers ?? item.x_followers ?? item.followers ?? 0) || null,
        total_funding: Number(item.total_funding ?? 0) || null,
        last_funding_date: item.last_funding_date || null,
        last_round_type: item.last_round_type || null,
        rootdataurl: item.rootdataurl || null,
        social_media: social,
        contracts: item.contract_address || item.contracts || null,
        team_members: item.team_members || null,
        invest_history: item.event || null,
        raw_payload: { ...item, investors_summary: investorNames.join(', '), leads_summary: leadNames.join(', ') },
      };
      try {
        await rest('PATCH', `rootdata_companies_staging?rd_project_id=eq.${pid}`, patch);
        enriched++;
      } catch (e) {
        if (errors.length < 10) errors.push(`pid ${pid} patch: ${String(e).slice(0, 120)}`);
      }
      // Pause between requests inside a worker — 4 req/sec per worker max
      await new Promise(rr => setTimeout(rr, 250));
    }
  })());

  await Promise.all(workers);

  const remCount = await fetch(`${SUPABASE_URL}/rest/v1/rootdata_companies_staging?select=rd_project_id&name=like.__pending_*&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: 'count=exact' },
  });
  const remaining = parseInt((remCount.headers.get('content-range') || '').split('/')[1] || '0', 10) || 0;

  return new Response(JSON.stringify({
    requested: limit, processed: pending.length, enriched, gone, transient,
    pending_remaining: remaining, errors_count: errors.length, errors_first_5: errors.slice(0, 5),
    elapsed_ms: Date.now() - t0,
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
