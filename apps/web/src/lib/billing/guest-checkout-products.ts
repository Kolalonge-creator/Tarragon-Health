import { PAID_SERVICES, WEIGHT_MANAGEMENT } from "@/app/(marketing)/_content/pricing";

/**
 * Which service_products codes can be bought without an existing account.
 *
 * Deliberately a curated subset of everything in PAID_SERVICES/
 * WEIGHT_MANAGEMENT, not "every active service_products row" — guest
 * checkout provisions a brand-new profile on the spot
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
  "continuous_monitoring_3m",
  "continuous_monitoring_6m",
  "continuous_monitoring_12m",
  "written_result_interpretation",
  "result_interpretation_credit",
  "async_consult_credit",
  "second_opinion_credit",
  "video_visit_credit",
  "weight_management_3m",
  "weight_management_6m",
  "weight_management_12m",
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
 * pricing page reads — PAID_SERVICES for everything except Supervised Weight
 * Management, which is kept as its own object (see pricing.ts's comment on
 * WEIGHT_MANAGEMENT) because it carries a mandatory medical disclosure the
 * other products don't.
 */
export function guestCheckoutProductCopy(
  code: GuestCheckoutProductCode
): GuestCheckoutProductCopy | null {
  if (code.startsWith("weight_management_")) {
    const term = WEIGHT_MANAGEMENT.terms.find((t) => t.code === code);
    if (!term) return null;
    return {
      code,
      name: WEIGHT_MANAGEMENT.name,
      staticPrice: term.price,
      priceCaption: `for ${term.label.toLowerCase()}`,
      description: WEIGHT_MANAGEMENT.description,
      disclosure: WEIGHT_MANAGEMENT.disclosure,
      terms: WEIGHT_MANAGEMENT.terms,
    };
  }

  // Continuous Monitoring's 6/12-month terms share the 3-month entry's copy
  // and description — only the price/term label differ, held in `terms`.
  const parentCode = code.startsWith("continuous_monitoring_")
    ? "continuous_monitoring_3m"
    : code;
  const service = PAID_SERVICES.find((s) => s.code === parentCode);
  if (!service) return null;

  const term = service.terms?.find((t) => t.code === code);
  return {
    code,
    name: service.name,
    staticPrice: term?.price ?? service.price,
    priceCaption: term ? `for ${term.label.toLowerCase()}` : service.priceCaption,
    description: service.description,
    terms: service.terms,
  };
}
