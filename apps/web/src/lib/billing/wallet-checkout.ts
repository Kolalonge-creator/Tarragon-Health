import { createClient } from "@/lib/supabase/server";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeOneOffTransaction } from "@/lib/paystack/transactions";
import { isStripeConfigured } from "@/lib/stripe/client";
import { createOneOffCheckoutSession } from "@/lib/stripe/checkout";
import { resolveProvider } from "@/lib/billing/provider";
import type { CheckoutMetadata } from "@/lib/billing/checkout-metadata";
import type { Currency } from "@tarragon/shared";

export type WalletTopupCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/**
 * Starts a wallet top-up checkout — funding the caller's own wallet, or, with
 * a profile_access grant from its owner, someone else's. This is not a
 * diaspora-only feature: any consented relationship works today via
 * NGN/Paystack, e.g. a Lagos-based child funding a parent's care in another
 * state. The credited amount always lands in kobo (NGN); if the payer's own
 * currency isn't NGN (the diaspora dollar case), the charge amount is
 * converted at the admin-set platform_currency_settings rate — an unset rate
 * means dollar top-ups aren't offered yet.
 *
 * No Edge Function involvement: crediting happens via
 * private.credit_wallet_from_payment_transaction, an AFTER INSERT trigger on
 * payment_transactions (see
 * supabase/migrations/20260723193547_health_wallet_core.sql) — this function
 * only needs a real Paystack/Stripe reference and a pending wallet_topups row
 * for the trigger to match against; ownership/authorization is enforced
 * inside get_or_create_wallet_for(), not duplicated here.
 */
export async function initiateWalletTopupCheckout(args: {
  beneficiaryProfileId: string;
  creditKobo: number;
  payerCurrency: Currency;
  email: string;
  callbackUrl: string;
  description: string;
}): Promise<WalletTopupCheckoutResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: walletId, error: walletError } = await supabase.rpc("get_or_create_wallet_for", {
    p_profile: args.beneficiaryProfileId,
  });
  if (walletError || !walletId) {
    return {
      ok: false,
      error:
        walletError?.code === "42501"
          ? "You're not authorised to fund that person's wallet."
          : (walletError?.message ?? "Could not open that wallet"),
    };
  }

  const { data: wallet } = await supabase
    .from("health_wallets")
    .select("organisation_id")
    .eq("id", walletId)
    .single();
  if (!wallet) return { ok: false, error: "Wallet not found" };

  // CBN tiered-KYC balance ceiling, checked here (before any charge is
  // created) rather than inside private.wallet_apply — that function is also
  // called from an AFTER INSERT trigger on payment_transactions with no
  // exception handler, so rejecting a credit there would abort the webhook's
  // own audit-log write for a charge that already succeeded at the payment
  // provider. See supabase/migrations/20260731020000_wallet_kyc_tiers_and_aml_flags.sql.
  const { data: headroomKobo, error: headroomError } = await supabase.rpc(
    "wallet_kyc_balance_headroom",
    { p_profile: args.beneficiaryProfileId }
  );
  if (headroomError) {
    return { ok: false, error: "Could not check top-up limits — try again shortly." };
  }
  if (headroomKobo !== null && args.creditKobo > headroomKobo) {
    const headroomNaira = (headroomKobo / 100).toLocaleString();
    return {
      ok: false,
      error:
        headroomKobo <= 0
          ? "This wallet has reached its top-up limit. Verify identity in Settings to raise the limit, or contact support."
          : `This top-up would exceed the wallet's current limit — up to ₦${headroomNaira} is available right now. Verify identity in Settings to raise the limit.`,
    };
  }

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
        error: `${args.payerCurrency} top-ups aren't set up yet — top up in NGN for now.`,
      };
    }
    chargeAmountMinor = Math.round(args.creditKobo / rate);
  }

  const metadata: CheckoutMetadata = {
    kind: "wallet_topup",
    profile_id: args.beneficiaryProfileId,
    item_code: "wallet_topup",
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

  const { error: insertError } = await supabase.from("wallet_topups").insert({
    organisation_id: wallet.organisation_id,
    wallet_id: walletId,
    payer_profile_id: user.id,
    amount_minor: chargeAmountMinor,
    currency: args.payerCurrency,
    credit_kobo: args.creditKobo,
    provider,
    pending_provider_ref: reference,
    status: "pending",
  });
  if (insertError) return { ok: false, error: insertError.message };

  return { ok: true, checkoutUrl };
}
