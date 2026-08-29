import { createClient } from "@/lib/supabase/server";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeOneOffTransaction } from "@/lib/paystack/transactions";
import type { CheckoutMetadata } from "@/lib/billing/checkout-metadata";

export type CarePassCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

const CARE_PASS_CODES = ["care_pass_12mo", "care_pass_6mo"] as const;

/**
 * E2 Care Pass (Revenue Architecture and Earnings Plan) — "one payment,
 * whatever the term, no card on file, no auto-renewal." Self-purchase only:
 * there is no beneficiary/sponsor split the way sponsored-subscription-
 * checkout.ts has one — a caller buys Care Pass for themselves. Activation
 * happens the same deploy-free way voucher_payment/sponsored_subscription
 * do, via private.activate_care_pass_purchase (an AFTER INSERT trigger on
 * payment_transactions), not by anything in this function reaching into
 * subscriptions directly — this function's only job is to charge the card
 * and hand back a checkout URL. Care Pass is NGN-only, matching the
 * platform's one-price-list rule (patient/subscription/actions.ts already
 * enforces this the same way for ordinary plan purchases).
 */
export async function initiateCarePassCheckout(args: {
  planCode: (typeof CARE_PASS_CODES)[number];
  email: string;
  callbackUrl: string;
}): Promise<CarePassCheckoutResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: plan } = await supabase
    .from("subscription_plans")
    .select("code, name, price_minor, currency, is_active")
    .eq("code", args.planCode)
    .maybeSingle();

  if (!plan || !plan.is_active || !CARE_PASS_CODES.includes(plan.code as (typeof CARE_PASS_CODES)[number])) {
    return { ok: false, error: "That plan isn't available." };
  }
  if (plan.currency !== "NGN") {
    return { ok: false, error: "Care Pass is only available in naira right now." };
  }

  const metadata: CheckoutMetadata = {
    kind: "care_pass_purchase",
    profile_id: user.id,
    item_code: plan.code,
  };

  if (!isPaystackConfigured()) return { ok: false, error: "Card payments aren't set up yet" };
  const result = await initializeOneOffTransaction({
    email: args.email,
    amountMinor: plan.price_minor,
    currency: "NGN",
    callbackUrl: args.callbackUrl,
    metadata,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, checkoutUrl: result.data.authorizationUrl };
}
