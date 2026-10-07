/**
 * Checkout amounts (S25, spec 19.7, OQ-97). The order stores the PRICE in integer kobo (INV-15). With "pass transaction fees
 * to customers" on, Paystack adds its processing fee on top, so the patient pays price + fee. The fee is never part of the
 * price and never part of any earnings base. Paystack publishes no fee-preview call, so before payment the app shows an
 * ESTIMATE from versioned configuration (`commerce.processing_fee_estimate`) and says it is an estimate; the exact fee is
 * read from the verified payment and recorded on the order and the receipt.
 */
export interface FeeEstimateSchedule {
  /** Percentage in basis points (150 = 1.5 percent). */
  readonly localBasisPoints: number;
  /** A flat part, in kobo, added when the price is at or above `flatWaivedBelowKobo`. */
  readonly flatKobo: number;
  readonly flatWaivedBelowKobo: number;
  /** The most the fee can be, in kobo. */
  readonly capKobo: number;
}

export interface CheckoutBreakdown {
  readonly priceKobo: number;
  readonly feeKobo: number;
  readonly totalKobo: number;
  /** True while the fee is an estimate (before payment); false once read from a verified payment. */
  readonly estimated: boolean;
}

const isKobo = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** Estimated fee for a locally issued card or bank payment, rounded up to whole kobo. Never negative, never above the cap. */
export function estimateProcessingFeeKobo(priceKobo: number, schedule: FeeEstimateSchedule): number {
  if (!isKobo(priceKobo) || priceKobo === 0) return 0;
  const percent = Math.ceil((priceKobo * schedule.localBasisPoints) / 10_000);
  const flat = priceKobo >= schedule.flatWaivedBelowKobo ? schedule.flatKobo : 0;
  return Math.min(percent + flat, schedule.capKobo);
}

export function estimatedBreakdown(priceKobo: number, schedule: FeeEstimateSchedule): CheckoutBreakdown {
  const feeKobo = estimateProcessingFeeKobo(priceKobo, schedule);
  return { priceKobo, feeKobo, totalKobo: priceKobo + feeKobo, estimated: true };
}

/** The real figures, read from a paid order. Throws nothing: a missing fee is treated as unknown (null). */
export function recordedBreakdown(order: { amount_kobo: number; fee_kobo: number | null; total_kobo: number | null }): CheckoutBreakdown | null {
  if (order.fee_kobo === null || order.total_kobo === null) return null;
  if (!isKobo(order.fee_kobo) || order.total_kobo !== order.amount_kobo + order.fee_kobo) return null;
  return { priceKobo: order.amount_kobo, feeKobo: order.fee_kobo, totalKobo: order.total_kobo, estimated: false };
}

/** Formats integer kobo as naira for display only ("100,000" or "12,000.50"). No currency maths is done on the result. */
export function formatNaira(kobo: number): string {
  const naira = Math.trunc(kobo / 100);
  const rem = Math.abs(kobo % 100);
  const whole = naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return rem === 0 ? whole : `${whole}.${rem.toString().padStart(2, "0")}`;
}
