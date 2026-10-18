// create-api-key — generate ak_live_xxx, store sha256 hash, return full key ONCE.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function randHex(n: number): string {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return j({ error: 'missing auth' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return j({ error: 'invalid auth' }, 401);
  const userId = userData.user.id;

  const body = await req.json().catch(() => ({})) as { name?: string; scopes?: string[] };
  const name = (body.name || 'default').slice(0, 60);

  const svc = createClient(supabaseUrl, serviceKey);

  // Gate by plan_tier: free users cap at 1 active key
  const { data: profile } = await svc.from('user_profiles').select('plan_tier').eq('user_id', userId).maybeSingle();
  const tier = profile?.plan_tier || 'free';
  const limits: Record<string, number> = { free: 1, developer: 3, pro: 10, enterprise: 25 };
  const { count: existingCount } = await svc.from('api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).is('revoked_at', null);
  if ((existingCount ?? 0) >= (limits[tier] ?? 1)) {
    return j({ error: `Key limit reached for ${tier} tier (${limits[tier]}). Upgrade or revoke an existing key.` }, 403);
  }

  // Generate key: ak_live_ + 32 hex chars
  const secret = randHex(16); // 32 chars
  const fullKey = `ak_live_${secret}`;
  const prefix = fullKey.slice(0, 14);
  const hash = await sha256(fullKey);

  const rateByTier: Record<string, number> = { free: 60, developer: 240, pro: 1200, enterprise: 6000 };
  // Paying users get an unrestricted key; everyone else gets the free ('trial')
  // key tier, which api-v1 caps (25 rows, 180 days, held-back fields).
  const keyTier = tier === 'pro' || tier === 'enterprise' ? 'pro' : 'trial';
  const { data, error } = await svc.from('api_keys').insert({
    user_id: userId, name, key_prefix: prefix, key_hash: hash,
    tier: keyTier,
    rate_limit_per_min: rateByTier[tier] ?? 60,
  }).select('id,key_prefix,name,created_at').maybeSingle();
  if (error) return j({ error: error.message }, 500);

  return j({ id: data?.id, name, key_prefix: prefix, key: fullKey, message: 'Save this key now — you will not see it again.' });
});

function j(p: any, status = 200) { return new Response(JSON.stringify(p), { status, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
