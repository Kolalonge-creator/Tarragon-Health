import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeOneOffTransaction } from "@/lib/paystack/transactions";
import { isStripeConfigured } from "@/lib/stripe/client";
import { createOneOffCheckoutSession } from "@/lib/stripe/checkout";
import { resolveProvider } from "@/lib/billing/provider";
import { bookingTableFor } from "@/lib/billing/booking-ownership";
import type { BookingOrderType, CheckoutMetadata } from "@/lib/billing/checkout-metadata";
import type { Currency } from "@tarragon/shared";

export type BookingCheckoutResult =
  | { ok: true; capitated: true }
  | { ok: true; capitated: false; checkoutUrl: string }
  | { ok: false; error: string };

/**
 * Starts (or bypasses) payment for a lab/pharmacy/specialist-referral order.
 * Ownership must already be verified by the caller via
 * requireOwnedBookingOrder() before this is called — this function assumes
 * organisationId/orderId are trusted.
 *
 * Payment gates logistics (sample collection, delivery, appointment slot),
 * never the clinical action itself — a clinically-triggered order never
 * reaches this function with origin='patient_initiated' semantics; it's
 * created already actionable and this path is skipped entirely by callers.
 */
export async function initiateBookingCheckout(args: {
  orderType: BookingOrderType;
  orderId: string;
  organisationId: string;
  patientId: string;
  amountKobo: number;
  currency: Currency;
  email: string;
  description: string;
  callbackUrl: string;
}): Promise<BookingCheckoutResult> {
  const table = bookingTableFor(args.orderType);
  const serviceRole = createServiceRoleClient();

  // Capitated org members pay nothing at point of service — the contract
  // between TarragonHealth and the HMO/corporate client covers it, per
  // outcomes_contracts.contract_type='capitation'. No payment_transactions
  // row is ever written for this path; there is no payment event to record.
  const { data: capitationContract } = await serviceRole
    .from("outcomes_contracts")
    .select("id")
    .eq("organisation_id", args.organisationId)
    .eq("contract_type", "capitation")
    .lte("effective_from", new Date().toISOString().slice(0, 10))
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (capitationContract) {
    const { error } = await serviceRole
      .from(table)
      .update({ status: "payment_confirmed", origin: "capitated" })
      .eq("id", args.orderId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, capitated: true };
  }

  const provider = resolveProvider(args.currency);
  const metadata: CheckoutMetadata = {
    kind: "booking",
    profile_id: args.patientId,
    item_code: args.orderType,
    booking_order_id: args.orderId,
    booking_order_type: args.orderType,
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
      .from(table)
      .update({ status: "pending_payment", pending_payment_provider_ref: result.data.reference })
      .eq("id", args.orderId);
    if (error) return { ok: false, error: error.message };

    return { ok: true, capitated: false, checkoutUrl: result.data.authorizationUrl };
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
    .from(table)
    .update({ status: "pending_payment", pending_payment_provider_ref: result.data.sessionId })
    .eq("id", args.orderId);
  if (error) return { ok: false, error: error.message };

  return { ok: true, capitated: false, checkoutUrl: result.data.checkoutUrl };
}
