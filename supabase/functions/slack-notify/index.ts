import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type' };
function j(p: unknown, s = 200) { return new Response(JSON.stringify(p), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return j({ error: 'Use POST' }, 405);

  // Cron/ops path: an x-cron-key caller (pg_cron health checks) posts to the
  // project's own ops channel, SLACK_WEBHOOK_URL. Any webhook_url in the body is
  // ignored here so the cron key can't be used to post to arbitrary webhooks.
  const cronKey = Deno.env.get('CRON_KEY') || '__cron_key_unset__';
  if (req.headers.get('x-cron-key') === cronKey) {
    const opsUrl = Deno.env.get('SLACK_WEBHOOK_URL') || '';
    if (!/^https:\/\/hooks\.slack\.com\/services\//.test(opsUrl)) return j({ error: 'SLACK_WEBHOOK_URL not configured' }, 500);
    const b = (await req.json().catch(() => ({}))) as { text?: string };
    const t = (b.text || '').slice(0, 2000);
    if (!t) return j({ error: 'text required' }, 400);
    try {
      const r = await fetch(opsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t }), signal: AbortSignal.timeout(10_000) });
      const respText = await r.text().catch(() => '');
      if (!r.ok) return j({ error: `Slack returned ${r.status}: ${respText.slice(0, 120)}` }, 502);
      return j({ ok: true, channel: 'ops' });
    } catch (e) {
      return j({ error: String((e as Error).message || e).slice(0, 150) }, 500);
    }
  }

  // Otherwise require a logged-in user
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return j({ error: 'missing auth' }, 401);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return j({ error: 'invalid auth' }, 401);

  const body = (await req.json().catch(() => ({}))) as { webhook_url?: string; text?: string };
  const url = (body.webhook_url || '').trim();
  const text = (body.text || '').slice(0, 2000);
  // Only allow real Slack incoming webhooks (prevents SSRF to arbitrary hosts)
  if (!/^https:\/\/hooks\.slack\.com\/services\//.test(url)) {
    return j({ error: 'Invalid Slack webhook URL. It should start with https://hooks.slack.com/services/' }, 400);
  }
  if (!text) return j({ error: 'text required' }, 400);

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    const respText = await r.text().catch(() => '');
    if (!r.ok) return j({ error: `Slack returned ${r.status}: ${respText.slice(0, 120)}` }, 502);
    return j({ ok: true });
  } catch (e) {
    return j({ error: String((e as Error).message || e).slice(0, 150) }, 500);
  }
});
