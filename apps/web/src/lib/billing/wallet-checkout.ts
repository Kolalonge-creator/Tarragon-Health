import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeOneOffTransaction } from "@/lib/paystack/transactions";
import { isStripeConfigured } from "@/lib/stripe/client";
import { createOneOffCheckoutSession } from "@/lib/stripe/checkout";
import type { Currency } from "@tarragon/shared";
import type { CheckoutMetadata } from "@/lib/billing/checkout-metadata";

export type WalletTopupResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/**
 * Starts payment for a Health Wallet top-up (own wallet or a sponsored
 * family member's — authorization is enforced by wallet_topups' INSERT RLS
 * via private.can_fund_wallet, which is why the pending row is inserted with
 * the CALLER'S client, not service-role).
 *
 * The charge carries metadata {kind:'wallet_topup'} — a kind the deployed
 * payment webhooks don't branch on. They still record the verified event in
 * payment_transactions, and the DB trigger
 * private.credit_wallet_from_payment_transaction (migration 20260723193547)
 * matches pending_provider_ref and credits the wallet. No Edge Function is
 * involved beyond the existing signature-verified recording.
 *
 * Diaspora FX: the sponsor chooses the NGN credit; the GBP/USD charge is
 * priced from admin-set platform_currency_settings.ngn_per_gbp/ngn_per_usd.
 * NULL rate → that currency's top-ups are unavailable (inactive-until-
 * configured convention). credit_kobo is locked on the row at initiate time.
 */
export async function initiateWalletTopup(args: {
  /** RLS-scoped client of the paying user (NOT service role — see above). */
  supabase: Parameters<typeof insertTopup>[0];
  walletId: string;
  organisationId: string;
  payerProfileId: string;
  creditKobo: number;
  currency: Currency;
  email: string;
  callbackUrl: string;
}): Promise<WalletTopupResult> {
  if (!Number.isInteger(args.creditKobo) || args.creditKobo < 50000) {
    return { ok: false, error: "Minimum top-up is ₦500." };
  }

  let amountMinor = args.creditKobo;
  if (args.currency !== "NGN") {
    const serviceRole = createServiceRoleClient();
    const { data: fx } = await serviceRole
      .from("platform_currency_settings")
      .select("ngn_per_gbp, ngn_per_usd")
      .maybeSingle();
    const rate = args.currency === "GBP" ? fx?.ngn_per_gbp : fx?.ngn_per_usd;
    if (!rate || rate <= 0) {
      return {
        ok: false,
        error: "Top-ups in this currency aren't available yet — try NGN, or check back soon.",
      };
    }
    // kobo -> naira -> foreign minor units, rounded up so the platform never
    // undercharges; the credited amount stays exactly what was chosen.
    amountMinor = Math.ceil(args.creditKobo / 100 / Number(rate)) * 100;
    if (amountMinor < 100) amountMinor = 100;
  }

  const metadata: CheckoutMetadata = {
    kind: "wallet_topup",
    profile_id: args.payerProfileId,
    item_code: "wallet_topup",
    wallet_id: args.walletId,
  };

  let reference: string;
  let checkoutUrl: string;

  if (args.currency === "NGN") {
    if (!isPaystackConfigured()) return { ok: false, error: "Card payments aren't set up yet" };
    const result = await initializeOneOffTransaction({
      email: args.email,
      amountMinor,
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
      amountMinor,
      currency: args.currency,
      description: "Tarragon Health Wallet top-up",
      successUrl: args.callbackUrl,
      cancelUrl: args.callbackUrl,
      metadata,
    });
    if (!result.ok) return { ok: false, error: result.error };
    reference = result.data.sessionId;
    checkoutUrl = result.data.checkoutUrl;
  }

  const inserted = await insertTopup(args.supabase, {
    organisation_id: args.organisationId,
    wallet_id: args.walletId,
    payer_profile_id: args.payerProfileId,
    amount_minor: amountMinor,
    currency: args.currency,
    credit_kobo: args.creditKobo,
    provider: args.currency === "NGN" ? "paystack" : "stripe",
    pending_provider_ref: reference,
  });
  if (!inserted.ok) return inserted;

  return { ok: true, checkoutUrl };
}

async function insertTopup(
  supabase: import("@supabase/supabase-js").SupabaseClient<import("@tarragon/shared").Database>,
  row: {
    organisation_id: string;
    wallet_id: string;
    payer_profile_id: string;
    amount_minor: number;
    currency: string;
    credit_kobo: number;
    provider: "paystack" | "stripe";
    pending_provider_ref: string;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("wallet_topups").insert(row);
  if (error) {
    // RLS rejection here means the payer isn't authorised to fund this wallet.
    return { ok: false, error: "You're not authorised to top up this wallet." };
  }
  return { ok: true };
}
