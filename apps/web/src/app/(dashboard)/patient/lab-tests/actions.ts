"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOwnedBookingOrder } from "@/lib/billing/booking-ownership";
import { initiateBookingCheckout } from "@/lib/billing/booking-checkout";

export type PayForLabOrderState = { error?: string } | undefined;

/**
 * Patient-initiated payment for a booked lab order (status='pending_payment').
 * Mirrors payForReferral (apps/web/src/app/(dashboard)/patient/referrals/actions.ts)
 * exactly. Charges payable_kobo, not total_kobo — total_kobo is the catalogue
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

export type CreatePartnerLabOrderState = { error?: string } | undefined;

/**
 * Books a review Tarragon bills for directly (a partner laboratory is
 * contracted and switched on for the patient's state — see ReviewPrice /
 * region_service_available) and takes the patient straight to checkout in
 * one step, the same "create, then redirect to hosted checkout" shape as
 * requestVideoVisit (apps/web/src/app/(dashboard)/patient/video-visit-actions.ts).
 *
 * The insert runs on the caller's own authenticated Supabase client, not a
 * service-role one — the same RLS a direct client-side insert would use
 * (lab_orders_insert: patient_id = auth.uid()), so this grants no more than
 * the patient already has. What actually prices the order and decides
 * whether it can be billed at all is server-side and non-negotiable either
 * way: private.set_lab_order_computed_price (total_kobo, the Synlab cost
 * snapshot) and private.enforce_lab_order_not_below_cost run as BEFORE
 * INSERT triggers no client input reaches. organisation_id is read from the
 * patient's own profile rather than trusted from the form for the same
 * reason requestVideoVisit does it that way — the amount that ends up
 * charged must trace back to something the server looked up, not something
 * the client sent.
 *
 * A patient who leaves before the redirect completes (or a checkout-provider
 * failure) is left with a real pending_payment lab_orders row rather than a
 * lost one — PayForLabOrderButton, wired into the order's own card, picks
 * that back up without creating a duplicate order.
 *
 * providerId is optional and, when set, names which active laboratory to
 * book (from the §56.7 location-picker step — see useLabTestLocations).
 * Omitted, this falls back to whatever private.resolve_lab_order_provider's
 * single-active-laboratory fallback resolves to — unchanged behaviour for
 * the common case today (exactly one contracted lab), and no assumption
 * here about how many are active generally; the DB refuses to price the
 * order at all if the fallback is ambiguous, same as it always has.
 */
export async function createAndPayForPartnerLabOrder(
  _prevState: CreatePartnerLabOrderState,
  formData: FormData,
): Promise<CreatePartnerLabOrderState> {
  const panelBundleId = formData.get("panelBundleId");
  if (typeof panelBundleId !== "string" || !panelBundleId) {
    return { error: "Pick a review first" };
  }
  const providerIdRaw = formData.get("providerId");
  const providerId = typeof providerIdRaw === "string" && providerIdRaw ? providerIdRaw : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!user.email) {
    return { error: "Your account needs an email on file to check out." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return { error: "Your account has no organisation on file." };
  }

  const { data: order, error: insertError } = await supabase
    .from("lab_orders")
    .insert({
      organisation_id: profile.organisation_id,
      patient_id: user.id,
      panel_bundle_id: panelBundleId,
      fulfilment: "partner",
      status: "pending_payment",
      ...(providerId ? { provider_id: providerId } : {}),
    })
    .select("id, payable_kobo, total_kobo, panel_bundle:panel_bundles!lab_orders_panel_bundle_id_fkey(name)")
    .single();
  if (insertError || !order) {
    return { error: "We couldn't set that review up just now. Please try again." };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initiateBookingCheckout({
    orderType: "lab",
    orderId: order.id,
    organisationId: profile.organisation_id,
    patientId: user.id,
    amountKobo: order.payable_kobo ?? order.total_kobo,
    currency: "NGN",
    email: user.email,
    description: order.panel_bundle?.name ?? "Lab review",
    callbackUrl: `${origin}/patient`,
  });

  if (!result.ok) {
    return { error: result.error };
  }
  redirect(result.checkoutUrl);
}
