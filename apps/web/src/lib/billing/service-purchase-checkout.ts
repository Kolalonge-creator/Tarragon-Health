import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeOneOffTransaction } from "@/lib/paystack/transactions";
import type { CheckoutMetadata } from "@/lib/billing/checkout-metadata";
import type { Currency } from "@tarragon/shared";

export type ServicePurchaseCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/**
 * Starts payment for a pending service_purchases row (created beforehand via
 * the record_service_purchase_intent RPC). Structurally identical to
 * initiateBookingCheckout (apps/web/src/lib/billing/booking-checkout.ts) —
 * a one-off charge, no Paystack Plan object involved — but targets
 * service_purchases.pending_payment_provider_ref instead of a booking table.
 * Activation on payment success happens in
 * private.apply_service_purchase_payment (a DB trigger), not here — this
 * function only starts the charge and stamps the pending ref.
 *
 * NGN via Paystack only. Every active service_products row is NGN-priced
 * (Stripe/diaspora billing was removed 2026-09-03 — there was never a
 * registered Stripe account behind it), so a non-NGN purchase intent has
 * nowhere left to go and fails closed here rather than silently.
 */
export async function initiateServicePurchaseCheckout(args: {
  servicePurchaseId: string;
  serviceProductCode: string;
  organisationId: string;
  patientId: string;
  amountKobo: number;
  currency: Currency;
  email: string;
  description: string;
  callbackUrl: string;
}): Promise<ServicePurchaseCheckoutResult> {
  if (args.currency !== "NGN") {
    return { ok: false, error: "This can only be paid in naira right now." };
  }
  if (!isPaystackConfigured()) {
    return { ok: false, error: "Card payments aren't set up yet" };
  }

  const serviceRole = createServiceRoleClient();
  const metadata: CheckoutMetadata = {
    kind: "service_purchase",
    profile_id: args.patientId,
    item_code: args.serviceProductCode,
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
    .from("service_purchases")
    .update({ pending_payment_provider_ref: result.data.reference })
    .eq("id", args.servicePurchaseId);
  if (error) return { ok: false, error: error.message };

  return { ok: true, checkoutUrl: result.data.authorizationUrl };
}
