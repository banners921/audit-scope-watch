import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supa = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(status: number, body: unknown, extraHeaders: Record<string,string> = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json', ...CORS, ...extraHeaders },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function extractApiKey(req: Request): string | null {
  const xkey = req.headers.get('x-api-key');
  if (xkey) return xkey.trim();
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

async function authenticate(key: string) {
  if (!key.startsWith('ak_live_')) return { error: 'malformed_key', status: 401 as const };
  const key_hash = await sha256Hex(key);
  const { data, error } = await supa
    .from('api_keys')
    .select('id,user_id,rate_limit_per_min,revoked_at,tier,expires_at')
    .eq('key_hash', key_hash)
    .maybeSingle();
  if (error || !data) return { error: 'invalid_key', status: 401 as const };
  if (data.revoked_at) return { error: 'revoked_key', status: 401 as const };
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return { error: 'expired_key', status: 401 as const };
  return { key_row: data };
}

async function checkRateLimit(api_key_id: string, limit: number) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supa
    .from('api_usage')
    .select('id', { count: 'exact', head: true })
    .eq('api_key_id', api_key_id)
    .gte('created_at', since);
  const used = count ?? 0;
  return { ok: used < limit, used, limit, remaining: Math.max(0, limit - used) };
}

async function logUsage(api_key_id: string, user_id: string, endpoint: string, status_code: number, bytes: number, ms: number) {
  await supa.from('api_usage').insert({
    api_key_id, user_id, endpoint, status_code, bytes_returned: bytes, ms_elapsed: ms,
  });
  await supa.rpc('increment_api_key_count', { p_key_id: api_key_id }).catch(() => {});
}

