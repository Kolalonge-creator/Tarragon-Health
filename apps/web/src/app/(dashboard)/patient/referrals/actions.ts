"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireOwnedBookingOrder } from "@/lib/billing/booking-ownership";
import { initiateBookingCheckout } from "@/lib/billing/booking-checkout";

export type PayForReferralState = { error?: string } | undefined;

/**
 * Patient-initiated payment for a specialist referral that's been assigned a
 * provider (status='pending_payment'). A capitated referral never reaches
 * this state — useAssignSpecialistProvider() confirms it straight to
 * payment_confirmed at assignment time — so this action's own call into
 * initiateBookingCheckout only ever exercises the non-capitated branch in
 * practice.
 */
export async function payForReferral(
  _prevState: PayForReferralState,
  formData: FormData,
): Promise<PayForReferralState> {
  const referralId = formData.get("referralId");
  if (typeof referralId !== "string" || !referralId) {
    return { error: "Missing referral" };
  }

  const { supabase, user, order } = await requireOwnedBookingOrder("referral", referralId);
  if (order.status !== "pending_payment") {
    return { error: "This referral isn't ready for payment." };
  }
  if (!user.email) {
    return { error: "Your account needs an email on file to check out." };
  }

  const { data: referral } = await supabase
    .from("specialist_referrals")
    .select("referral_fee_kobo, specialist_type")
    .eq("id", referralId)
    .single();
  if (!referral?.referral_fee_kobo) {
    return { error: "This referral has no fee set yet — contact your care team." };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initiateBookingCheckout({
    orderType: "referral",
    orderId: referralId,
    organisationId: order.organisation_id,
    patientId: order.patient_id,
    amountKobo: referral.referral_fee_kobo,
    currency: "NGN",
    email: user.email,
    description: `Specialist referral (${referral.specialist_type})`,
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
