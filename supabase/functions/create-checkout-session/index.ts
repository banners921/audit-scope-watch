import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
function j(p: unknown, status = 200) { return new Response(JSON.stringify(p), { status, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

// The $79/mo plan price, found by lookup key. Created on first use on the same
// product as the original $59 price (STRIPE_PRICE_ID), so no price id has to be
// copied into secrets by hand.
const PRICE_LOOKUP_KEY = 'auditscope_pro_monthly_79';
const PRICE_CENTS = 7900;
const LEGACY_PRICE_ID = Deno.env.get('STRIPE_PRICE_ID') || 'price_1TyJ63Fs6CJPqHkUxFIOo1kW';
const TRIAL_DAYS = 7;
let cachedPriceId: string | null = null;

async function planPriceId(stripe: Stripe): Promise<string> {
  if (cachedPriceId) return cachedPriceId;
  const found = await stripe.prices.list({ lookup_keys: [PRICE_LOOKUP_KEY], active: true, limit: 1 });
  if (found.data[0]) return (cachedPriceId = found.data[0].id);
  const legacy = await stripe.prices.retrieve(LEGACY_PRICE_ID);
  const product = typeof legacy.product === 'string' ? legacy.product : legacy.product.id;
  const created = await stripe.prices.create({
    product,
    currency: 'usd',
    unit_amount: PRICE_CENTS,
    recurring: { interval: 'month' },
    lookup_key: PRICE_LOOKUP_KEY,
    nickname: 'AuditScope Pro $79/mo',
  });
  return (cachedPriceId = created.id);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return j({ error: 'Use POST' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return j({ error: 'STRIPE_SECRET_KEY not set' }, 500);

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return j({ error: 'missing auth' }, 401);

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await userClient.auth.getUser();
  const user = userData?.user;
  if (!user) return j({ error: 'invalid auth' }, 401);

  const svc = createClient(supabaseUrl, serviceKey);
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });
  const origin = req.headers.get('origin') || 'https://auditscope.ai';
  const body = (await req.json().catch(() => ({}))) as { action?: string };

  // Get or create the Stripe customer for this user
  const { data: profile } = await svc.from('user_profiles').select('stripe_customer_id').eq('user_id', user.id).maybeSingle();
  let customerId = profile?.stripe_customer_id as string | undefined;

  // --- Billing portal (manage plan: cancel, change card, invoices) ---
  if (body.action === 'portal') {
    if (!customerId) return j({ error: 'no_subscription', message: 'No billing account yet. Upgrade first.' }, 400);
    try {
      const portal = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${origin}/account` });
      return j({ url: portal.url });
    } catch (e) {
      return j({ error: String((e as Error).message || e) }, 500);
    }
  }

  // --- Checkout ($79/mo, 7-day trial for first-time subscribers) ---
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email ?? undefined, metadata: { user_id: user.id } });
    customerId = customer.id;
    await svc.from('user_profiles').upsert({ user_id: user.id, stripe_customer_id: customerId }, { onConflict: 'user_id' });
  }
  try {
    const priceId = await planPriceId(stripe);
    // One trial per customer: anyone who has ever had a subscription pays from day one.
    const prior = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 1 });
    const trial = prior.data.length === 0;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_collection: 'always',
      success_url: `${origin}/account?upgraded=1`,
      cancel_url: `${origin}/pricing`,
      client_reference_id: user.id,
      metadata: { user_id: user.id },
      subscription_data: { metadata: { user_id: user.id }, ...(trial ? { trial_period_days: TRIAL_DAYS } : {}) },
      allow_promotion_codes: true,
    });
    return j({ url: session.url });
  } catch (e) {
    return j({ error: String((e as Error).message || e) }, 500);
  }
});
