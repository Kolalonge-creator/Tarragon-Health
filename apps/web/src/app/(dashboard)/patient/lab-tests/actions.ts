"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireOwnedBookingOrder } from "@/lib/billing/booking-ownership";
import { initiateBookingCheckout } from "@/lib/billing/booking-checkout";

export type PayForLabOrderState = { error?: string } | undefined;

/**
 * Patient-initiated payment for a booked lab order (status='pending_payment').
 * Charges payable_kobo, not total_kobo — total_kobo is the catalogue
 * price before whatever the order carries in voucher_covered_kobo /
 * subscriber_discount_kobo; payable_kobo (a generated column) is what the
 * patient actually owes. Charging total_kobo would overcharge an order with
 * either applied.
 */
export async function payForLabOrder(
  _prevState: PayForLabOrderState,
  formData: FormData,
): Promise<PayForLabOrderState> {
  const orderId = formData.get("orderId");
  if (typeof orderId !== "string" || !orderId) {
    return { error: "Missing order" };
  }

  const { supabase, user, order } = await requireOwnedBookingOrder("lab", orderId);
  if (order.status !== "pending_payment") {
    return { error: "This order isn't ready for payment." };
  }
  if (!user.email) {
    return { error: "Your account needs an email on file to check out." };
  }

  const { data: labOrder } = await supabase
    .from("lab_orders")
    .select("payable_kobo, total_kobo, panel_bundle:panel_bundles!lab_orders_panel_bundle_id_fkey(name)")
    .eq("id", orderId)
    .single();
  if (!labOrder) {
    return { error: "This order could not be found." };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initiateBookingCheckout({
    orderType: "lab",
    orderId,
    organisationId: order.organisation_id,
    patientId: order.patient_id,
    amountKobo: labOrder.payable_kobo ?? labOrder.total_kobo,
    currency: "NGN",
    email: user.email,
    description: labOrder.panel_bundle?.name ?? "Lab test",
    callbackUrl: `${origin}/patient`,
  });

  if (!result.ok) {
    return { error: result.error };
  }
  redirect(result.checkoutUrl);
}

/* createAndPayForPartnerLabOrder (and its shared lib/billing/create-and-pay-
 * lab-order.ts, and the mobile wrapper at api/mobile/lab-orders/checkout)
 * are removed: every panel_bundles row is guidance_only as of migration
 * 20260910011846_catalogue_becomes_guidance_not_commerce.sql, and
 * private.enforce_guidance_only_is_never_billed refuses a partner-billed
 * (fulfilment='partner') lab_orders insert for any of them at the database
 * level — this action could no longer create a booking that wasn't a doomed
 * insert behind a generic error, and had no remaining UI caller (the AHC
 * booking page's own partner-billed branch was removed 2026-09-11, see
 * annual-health-check-booking.tsx). payForLabOrder above is untouched: it
 * only pays off an order already sitting at pending_payment, needed for the
 * one order created before this cutover. */
