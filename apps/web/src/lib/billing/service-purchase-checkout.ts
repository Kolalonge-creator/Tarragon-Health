import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeOneOffTransaction } from "@/lib/paystack/transactions";
import { isStripeConfigured } from "@/lib/stripe/client";
import { createOneOffCheckoutSession } from "@/lib/stripe/checkout";
import { resolveProvider } from "@/lib/billing/provider";
import type { CheckoutMetadata } from "@/lib/billing/checkout-metadata";
import type { Currency } from "@tarragon/shared";

export type ServicePurchaseCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/**
 * Starts payment for a pending service_purchases row (created beforehand via
 * the record_service_purchase_intent RPC). Structurally identical to
 * initiateBookingCheckout (apps/web/src/lib/billing/booking-checkout.ts) —
 * a one-off charge, no Paystack Plan / Stripe recurring Price object
 * involved — but targets service_purchases.pending_payment_provider_ref
 * instead of a booking table. Activation on payment success happens in
 * private.apply_service_purchase_payment (a DB trigger), not here — this
 * function only starts the charge and stamps the pending ref.
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
  const serviceRole = createServiceRoleClient();
  const provider = resolveProvider(args.currency);
  const metadata: CheckoutMetadata = {
    kind: "service_purchase",
    profile_id: args.patientId,
    item_code: args.serviceProductCode,
  };

  if (provider === "paystack") {
    if (!isPaystackConfigured()) {
      return { ok: false, error: "Card payments aren't set up yet" };
    }
    if (args.currency !== "NGN") {
      return { ok: false, error: "Paystack only accepts NGN" };
    }
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

  if (!isStripeConfigured()) {
    return { ok: false, error: "Card payments aren't set up yet" };
  }
  if (args.currency === "NGN") {
    return { ok: false, error: "Stripe does not accept NGN" };
  }
  const result = await createOneOffCheckoutSession({
    email: args.email,
    amountMinor: args.amountKobo,
    currency: args.currency,
    description: args.description,
    successUrl: args.callbackUrl,
    cancelUrl: args.callbackUrl,
    metadata,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const { error } = await serviceRole
    .from("service_purchases")
    .update({ pending_payment_provider_ref: result.data.sessionId })
    .eq("id", args.servicePurchaseId);
  if (error) return { ok: false, error: error.message };

  return { ok: true, checkoutUrl: result.data.checkoutUrl };
}
