"use server";

import { requireOwnedBookingOrder } from "@/lib/billing/booking-ownership";

/** The order types this specific action (and PromoCodeField) covers — NOT the
 * full set redeem_promo_code supports. It's scoped to requireOwnedBookingOrder's
 * single-row booking tables, so it excludes video_visit/lab_result_consult
 * (also in BookingOrderType, just not wired here). It also excludes
 * service_purchase: that redemption path doesn't need this action at all —
 * purchaseServiceProduct() (purchase-service-product.ts) calls
 * redeem_promo_code directly with p_order_type: "service_purchase", since
 * record_service_purchase_intent already does its own ownership check.
 * See supabase/migrations/20260830102521_promo_codes.sql and
 * 20260901174915_promo_codes_service_purchases.sql. */
export type PromoCodeOrderType = "lab" | "pharmacy" | "referral";

export type RedeemPromoCodeState = { error?: string; success?: string } | undefined;

/**
 * PayForLabOrderButton and its pharmacy/referral siblings render in more than
 * one page, so this deliberately does NOT revalidatePath (would need to know
 * every render site) — the client wrapper (PromoCodeField) calls
 * router.refresh() on success instead, which re-fetches whatever page is
 * actually showing.
 */
export async function redeemPromoCodeAction(
  orderType: PromoCodeOrderType,
  _prevState: RedeemPromoCodeState,
  formData: FormData,
): Promise<RedeemPromoCodeState> {
  const orderId = formData.get("orderId");
  const code = formData.get("code");
  if (typeof orderId !== "string" || !orderId) return { error: "Missing order" };
  if (typeof code !== "string" || !code.trim()) return { error: "Enter a code" };

  const { supabase } = await requireOwnedBookingOrder(orderType, orderId);

  const { data, error } = await supabase.rpc("redeem_promo_code", {
    p_code: code.trim(),
    p_order_type: orderType,
    p_order_id: orderId,
  });
  if (error) return { error: error.message };

  const discountKobo = (data as { discount_kobo?: number } | null)?.discount_kobo ?? 0;
  return { success: `Code applied — ₦${(discountKobo / 100).toLocaleString()} off.` };
}
