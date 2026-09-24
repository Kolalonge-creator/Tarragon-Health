import { PAID_SERVICES } from "@/app/(marketing)/_content/pricing";

/**
 * Which service_products codes can be bought without an existing account.
 *
 * Deliberately a curated subset of everything in PAID_SERVICES, not "every
 * active service_products row" — guest checkout provisions a brand-new
 * profile on the spot
 * (apps/web/src/lib/billing/guest-checkout.ts), so it only makes sense for a
 * product that stands on its own with no existing record, prescription or
 * programme history behind it. `prescription_renewal_credit` (needs an
 * existing prescription), `medication_review_credit` (needs an existing med
 * list) and `ai_coach_daily_pass_30d` (a top-up for something you already
 * use) are deliberately excluded for that reason — someone who needs those
 * is, by definition, already a patient and should use the normal in-app
 * purchase path instead.
 *
 * Re-validated server-side in guest-checkout.ts even though the buy page
 * itself only ever links to a code from this list — defence in depth against
 * a hand-crafted request for a code that was never meant to be guest-buyable.
 */
export const GUEST_CHECKOUT_PRODUCT_CODES = [
  "continuous_monitoring_90d",
  "written_result_interpretation",
  "result_interpretation_credit",
  "async_consult_credit",
  "second_opinion_credit",
  "video_visit_credit",
] as const;

export type GuestCheckoutProductCode = (typeof GUEST_CHECKOUT_PRODUCT_CODES)[number];

export function isGuestCheckoutProductCode(code: string): code is GuestCheckoutProductCode {
  return (GUEST_CHECKOUT_PRODUCT_CODES as readonly string[]).includes(code);
}

export type GuestCheckoutProductCopy = {
  code: GuestCheckoutProductCode;
  name: string;
  staticPrice: string;
  priceCaption?: string;
  description: string;
  disclosure?: string;
  /** Other terms of the same product, e.g. Continuous Monitoring's 3/6/12-month options. */
  terms?: readonly { code: string; label: string; price: string; perMonth: string }[];
};

/**
 * Resolves a guest-buyable code's marketing copy from the same source the
 * pricing page reads.
 */
export function guestCheckoutProductCopy(
  code: GuestCheckoutProductCode
): GuestCheckoutProductCopy | null {
  // Continuous Monitoring collapsed to a single 90-day code 2026-09-22 (see
  // 20260922185200_continuous_monitoring_90d_single_tier.sql) — no more
  // 3/6/12-month terms to special-case here, `code` matches a PAID_SERVICES
  // entry directly. No PAID_SERVICES entry carries a `terms` array anymore,
  // so this branch reads price/priceCaption straight off the product.
  const service = PAID_SERVICES.find((s) => s.code === code);
  if (!service) return null;

  return {
    code,
    name: service.name,
    staticPrice: service.price,
    priceCaption: service.priceCaption,
    description: service.description,
  };
}
