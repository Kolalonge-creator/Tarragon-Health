"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireOwnedBookingOrder } from "@/lib/billing/booking-ownership";
import { initiateBookingCheckout } from "@/lib/billing/booking-checkout";

export type PayForLabOrderState = { error?: string } | undefined;

/**
 * Patient-initiated payment for a booked lab order (status='pending_payment').
 * Mirrors payForReferral (apps/web/src/app/(dashboard)/patient/referrals/actions.ts)
 * exactly — a capitated order never reaches this state (Build 1's
 * capitated bypass applies uniformly to every orderType).
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
    .select("total_kobo, panel_bundle:panel_bundles!lab_orders_panel_bundle_id_fkey(name)")
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
    amountKobo: labOrder.total_kobo,
    currency: "NGN",
    email: user.email,
    description: labOrder.panel_bundle?.name ?? "Lab test",
    callbackUrl: `${origin}/patient`,
  });

  if (!result.ok) {
    return { error: result.error };
  }
  if (result.capitated) {
    redirect("/patient");
  }
  redirect(result.checkoutUrl);
}
