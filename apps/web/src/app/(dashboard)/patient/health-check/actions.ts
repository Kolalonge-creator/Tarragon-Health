"use server";

import { redirect } from "next/navigation";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";

export type BuyPreventiveHealthCheckReviewState = { error?: string; message?: string } | undefined;

/**
 * Buys the Preventive Health Check Review SKU (see
 * 20260922185300_preventive_health_check_review_sku.sql) — same generic
 * checkout path every other one-off service_products purchase uses, no
 * scoping needed since it always applies to the caller's own current-year
 * Health Check. private.request_preventive_health_check_review (a
 * service_purchases trigger) opens/finds this year's annual_health_checks
 * row and stamps review_requested_at the moment the purchase activates —
 * this action only starts checkout.
 *
 * The product ships is_active = false pending a Clinical Director signature
 * on risk_questionnaire_configs (code = 'prevention_intake') — see that
 * migration's header. Until then, purchaseServiceProduct's own
 * record_service_purchase_intent call refuses with "service product ... is
 * not available", which this action surfaces as-is; the patient-facing page
 * (page.tsx) additionally hides the buy button behind that same
 * `is_active` check so a patient never sees an offer they can't complete.
 */
export async function buyPreventiveHealthCheckReview(
  _prevState: BuyPreventiveHealthCheckReviewState,
  _formData: FormData
): Promise<BuyPreventiveHealthCheckReviewState> {
  const result = await purchaseServiceProduct({
    serviceProductCode: "preventive_health_check_review",
    callbackPath: "/patient/health-check",
  });

  if (result?.error) return { error: result.error };
  if (result?.activated) return { message: "Requested. A doctor on your care team will review your check." };
  if (result?.checkoutUrl) {
    redirect(result.checkoutUrl);
  }
  return { error: "Could not start checkout" };
}
