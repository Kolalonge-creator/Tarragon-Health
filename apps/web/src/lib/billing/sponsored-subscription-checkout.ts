import { createClient } from "@/lib/supabase/server";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeOneOffTransaction } from "@/lib/paystack/transactions";
import type { CheckoutMetadata } from "@/lib/billing/checkout-metadata";

export type SponsoredSubscriptionCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/**
 * Puts someone you support on a paid service and bills you.
 *
 * "Pay for my mother's 12-week programme and bill my card" is the most
 * common thing a sponsor abroad actually wants, and before this there was no
 * path to it at any price — a sponsor could buy single vouchers and nothing
 * else, so the ongoing care that makes the product worth having was the one
 * thing they could not fund.
 *
 * What this deliberately does NOT change: the person keeps their own account,
 * their own record, their own consent and their own control. The only thing
 * that moves is who the card belongs to. `subscriptions.paid_by_profile_id`
 * records that and nothing else, and both people are notified when it starts —
 * nobody should discover they have been put on a paid service by noticing new
 * features appear.
 *
 * Authorisation is checked here for a fast, friendly failure AND again inside
 * private.activate_sponsored_subscription when the money actually lands, which
 * is what makes it real: a grant revoked between checkout and webhook buys
 * nothing. That second check is the one under test.
 *
 * NGN via Paystack only. A payer-currency conversion path for a sponsor
 * abroad used to sit here, converting at the admin-set reference rate and
 * billing through Stripe. Removed 2026-09-03: there was never a registered
 * Stripe account behind it (needs a UK business registration that hasn't
 * happened), so a non-NGN sponsor payment could never actually complete.
 * Every service_products row is NGN-priced anyway — a sponsor abroad funds
 * the same naira price everyone else pays, via Paystack, same as anyone else.
 */
export async function initiateSponsoredSubscriptionCheckout(args: {
  beneficiaryProfileId: string;
  planCode: string;
  email: string;
  callbackUrl: string;
}): Promise<SponsoredSubscriptionCheckoutResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  // A sponsor may only fund a plan for someone who has actually asked them to
  // act on their behalf. 'view' is being trusted to look, not to spend.
  const { data: grant } = await supabase
    .from("profile_access")
    .select("permission_level")
    .eq("profile_id", args.beneficiaryProfileId)
    .eq("grantee_user_id", user.id)
    .maybeSingle();

  if (grant?.permission_level !== "manage") {
    return { ok: false, error: "You don't have permission to pay for this person's plan." };
  }

  const { data: plan } = await supabase
    .from("service_products")
    .select("code, name, price_kobo, currency, access_duration_days, is_active")
    .eq("code", args.planCode)
    .maybeSingle();

  if (!plan || !plan.is_active) {
    return { ok: false, error: "That service isn't available." };
  }
  if (plan.currency !== "NGN") {
    return { ok: false, error: "That service can't be paid in your currency yet." };
  }

  if (!isPaystackConfigured()) return { ok: false, error: "Card payments aren't set up yet" };

  const metadata: CheckoutMetadata = {
    kind: "sponsored_subscription",
    profile_id: user.id,
    item_code: plan.code,
    plan_code: plan.code,
    beneficiary_profile_id: args.beneficiaryProfileId,
    sponsor_profile_id: user.id,
  };

  const result = await initializeOneOffTransaction({
    email: args.email,
    amountMinor: plan.price_kobo,
    currency: "NGN",
    callbackUrl: args.callbackUrl,
    metadata,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, checkoutUrl: result.data.authorizationUrl };
}
