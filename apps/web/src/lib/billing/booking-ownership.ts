import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { BookingOrderType } from "@/lib/billing/checkout-metadata";

const BOOKING_TABLE: Record<
  BookingOrderType,
  | "lab_orders"
  | "pharmacy_orders"
  | "specialist_referrals"
  | "video_visit_requests"
  | "results_interpretation_requests"
> = {
  lab: "lab_orders",
  pharmacy: "pharmacy_orders",
  referral: "specialist_referrals",
  video_visit: "video_visit_requests",
  // E3 Results Interpretation (Revenue Architecture and Earnings Plan,
  // 27 Aug 2026) — a ₦7,500 one-off purchase, no accept/decline step. The
  // credit is spent automatically by private.handle_lab_result_document()
  // the next time the patient uploads a result, not by anything reading this
  // table directly.
  results_interpretation: "results_interpretation_requests",
};

export function bookingTableFor(orderType: BookingOrderType) {
  return BOOKING_TABLE[orderType];
}

/**
 * Every booking-payment server action re-checks the caller owns the order
 * being paid for (patient_id = auth.uid()) as defense-in-depth on top of
 * RLS, before ever calling out to Paystack/Stripe — money-moving calls
 * don't get to lean on RLS alone. Mirrors requireOwnedSubscription() in
 * patient/subscription/actions.ts.
 */
export async function requireOwnedBookingOrder(orderType: BookingOrderType, orderId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const table = bookingTableFor(orderType);
  const { data: order } = await supabase
    .from(table)
    .select(
      "id, organisation_id, patient_id, status, origin, payment_provider, payment_provider_ref, pending_payment_provider_ref",
    )
    .eq("id", orderId)
    .eq("patient_id", user.id)
    .maybeSingle();

  if (!order) {
    throw new Error(`${orderType} order not found`);
  }
  return { supabase, user, order };
}
