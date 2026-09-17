import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeOneOffTransaction } from "@/lib/paystack/transactions";
import type { CheckoutMetadata } from "@/lib/billing/checkout-metadata";

export type PlatformCreditTopupCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/**
 * Starts payment for a pending platform_credit_topup_intents row (created
 * beforehand via the record_platform_credit_topup_intent RPC). Structurally
 * identical to initiateServicePurchaseCheckout — a one-off charge, no
 * Paystack Plan object — but targets
 * platform_credit_topup_intents.pending_payment_provider_ref instead of a
 * service_purchases row. Crediting the balance on success happens in
 * private.apply_platform_credit_topup_payment (a DB trigger), not here.
 *
 * NGN via Paystack only — same reasoning as every other checkout in this
 * codebase since the 2026-09-03 Stripe removal.
 */
export async function initiatePlatformCreditTopupCheckout(args: {
  topupIntentId: string;
  organisationId: string;
  patientId: string;
  amountKobo: number;
  email: string;
  callbackUrl: string;
}): Promise<PlatformCreditTopupCheckoutResult> {
  if (!isPaystackConfigured()) {
    return { ok: false, error: "Card payments aren't set up yet" };
  }

  const serviceRole = createServiceRoleClient();
  const metadata: CheckoutMetadata = {
    kind: "platform_credit_topup",
    profile_id: args.patientId,
    item_code: "platform_credit_topup",
  };

  const result = await initializeOneOffTransaction({
    email: args.email,
    amountMinor: args.amountKobo,
    currency: "NGN",
    callbackUrl: args.callbackUrl,
    metadata,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const { error } = await serviceRole
    .from("platform_credit_topup_intents")
    .update({ pending_payment_provider_ref: result.data.reference })
    .eq("id", args.topupIntentId);
  if (error) return { ok: false, error: error.message };

  return { ok: true, checkoutUrl: result.data.authorizationUrl };
}
