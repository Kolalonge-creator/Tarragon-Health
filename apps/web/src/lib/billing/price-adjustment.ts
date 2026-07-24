import type { Currency } from "@tarragon/shared";

/**
 * Bulk price adjustment (the annual inflation-review tool). Pure computation
 * only — the admin server actions own all DB access. Kept separate so the
 * rounding and skip rules are unit-testable.
 *
 * Business rules encoded here:
 * - Existing subscribers are never touched: any row that is price-locked OR
 *   has an active/trialing subscriber is reported for the clone-as-new-plan
 *   flow instead of being adjusted (matches the marketing promise that a
 *   price you've already paid is honoured until renewal).
 * - Free rows (price 0) are never adjusted.
 * - Adjusted prices round to a clean retail step: nearest ₦500 for NGN,
 *   nearest whole £/$ for GBP/USD — a 10% inflation pass should produce
 *   prices a human would have chosen, not ₦8,800.
 */

/** Rounding step in minor units (kobo/pence/cents) per currency. */
const ROUNDING_STEP_MINOR: Record<Currency, number> = {
  NGN: 50_000, // ₦500
  GBP: 100, // £1
  USD: 100, // $1
};

export function computeAdjustedPriceMinor(
  priceMinor: number,
  percent: number,
  currency: Currency,
): number {
  const step = ROUNDING_STEP_MINOR[currency];
  const raw = priceMinor * (1 + percent / 100);
  const rounded = Math.round(raw / step) * step;
  // A positive price must never round down to zero (e.g. -49% on a tiny
  // add-on) — clamp to one rounding step.
  return rounded <= 0 ? step : rounded;
}

export type AdjustableRow = {
  id: string;
  code: string;
  name: string;
  currency: Currency;
  price_minor: number;
  price_locked: boolean;
  is_active: boolean;
  /** Live count of active/trialing subscriptions referencing this row. */
  active_subscriber_count: number;
};

export type AdjustmentStatus =
  | "adjust" // will be updated (and re-synced if active)
  | "locked" // has subscribers or a price lock — needs the clone flow
  | "free" // price 0, never adjusted
  | "inactive_skipped" // inactive and includeInactive was off
  | "unchanged"; // rounding produced the same price

export type AdjustmentPlanRow = {
  id: string;
  code: string;
  name: string;
  currency: Currency;
  oldMinor: number;
  newMinor: number;
  status: AdjustmentStatus;
};

export function planPriceAdjustment(
  rows: AdjustableRow[],
  options: { percent: number; includeInactive: boolean },
): AdjustmentPlanRow[] {
  return rows.map((row) => {
    const base = {
      id: row.id,
      code: row.code,
      name: row.name,
      currency: row.currency,
      oldMinor: row.price_minor,
    };
    if (row.price_minor === 0) {
      return { ...base, newMinor: 0, status: "free" as const };
    }
    if (!row.is_active && !options.includeInactive) {
      return { ...base, newMinor: row.price_minor, status: "inactive_skipped" as const };
    }
    if (row.price_locked || row.active_subscriber_count > 0) {
      return { ...base, newMinor: row.price_minor, status: "locked" as const };
    }
    const newMinor = computeAdjustedPriceMinor(row.price_minor, options.percent, row.currency);
    if (newMinor === row.price_minor) {
      return { ...base, newMinor, status: "unchanged" as const };
    }
    return { ...base, newMinor, status: "adjust" as const };
  });
}
