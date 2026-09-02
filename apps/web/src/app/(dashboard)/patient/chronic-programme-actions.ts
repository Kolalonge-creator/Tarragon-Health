"use server";

import { redirect } from "next/navigation";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";

export type BuyProgrammeAddonState = { error?: string; message?: string } | undefined;

/**
 * Buys the 12-week doctor-supported add-on for one specific chronic-programme
 * enrolment — same checkout path as any other service_products purchase
 * (see purchase-service-product.ts), scoped to this enrolment via
 * scopedEntityType/scopedEntityId so it's unambiguous which 12-week window
 * it covers. private.derive_chronic_programme_track picks this up
 * automatically the next time the enrolment transitions into 'enrolled'
 * (re-enrolling), or immediately for a brand-new enrolment created after
 * the purchase activates.
 */
export async function buyProgrammeDoctorSupportedAddon(
  enrolmentId: string,
  _prevState: BuyProgrammeAddonState,
  _formData: FormData
): Promise<BuyProgrammeAddonState> {
  const result = await purchaseServiceProduct({
    serviceProductCode: "chronic_doctor_supported_pack",
    scopedEntityType: "chronic_programme_enrolments",
    scopedEntityId: enrolmentId,
    callbackPath: "/patient/subscription/checkout-callback",
  });

  if (result?.error) return { error: result.error };
  if (result?.activated) return { message: "Added — your doctor-supported calls are set up now." };
  if (result?.checkoutUrl) {
    redirect(result.checkoutUrl);
  }
  return { error: "Could not start checkout" };
}
