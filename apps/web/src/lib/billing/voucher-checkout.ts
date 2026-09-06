import { createClient } from "@/lib/supabase/server";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeOneOffTransaction } from "@/lib/paystack/transactions";
import type { CheckoutMetadata } from "@/lib/billing/checkout-metadata";

export type VoucherCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/**
 * Starts a checkout for one instalment toward a specific Care Voucher.
 *
 * The amount is charged in kobo against the voucher's own naira price, which
 * is pinned server-side at purchase. NGN via Paystack only — a payer-currency
 * conversion path for a non-NGN (diaspora) payer used to sit here, converting
 * at the admin-set reference rate and billing through Stripe. That path is
 * removed 2026-09-03: there was never a registered Stripe account behind it
 * (needs a UK business registration that hasn't happened), so no non-NGN
 * payment could ever actually complete. A diaspora sponsor still funds
 * someone's care today, just in naira via Paystack, same as anyone else.
 *
 * No Edge Function involvement. private.apply_voucher_payment_from_transaction
 * is an AFTER INSERT trigger on payment_transactions (see
 * supabase/migrations/20260731215226_care_vouchers_purchase_and_layaway.sql),
 * so all this needs to produce is a real provider reference and a pending
 * care_voucher_payments row for the trigger to match. Authorisation lives in
 * record_voucher_payment_intent, not duplicated here.
 */
export async function initiateVoucherPaymentCheckout(args: {
  voucherId: string;
  instalmentKobo: number;
  email: string;
  callbackUrl: string;
  description: string;
}): Promise<VoucherCheckoutResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  if (!isPaystackConfigured()) return { ok: false, error: "Card payments aren't set up yet" };

  const metadata: CheckoutMetadata = {
    kind: "voucher_payment",
    profile_id: user.id,
    item_code: "voucher_payment",
  };

  const result = await initializeOneOffTransaction({
    email: args.email,
    amountMinor: args.instalmentKobo,
    currency: "NGN",
    callbackUrl: args.callbackUrl,
    metadata,
  });
  if (!result.ok) return { ok: false, error: result.error };

  // Recorded AFTER the provider reference exists, so a pending row can never
  // point at a charge that was never created. The RPC re-checks authorisation
  // and that the instalment fits inside what is still outstanding.
  const { error } = await supabase.rpc("record_voucher_payment_intent", {
    p_voucher: args.voucherId,
    p_amount_minor: args.instalmentKobo,
    p_currency: "NGN",
    p_instalment_kobo: args.instalmentKobo,
    p_provider: "paystack",
    p_reference: result.data.reference,
  });
  if (error) return { ok: false, error: error.message };

  return { ok: true, checkoutUrl: result.data.authorizationUrl };
}
