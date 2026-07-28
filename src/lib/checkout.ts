import { supabase } from "@/lib/supabase";

const CHECKOUT_URL = "https://qktjbtmcjrwzmtqnszbq.supabase.co/functions/v1/create-checkout-session";

async function post(bodyObj: Record<string, unknown>, failMsg: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login"; return; }
  try {
    const r = await fetch(CHECKOUT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(bodyObj),
    });
    const j = await r.json();
    if (j.url) { window.location.href = j.url; return; }
    alert(j.message || j.error || failMsg);
  } catch (e) {
    alert(failMsg);
  }
}

/** Starts Stripe Checkout for the $59/mo plan. Redirects to Stripe on success. */
export function startCheckout(): Promise<void> {
  return post({}, "Could not start checkout. Please try again.");
}

/** Opens the Stripe billing portal (cancel, change card, invoices). */
export function openBillingPortal(): Promise<void> {
  return post({ action: "portal" }, "Could not open billing portal. Please try again.");
}
