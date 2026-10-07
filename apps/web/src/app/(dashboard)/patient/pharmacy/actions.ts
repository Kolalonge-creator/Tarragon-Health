"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireOwnedBookingOrder } from "@/lib/billing/booking-ownership";
import { initiateBookingCheckout } from "@/lib/billing/booking-checkout";

export type PayForPharmacyOrderState = { error?: string } | undefined;

/**
 * Patient-initiated payment for a booked pharmacy order (status='pending_payment').
 * Charges payable_kobo, not total_kobo — total_kobo is the catalogue
 * price before whatever the order carries in voucher_covered_kobo /
 * subscriber_discount_kobo; payable_kobo (a generated column) is what the
 * patient actually owes. Charging total_kobo would overcharge an order with
 * either applied.
 */
export async function payForPharmacyOrder(
  _prevState: PayForPharmacyOrderState,
  formData: FormData,
): Promise<PayForPharmacyOrderState> {
  const orderId = formData.get("orderId");
  if (typeof orderId !== "string" || !orderId) {
    return { error: "Missing order" };
  }

  const { supabase, user, order } = await requireOwnedBookingOrder("pharmacy", orderId);
  if (order.status !== "pending_payment") {
    return { error: "This order isn't ready for payment." };
  }
  if (!user.email) {
    return { error: "Your account needs an email on file to check out." };
  }

  const { data: pharmacyOrder } = await supabase
    .from("pharmacy_orders")
    .select("payable_kobo, total_kobo")
    .eq("id", orderId)
    .single();
  if (!pharmacyOrder) {
    return { error: "This order could not be found." };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initiateBookingCheckout({
    orderType: "pharmacy",
    orderId,
    organisationId: order.organisation_id,
    patientId: order.patient_id,
    amountKobo: pharmacyOrder.payable_kobo ?? pharmacyOrder.total_kobo,
    currency: "NGN",
    email: user.email,
    description: "Pharmacy order",
    callbackUrl: `${origin}/patient`,
  });

  if (!result.ok) {
    return { error: result.error };
  }
  redirect(result.checkoutUrl);
}
