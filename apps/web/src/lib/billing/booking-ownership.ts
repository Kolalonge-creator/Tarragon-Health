import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { BookingOrderType } from "@/lib/billing/checkout-metadata";

const BOOKING_TABLE: Record<BookingOrderType, "lab_orders" | "pharmacy_orders" | "specialist_referrals"> = {
  lab: "lab_orders",
  pharmacy: "pharmacy_orders",
  referral: "specialist_referrals",
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
