import { createClient } from "@/lib/supabase/server";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeOneOffTransaction } from "@/lib/paystack/transactions";
import { isStripeConfigured } from "@/lib/stripe/client";
import { createOneOffCheckoutSession } from "@/lib/stripe/checkout";
import { resolveProvider } from "@/lib/billing/provider";
import type { CheckoutMetadata } from "@/lib/billing/checkout-metadata";
import type { Currency } from "@tarragon/shared";

export type SponsoredSubscriptionCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/**
 * Puts someone you support on a paid plan and bills you.
 *
 * "Put my mother on Complete Care and bill my card monthly" is the most common
 * thing a diaspora buyer actually wants, and before this there was no path to
 * it at any price — a sponsor could buy single vouchers and nothing else, so
 * the recurring monitoring that makes the product worth having was the one
 * thing they could not fund.
 *
 * What this deliberately does NOT change: the person keeps their own account,
 * their own record, their own consent and their own control. The only thing
 * that moves is who the card belongs to. `subscriptions.paid_by_profile_id`
 * records that and nothing else, and both people are notified when it starts —
 * nobody should discover they have been put on a paid plan by noticing new
 * features appear.
 *
 * Authorisation is checked here for a fast, friendly failure AND again inside
 * private.activate_sponsored_subscription when the money actually lands, which
 * is what makes it real: a grant revoked between checkout and webhook buys
 * nothing. That second check is the one under test.
 */
export async function initiateSponsoredSubscriptionCheckout(args: {
  beneficiaryProfileId: string;
  planCode: string;
  payerCurrency: Currency;
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
    .from("subscription_plans")
    .select("code, name, price_minor, currency, interval, is_active")
    .eq("code", args.planCode)
    .maybeSingle();

  if (!plan || !plan.is_active) {
    return { ok: false, error: "That plan isn't available." };
  }

  // The plan is priced in naira because the care is delivered in Nigeria. A
  // payer abroad is charged the same care at the admin-set reference rate, not
  // a diaspora premium. An unset rate means dollar payment is simply not
  // offered yet, rather than a silent wrong-price charge.
  let chargeAmountMinor = plan.price_minor;
  if (args.payerCurrency !== plan.currency) {
    if (args.payerCurrency === "NGN" || plan.currency !== "NGN") {
      return { ok: false, error: "That plan can't be paid in your currency yet." };
    }
    const { data: fx } = await supabase
      .from("platform_currency_settings")
      .select("ngn_per_usd")
      .eq("id", true)
      .single();
    const rate = fx?.ngn_per_usd;
    if (!rate) {
      return {
        ok: false,
        error: `${args.payerCurrency} payments aren't set up yet — pay in NGN for now.`,
      };
    }
    chargeAmountMinor = Math.round(plan.price_minor / rate);
  }

  const metadata: CheckoutMetadata = {
    kind: "sponsored_subscription",
    profile_id: user.id,
    item_code: plan.code,
    plan_code: plan.code,
    beneficiary_profile_id: args.beneficiaryProfileId,
    sponsor_profile_id: user.id,
  };

  const provider = resolveProvider(args.payerCurrency);

  if (provider === "paystack") {
    if (!isPaystackConfigured()) return { ok: false, error: "Card payments aren't set up yet" };
    const result = await initializeOneOffTransaction({
      email: args.email,
      amountMinor: chargeAmountMinor,
      currency: "NGN",
      callbackUrl: args.callbackUrl,
      metadata,
    });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, checkoutUrl: result.data.authorizationUrl };
  }

  if (!isStripeConfigured()) return { ok: false, error: "Card payments aren't set up yet" };
  const result = await createOneOffCheckoutSession({
    email: args.email,
    amountMinor: chargeAmountMinor,
    currency: args.payerCurrency as "GBP" | "USD",
    description: `${plan.name} for someone you support`,
    successUrl: args.callbackUrl,
    cancelUrl: args.callbackUrl,
    metadata,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, checkoutUrl: result.data.checkoutUrl };
}
