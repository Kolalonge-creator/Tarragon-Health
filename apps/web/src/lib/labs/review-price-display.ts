import type { ReviewPrice } from "@/lib/queries/review-price";

/**
 * Decides what a patient should be told about the cost of a review.
 *
 * Pulled out of the component so the one rule that actually matters here is
 * testable in isolation: Tarragon must never quote a price for a review it is
 * not billing. Today that is every review — the patient takes the request to
 * a laboratory of their own choosing and pays them directly — so a bug that
 * let a number through would be inventing a charge that does not exist.
 *
 * The ordering of these branches is the safety property. "Is Tarragon billing
 * here at all" is answered first and cannot be reached past, so no amount of
 * price data arriving from anywhere can produce a `price` outcome in a state
 * where partner fulfilment is not live.
 */
export type ReviewPriceDisplay =
  /** Tarragon is not billing for tests here: say who the patient actually pays. */
  | { kind: "pay_the_lab" }
  | { kind: "loading" }
  /** Billing is live but there is no honest number yet — say so, promise nothing. */
  | { kind: "confirm_later" }
  | { kind: "price"; totalKobo: number; testCount: number };

export function reviewPriceDisplay(input: {
  partnerBillingAvailable: boolean | undefined;
  isLoading: boolean;
  price: ReviewPrice | null | undefined;
}): ReviewPriceDisplay {
  // Undefined (not yet known) is treated the same as false. A price must be
  // positively established as billable, never assumed while a check is still
  // in flight.
  if (!input.partnerBillingAvailable) {
    return { kind: "pay_the_lab" };
  }
  if (input.isLoading) {
    return { kind: "loading" };
  }

  const price = input.price;
  if (!price || !price.ok || !price.priceable) {
    return { kind: "confirm_later" };
  }
  // A zero or negative total is not a free review, it is a broken one.
  if (!Number.isFinite(price.total_kobo) || price.total_kobo <= 0) {
    return { kind: "confirm_later" };
  }

  return {
    kind: "price",
    totalKobo: price.total_kobo,
    testCount: Array.isArray(price.lines) ? price.lines.length : 0,
  };
}
