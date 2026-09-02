"use server";

import { redirect } from "next/navigation";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";

export type SubscriptionActionState = { error?: string; message?: string } | undefined;

/**
 * Buys any service_products row for the signed-in patient — the base tier
 * packs (prevent_pack/essential_pack/etc, previously "change plan") and any
 * other service (previously an "add-on") are the same purchase now, since
 * pay-per-service has no plan-vs-add-on distinction: features union across
 * every currently active service_purchases row (see
 * public.has_feature_access). A free product activates immediately with no
 * checkout redirect; a paid one redirects to the provider's hosted checkout.
 */
export async function buyServiceProduct(
  _prevState: SubscriptionActionState,
  formData: FormData,
): Promise<SubscriptionActionState> {
  const serviceProductCode = formData.get("serviceProductCode");
  if (typeof serviceProductCode !== "string" || !serviceProductCode) {
    return { error: "Choose a service first" };
  }
  const promoCodeRaw = formData.get("promoCode");
  const promoCode = typeof promoCodeRaw === "string" && promoCodeRaw.trim() ? promoCodeRaw.trim() : undefined;

  const result = await purchaseServiceProduct({
    serviceProductCode,
    promoCode,
    callbackPath: "/patient/subscription/checkout-callback",
  });

  if (result?.error) return { error: result.error };
  if (result?.activated) return { message: "Added — this is active now." };
  if (result?.checkoutUrl) redirect(result.checkoutUrl);
  return { error: "Could not start checkout" };
}