function parseIntSafe(v: string | null, def: number, max: number): number {
  if (!v) return def;
  const n = parseInt(v, 10);
  if (Number.isNaN(n) || n < 1) return def;
  return Math.min(n, max);
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

// Trial tier: cap history depth so the raw feed can't be used to rebuild the dataset.
const TRIAL_HISTORY_DAYS = 180;
const TRIAL_ROW_CAP = 25;
const TRIAL_NOTE = 'Free tier: results capped to 25 rows/request, history capped to 180 days, and sensitive fields (report/source/announcement URLs, investor lists, on-chain pointers) withheld. Upgrade for full access.';

// ---------------------------------------------------------------------------
// /v1/audits?repo=  — codebase-level lookup.
// Exact repo matches first (with the audited commit hash), then the rest of the
// owning company's audit history so an unmatched repo still returns something.
// ---------------------------------------------------------------------------
const REPO_TRIAL_NOTE = 'Free tier: repo lookups return firm, date and severity counts only. Report URLs and audited commit hashes require a paid key.';

type RepoRow = Record<string, unknown> & { match_type: string };

async function handleAuditsByRepo(url: URL, tier: string, repoParam: string) {
  const isTrial = tier === 'trial';
  const limit = parseIntSafe(url.searchParams.get('limit'), isTrial ? TRIAL_ROW_CAP : 50, isTrial ? TRIAL_ROW_CAP : 200);
  const includeCompany = (url.searchParams.get('include_company') ?? 'true').toLowerCase() !== 'false';

  const [{ data: rows, error }, { data: resolved }] = await Promise.all([
    supa.rpc('api_audits_by_repo', { p_repo: repoParam, p_limit: limit, p_include_company: includeCompany }),
    supa.rpc('api_resolve_repo', { p_repo: repoParam }),
  ]);
  if (error) return { status: 500, body: { error: 'db_error', detail: error.message } };

  const all = (rows ?? []) as RepoRow[];
  const items = all.map((r) => {
    if (!isTrial) return r;
    const { report_url: _r, audited_commit_hash: _c, data_source: _d, ...rest } = r;
    return rest;
  });

  const exact = all.filter((r) => r.match_type === 'repo').length;
  const res = (resolved ?? [])[0] as { company_slug?: string; via?: string } | undefined;
  const match = exact > 0 ? 'repo' : (items.length > 0 ? 'company' : 'none');

  // Distinguish "we identified the protocol but hold no audits for it" from
  // "this repo means nothing to us" — very different answers for the caller.
  const notes: string[] = [];
  if (match === 'none' && res?.company_slug) {
    notes.push(`Repo resolved to protocol "${res.company_slug}", but we hold no audits for it yet.`);
  } else if (match === 'none') {
    notes.push('Repo not recognised. No audit on file references this codebase, and its GitHub org does not map to a protocol we track.');
  } else if (match === 'company') {
    notes.push('No audit is pinned to this exact repo. Rows below are other audits of the owning protocol — treat as protocol-level, not codebase-level, evidence.');
  }
  if (isTrial) notes.push(REPO_TRIAL_NOTE);

  return {
    status: 200,
    body: {
      tier,
      query: { repo: repoParam },
      match,
      resolved_company_slug: res?.company_slug ?? null,
      resolved_via: res?.via ?? null,
      counts: { exact_repo: exact, company_level: items.length - exact, total: items.length },
      data: items,
      count: items.length,
      notes,
    },
  };
}

async function handleAudits(url: URL, tier: string) {
  const repoParam = url.searchParams.get('repo');
  if (repoParam) return handleAuditsByRepo(url, tier, repoParam);

  const isTrial = tier === 'trial';
  const limit = parseIntSafe(url.searchParams.get('limit'), isTrial ? TRIAL_ROW_CAP : 50, isTrial ? TRIAL_ROW_CAP : 200);
  const firm = url.searchParams.get('firm');
  const protocol_slug = url.searchParams.get('protocol_slug');
  let since = url.searchParams.get('since'); // audit_date >= since (YYYY-MM-DD)
  const chain = url.searchParams.get('chain');
  const cursor = url.searchParams.get('cursor'); // created_at ISO string

  if (isTrial) {
    const floor = isoDaysAgo(TRIAL_HISTORY_DAYS);
    if (!since || since < floor) since = floor;
  }

  // Report URLs / repo pointers are withheld on trial (bulk-export protection).
  const cols = isTrial
    ? 'id,protocol_name,protocol_slug,audit_firm,audit_date,audit_type,findings_critical,findings_high,findings_medium,findings_low,audited_chains,smart_contract_language,created_at'
    : 'id,protocol_name,protocol_slug,audit_firm,audit_date,audit_type,report_url,findings_critical,findings_high,findings_medium,findings_low,findings_informational,audited_repo_url,audited_commit_hash,audited_chains,smart_contract_language,data_source,created_at';

  let q = supa.from('audit_history')
    .select(cols)
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (firm) q = q.ilike('audit_firm', firm);
  if (protocol_slug) q = q.eq('protocol_slug', protocol_slug);
  if (since) q = q.gte('audit_date', since);
  if (chain) q = q.contains('audited_chains', [chain]);
  if (cursor) q = q.lt('created_at', cursor);

  const { data, error } = await q;
  if (error) return { status: 500, body: { error: 'db_error', detail: error.message } };

  const rows = data ?? [];
  const has_more = rows.length > limit;
  const items = has_more ? rows.slice(0, limit) : rows;
  const next_cursor = has_more ? (items[items.length - 1] as { created_at: string }).created_at : null;

  return { status: 200, body: { tier, data: items, next_cursor, count: items.length, ...(isTrial ? { note: TRIAL_NOTE } : {}) } };
}

async function handleTrends(url: URL) {
  const firm = url.searchParams.get('firm');            // ILIKE, optional
  const since = url.searchParams.get('since');           // YYYY-MM-DD, optional (default last 24 months)
  const sinceEff = since || isoDaysAgo(730);

  const [{ data: totals, error: te }, { data: monthly, error: me }] = await Promise.all([
    supa.rpc('trend_firm_totals', { p_firm: firm }),
    supa.rpc('trend_audits_by_firm', { p_since: sinceEff, p_firm: firm, p_limit: 5000 }),
  ]);
  if (te || me) return { status: 500, body: { error: 'db_error', detail: (te || me)!.message } };

  const by_firm = (totals ?? []).map((r: Record<string, unknown>) => ({
    firm: r.audit_firm, total_audits: Number(r.total), dated_audits: Number(r.dated),
    first_audit: r.first_audit, last_audit: r.last_audit,
  }));
  const monthly_series = (monthly ?? []).map((r: Record<string, unknown>) => ({
    firm: r.audit_firm, month: r.month, audits: Number(r.audits),
  }));

  return { status: 200, body: {
    description: 'Audit volume by provider. by_firm = all-time totals; monthly = audits per firm per month (dated audits only).',
    since: sinceEff,
    firm_count: by_firm.length,
    total_audits: by_firm.reduce((a: number, b: { total_audits: number }) => a + b.total_audits, 0),
    by_firm,
    monthly: monthly_series,
  } };
}

async function handleHacks(url: URL, tier: string) {
  const isTrial = tier === 'trial';
  const limit = parseIntSafe(url.searchParams.get('limit'), isTrial ? TRIAL_ROW_CAP : 50, isTrial ? TRIAL_ROW_CAP : 200);
  let since = url.searchParams.get('since');
  const min_amount = url.searchParams.get('min_amount_usd');
  const chain = url.searchParams.get('chain');
  const target_type = url.searchParams.get('target_type');
  const cursor = url.searchParams.get('cursor');

  if (isTrial) {
    const floor = isoDaysAgo(TRIAL_HISTORY_DAYS);
    if (!since || since < floor) since = floor;
  }

  // On trial, withhold on-chain pointers + source url (the investigable specifics).
  const cols = isTrial
    ? 'id,name,company_slug,hack_date,amount_usd,classification,technique,target_type,chains,language,bridge_hack,returned_funds,created_at'
    : 'id,name,company_slug,hack_date,amount_usd,classification,technique,target_type,chains,language,bridge_hack,returned_funds,source_url,vector,summary,tx_hash,attacker_address,created_at';

  let q = supa.from('hacks')
    .select(cols)
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (since) q = q.gte('hack_date', since);
  if (min_amount) q = q.gte('amount_usd', Number(min_amount));
  if (chain) q = q.contains('chains', [chain]);
  if (target_type) q = q.eq('target_type', target_type);
  if (cursor) q = q.lt('created_at', cursor);

  const { data, error } = await q;
  if (error) return { status: 500, body: { error: 'db_error', detail: error.message } };

  const rows = data ?? [];
  const has_more = rows.length > limit;
  const items = has_more ? rows.slice(0, limit) : rows;
  const next_cursor = has_more ? (items[items.length - 1] as { created_at: string }).created_at : null;

  return { status: 200, body: { tier, data: items, next_cursor, count: items.length, ...(isTrial ? { note: TRIAL_NOTE } : {}) } };
}

async function handleFundingRounds(url: URL, tier: string) {
  const isTrial = tier === 'trial';
  const limit = parseIntSafe(url.searchParams.get('limit'), isTrial ? TRIAL_ROW_CAP : 50, isTrial ? TRIAL_ROW_CAP : 200);
  let since = url.searchParams.get('since');
  const min_amount = url.searchParams.get('min_amount_usd');
  const round_type = url.searchParams.get('round_type');
  const category = url.searchParams.get('category');
  const cursor = url.searchParams.get('cursor');

  if (isTrial) {
    const floor = isoDaysAgo(TRIAL_HISTORY_DAYS);
    if (!since || since < floor) since = floor;
  }

  // On trial, withhold the investor lists + announcement url (the high-value fields).
  const cols = isTrial
    ? 'id,company_name,company_slug,category,amount_usd,round_type,date,lead_investors,created_at'
    : 'id,company_name,company_slug,category,amount_usd,round_type,date,lead_investors,other_investors,all_investors,announcement_url,data_source,created_at';

  let q = supa.from('funding_rounds')
    .select(cols)
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (since) q = q.gte('date', since);
  if (min_amount) q = q.gte('amount_usd', Number(min_amount));
  if (round_type) q = q.ilike('round_type', round_type);
  if (category) q = q.ilike('category', category);
  if (cursor) q = q.lt('created_at', cursor);

  const { data, error } = await q;
  if (error) return { status: 500, body: { error: 'db_error', detail: error.message } };

  const rows = data ?? [];
  const has_more = rows.length > limit;
  const items = has_more ? rows.slice(0, limit) : rows;
  const next_cursor = has_more ? (items[items.length - 1] as { created_at: string }).created_at : null;

  return { status: 200, body: { tier, data: items, next_cursor, count: items.length, ...(isTrial ? { note: TRIAL_NOTE } : {}) } };
}

Deno.serve(async (req) => {
  const started = Date.now();

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });

  const url = new URL(req.url);
  const cleanPath = url.pathname
    .replace(/^\/functions\/v1\/api-v1(-[a-z0-9-]+)?/, '')
    .replace(/^\/api-v1(-[a-z0-9-]+)?/, '')
    .replace(/^\/v1/, '')
    .replace(/\/+$/, '') || '/';

  if (cleanPath === '/' || cleanPath === '') {
    return json(200, {
      name: 'AuditScope API v1',
      docs: 'https://auditscope.ai/docs',
      endpoints: ['/v1/trends/audits-by-firm', '/v1/audits', '/v1/audits?repo=github.com/org/repo', '/v1/hacks', '/v1/funding-rounds'],
      auth: 'Include "X-Api-Key: ak_live_..." or "Authorization: Bearer ak_live_..." header.',
    });
  }

  const key = extractApiKey(req);
  if (!key) return json(401, { error: 'missing_api_key', message: 'Provide X-Api-Key or Authorization: Bearer header.' });

  const authResult = await authenticate(key);
  if ('error' in authResult) return json(authResult.status, { error: authResult.error });

  const { key_row } = authResult;
  const tier = (key_row as { tier?: string }).tier || 'trial';
  const rateLimit = key_row.rate_limit_per_min ?? (tier === 'trial' ? 20 : 60);

  const rl = await checkRateLimit(key_row.id, rateLimit);
  const rlHeaders = {
    'X-RateLimit-Limit': String(rl.limit),
    'X-RateLimit-Remaining': String(rl.remaining),
  };
  if (!rl.ok) {
    return json(429, { error: 'rate_limit_exceeded', limit: rl.limit, retry_after_seconds: 60 }, { ...rlHeaders, 'Retry-After': '60' });
  }

  let result: { status: number; body: unknown };

  if (cleanPath === '/trends/audits-by-firm' || cleanPath === '/trends') result = await handleTrends(url);
  else if (cleanPath === '/audits') result = await handleAudits(url, tier);
  else if (cleanPath === '/hacks') result = await handleHacks(url, tier);
  else if (cleanPath === '/funding-rounds' || cleanPath === '/funding_rounds') result = await handleFundingRounds(url, tier);
  else result = { status: 404, body: { error: 'not_found', path: cleanPath, endpoints: ['/v1/trends/audits-by-firm', '/v1/audits', '/v1/hacks', '/v1/funding-rounds'] } };

  const payload = JSON.stringify(result.body, null, 2);
  const bytes = new TextEncoder().encode(payload).byteLength;
  const ms = Date.now() - started;

  logUsage(key_row.id, key_row.user_id, cleanPath, result.status, bytes, ms).catch(() => {});

  return new Response(payload, {
    status: result.status,
    headers: { 'content-type': 'application/json', ...CORS, ...rlHeaders, 'X-Response-Time-Ms': String(ms) },
  });
});
