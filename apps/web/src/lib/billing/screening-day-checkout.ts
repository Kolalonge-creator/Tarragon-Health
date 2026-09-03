import { createClient } from "@/lib/supabase/server";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeOneOffTransaction } from "@/lib/paystack/transactions";
import type { CheckoutMetadata } from "@/lib/billing/checkout-metadata";

export type ScreeningDayCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/**
 * Starts a checkout for the one payer funding a confirmed group screening
 * day — a church, market association, cooperative, or SME's own bulk booking
 * (see supabase/migrations/20260829003735_group_screening_days.sql). NGN via
 * Paystack only — this mirrors initiateVoucherPaymentCheckout exactly,
 * including that file's 2026-09-03 removal of the non-NGN Stripe path (there
 * was never a registered Stripe account behind it, so no non-NGN payment
 * could ever actually complete; a diaspora payer funds a screening day in
 * naira today, same as anyone else). No Edge Function involvement —
 * private.apply_screening_day_payment_from_transaction is an AFTER INSERT
 * trigger on payment_transactions, so this only needs to produce a real
 * provider reference and a pending screening_day_payments row for the
 * trigger to match. Authorisation and outstanding-amount checks live in
 * record_screening_day_payment_intent, not duplicated here.
 */
export async function initiateScreeningDayPaymentCheckout(args: {
  screeningDayId: string;
  creditKobo: number;
  email: string;
  callbackUrl: string;
  description: string;
}): Promise<ScreeningDayCheckoutResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  if (!isPaystackConfigured()) return { ok: false, error: "Card payments aren't set up yet" };

  const metadata: CheckoutMetadata = {
    kind: "screening_day_payment",
    profile_id: user.id,
    item_code: "screening_day_payment",
  };

  const result = await initializeOneOffTransaction({
    email: args.email,
    amountMinor: args.creditKobo,
    currency: "NGN",
    callbackUrl: args.callbackUrl,
    metadata,
  });
  if (!result.ok) return { ok: false, error: result.error };

  // Recorded AFTER the provider reference exists, so a pending row can never
  // point at a charge that was never created. The RPC re-checks authorisation
  // and that this instalment fits inside what is still outstanding.
  const { error } = await supabase.rpc("record_screening_day_payment_intent", {
    p_screening_day: args.screeningDayId,
    p_amount_minor: args.creditKobo,
    p_currency: "NGN",
    p_credit_kobo: args.creditKobo,
    p_provider: "paystack",
    p_reference: result.data.reference,
  });
  if (error) return { ok: false, error: error.message };

  return { ok: true, checkoutUrl: result.data.authorizationUrl };
}
