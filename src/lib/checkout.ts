import { supabase } from "@/lib/supabase";

const CHECKOUT_URL = "https://qktjbtmcjrwzmtqnszbq.supabase.co/functions/v1/create-checkout-session";

/** Starts Stripe Checkout for the $59/mo plan. Redirects to Stripe on success. */
export async function startCheckout(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login"; return; }
  try {
    const r = await fetch(CHECKOUT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await r.json();
    if (j.url) { window.location.href = j.url; return; }
    alert(j.error || "Could not start checkout. Please try again.");
  } catch (e) {
    alert("Could not start checkout. Please try again.");
  }
}
