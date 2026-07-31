import { createClient } from "@/lib/supabase/server";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeOneOffTransaction } from "@/lib/paystack/transactions";
import { isStripeConfigured } from "@/lib/stripe/client";
import { createOneOffCheckoutSession } from "@/lib/stripe/checkout";
import { resolveProvider } from "@/lib/billing/provider";
import type { CheckoutMetadata } from "@/lib/billing/checkout-metadata";
import type { Currency } from "@tarragon/shared";

export type VoucherCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/**
 * Starts a checkout for one instalment toward a specific Care Voucher.
 *
 * The amount is expressed in kobo against the voucher's own price, which is
 * pinned server-side at purchase. If the payer's own currency is not NGN (the
 * diaspora case) the charge is converted at the admin-set reference rate; an
 * unset rate simply means dollar payments are not offered yet, rather than a
 * silent wrong-price charge.
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
  creditKobo: number;
  payerCurrency: Currency;
  email: string;
  callbackUrl: string;
  description: string;
}): Promise<VoucherCheckoutResult> {
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
    kind: "voucher_payment",
    profile_id: user.id,
    item_code: "voucher_payment",
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
  // and that the instalment fits inside what is still outstanding.
  const { error } = await supabase.rpc("record_voucher_payment_intent", {
    p_voucher: args.voucherId,
    p_amount_minor: chargeAmountMinor,
    p_currency: args.payerCurrency,
    p_credit_kobo: args.creditKobo,
    p_provider: provider,
    p_reference: reference,
  });
  if (error) return { ok: false, error: error.message };

  return { ok: true, checkoutUrl };
}
