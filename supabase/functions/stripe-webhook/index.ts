import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';

// Per-minute API limits by key tier (also set by create-api-key for new keys).
const PRO_RATE = 1200;
const FREE_RATE = 60;

async function setFull(userId: string, patch: Record<string, unknown>) {
  await svc.from('user_profiles').upsert({ user_id: userId, plan_tier: 'pro', ...patch }, { onConflict: 'user_id' });
  await svc.from('api_keys').update({ tier: 'pro' }).eq('user_id', userId).is('revoked_at', null);
  // Raise to the paid limit; never lower a key that was given more by hand.
  await svc.from('api_keys').update({ rate_limit_per_min: PRO_RATE }).eq('user_id', userId).is('revoked_at', null)
    .or(`rate_limit_per_min.is.null,rate_limit_per_min.lt.${PRO_RATE}`);
}
async function setFree(userId: string, patch: Record<string, unknown>) {
  await svc.from('user_profiles').upsert({ user_id: userId, plan_tier: 'free', ...patch }, { onConflict: 'user_id' });
  await svc.from('api_keys').update({ tier: 'trial', rate_limit_per_min: FREE_RATE }).eq('user_id', userId).is('revoked_at', null);
}
async function userIdFromCustomer(customerId: string): Promise<string | null> {
  const { data } = await svc.from('user_profiles').select('user_id').eq('stripe_customer_id', customerId).maybeSingle();
  return data?.user_id ?? null;
}

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const body = await req.text();
  if (!sig || !WEBHOOK_SECRET) return new Response('missing sig/secret', { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch (e) {
    return new Response(`bad signature: ${String((e as Error).message)}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        const userId = (s.client_reference_id || (s.metadata?.user_id as string)) ?? null;
        // Record the subscription's real status rather than assuming 'active'.
        let status = 'active';
        if (s.subscription) {
          try { status = (await stripe.subscriptions.retrieve(s.subscription as string)).status; } catch { /* keep 'active' */ }
        }
        if (userId) await setFull(userId, {
          stripe_customer_id: (s.customer as string) ?? null,
          stripe_subscription_id: (s.subscription as string) ?? null,
          subscription_status: status,
        });
        break;
      }
      // 'created' covers subscriptions made by hand in the dashboard. It only ever
      // upgrades: Stripe doesn't order events, so a checkout's 'created' (status
      // 'incomplete') can arrive after checkout.session.completed and must not
      // undo it. 'updated' follows the status both ways.
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = (sub.metadata?.user_id as string) || await userIdFromCustomer(sub.customer as string);
        if (userId) {
          const active = sub.status === 'active' || sub.status === 'trialing';
          const patch = { stripe_subscription_id: sub.id, subscription_status: sub.status };
          if (active) await setFull(userId, patch);
          else if (event.type === 'customer.subscription.updated') await setFree(userId, patch);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = (sub.metadata?.user_id as string) || await userIdFromCustomer(sub.customer as string);
        if (userId) await setFree(userId, { subscription_status: 'canceled' });
        break;
      }
    }
  } catch (e) {
    return new Response(`handler error: ${String((e as Error).message)}`, { status: 500 });
  }
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
