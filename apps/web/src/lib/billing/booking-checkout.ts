import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeOneOffTransaction } from "@/lib/paystack/transactions";
import { bookingTableFor } from "@/lib/billing/booking-ownership";
import type { BookingOrderType, CheckoutMetadata } from "@/lib/billing/checkout-metadata";
import type { Currency } from "@tarragon/shared";

export type BookingCheckoutResult =
  | { ok: true; checkoutUrl: string }
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
 *
 * NGN via Paystack only. Stripe/diaspora billing was removed 2026-09-03 —
 * there was never a registered Stripe account behind it (needs a UK business
 * registration that hasn't happened), so no non-NGN order could ever
 * actually be charged. `currency` stays on the signature because every
 * caller still passes one and because a booking's own amountKobo/currency
 * pair is meaningful independent of how it gets paid, but this function now
 * fails closed on anything other than NGN rather than routing it nowhere.
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
  if (args.currency !== "NGN") {
    return { ok: false, error: "This can only be paid in naira right now." };
  }
  if (!isPaystackConfigured()) {
    return { ok: false, error: "Card payments aren't set up yet" };
  }

  const table = bookingTableFor(args.orderType);
  const serviceRole = createServiceRoleClient();

  // There is no longer a payment bypass here. Until 2026-07-29 a member of a
  // capitated organisation had their order flipped straight to
  // payment_confirmed on the grounds that the HMO's per-member fee covered it;
  // capitation is gone (I8), so every order takes the ordinary provider
  // checkout and produces a real payment_transactions row.
  const metadata: CheckoutMetadata = {
    kind: "booking",
    profile_id: args.patientId,
    item_code: args.orderType,
    booking_order_id: args.orderId,
    booking_order_type: args.orderType,
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
    .from(table)
    .update({ status: "pending_payment", pending_payment_provider_ref: result.data.reference })
    .eq("id", args.orderId);
  if (error) return { ok: false, error: error.message };

  return { ok: true, checkoutUrl: result.data.authorizationUrl };
}
