import { createClient } from "@/lib/supabase/server";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeOneOffTransaction } from "@/lib/paystack/transactions";
import { isStripeConfigured } from "@/lib/stripe/client";
import { createOneOffCheckoutSession } from "@/lib/stripe/checkout";
import { resolveProvider } from "@/lib/billing/provider";
import type { CheckoutMetadata } from "@/lib/billing/checkout-metadata";
import type { Currency } from "@tarragon/shared";

export type ScreeningDayCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/**
 * Starts a checkout for the one payer funding a confirmed group screening
 * day — a church, market association, cooperative, or SME's own bulk booking
 * (see supabase/migrations/20260829164213_group_screening_days.sql). Mirrors
 * initiateVoucherPaymentCheckout exactly: no Edge Function involvement,
 * private.apply_screening_day_payment_from_transaction is an AFTER INSERT
 * trigger on payment_transactions, so this only needs to produce a real
 * provider reference and a pending screening_day_payments row for the
 * trigger to match. Authorisation and outstanding-amount checks live in
 * record_screening_day_payment_intent, not duplicated here.
 */
export async function initiateScreeningDayPaymentCheckout(args: {
  screeningDayId: string;
  creditKobo: number;
  payerCurrency: Currency;
  email: string;
  callbackUrl: string;
  description: string;
}): Promise<ScreeningDayCheckoutResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  let chargeAmountMinor = args.creditKobo;
  if (args.payerCurrency !== "NGN") {
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
    chargeAmountMinor = Math.round(args.creditKobo / rate);
  }

  const metadata: CheckoutMetadata = {
    kind: "screening_day_payment",
    profile_id: user.id,
    item_code: "screening_day_payment",
  };

  const provider = resolveProvider(args.payerCurrency);
  let reference: string;
  let checkoutUrl: string;

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
    reference = result.data.reference;
    checkoutUrl = result.data.authorizationUrl;
  } else {
    if (!isStripeConfigured()) return { ok: false, error: "Card payments aren't set up yet" };
    const result = await createOneOffCheckoutSession({
      email: args.email,
      amountMinor: chargeAmountMinor,
      currency: args.payerCurrency as "GBP" | "USD",
      description: args.description,
      successUrl: args.callbackUrl,
      cancelUrl: args.callbackUrl,
      metadata,
    });
    if (!result.ok) return { ok: false, error: result.error };
    reference = result.data.sessionId;
    checkoutUrl = result.data.checkoutUrl;
  }

  // Recorded AFTER the provider reference exists, so a pending row can never
  // point at a charge that was never created. The RPC re-checks authorisation
  // and that this instalment fits inside what is still outstanding.
  const { error } = await supabase.rpc("record_screening_day_payment_intent", {
    p_screening_day: args.screeningDayId,
    p_amount_minor: chargeAmountMinor,
    p_currency: args.payerCurrency,
    p_credit_kobo: args.creditKobo,
    p_provider: provider,
    p_reference: reference,
  });
  if (error) return { ok: false, error: error.message };

  return { ok: true, checkoutUrl };
}
