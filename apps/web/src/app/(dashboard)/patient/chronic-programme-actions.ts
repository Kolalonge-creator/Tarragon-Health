"use server";

import { redirect } from "next/navigation";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";

export type BuyProgrammeAddonState = { error?: string; message?: string } | undefined;

/**
 * Buys entry to the doctor-supported track for one specific chronic-programme
 * enrolment — same checkout path as any other service_products purchase
 * (see purchase-service-product.ts), scoped to this enrolment via
 * scopedEntityType/scopedEntityId so it's unambiguous which 12-week window
 * it covers.
 *
 * Sells continuous_monitoring_3m (₦7,500 / 90 days), not the old
 * chronic_doctor_supported_pack — that flat bundle was retired 2026-09-10
 * and unbundled; the chronic_doctor_supported_track feature (what actually
 * flips an enrolment's track) now lives on the continuous_monitoring_*
 * products instead. private.activate_chronic_programme_doctor_supported_track
 * upgrades the scoped enrolment the moment this purchase activates (checked
 * generically by feature grant, not by product code — see the
 * fix_stale_chronic_doctor_supported_track_activation_check migration), for
 * both a brand-new enrolment and one already mid-programme.
 */
export async function buyProgrammeDoctorSupportedAddon(
  enrolmentId: string,
  _prevState: BuyProgrammeAddonState,
  _formData: FormData
): Promise<BuyProgrammeAddonState> {
  const result = await purchaseServiceProduct({
    serviceProductCode: "continuous_monitoring_3m",
    scopedEntityType: "chronic_programme_enrolments",
    scopedEntityId: enrolmentId,
    callbackPath: "/patient/subscription/checkout-callback",
  });

  if (result?.error) return { error: result.error };
  if (result?.activated) return { message: "Added. Your doctor-supported calls are set up now." };
  if (result?.checkoutUrl) {
    redirect(result.checkoutUrl);
  }
  return { error: "Could not start checkout" };
}
