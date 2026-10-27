/**
 * The "days of medicine left" bar and the freshness of a pharmacy's stock answer (item 9).
 *
 * The days come from the existing supply engine (`estimateSupply`); nothing here recomputes them. No price is handled anywhere (OQ-714).
 * Mirrors the PROPOSED config `medicines.runway_and_stock_freshness`.
 */
export interface RunwayConfig {
  barFullDays: number;
  offerCollectBelowDays: number;
  /** At or under this many days the bar reads "low". Equals medicines.dose_rules lowSupplyDays (a test keeps them equal). */
  lowSupplyDays: number;
  maxStockAgeHours: number;
}

export const RUNWAY_CONFIG: RunwayConfig = { barFullDays: 30, offerCollectBelowDays: 14, lowSupplyDays: 7, maxStockAgeHours: 48 };

export interface RunwayBar {
  /** 0 to 1, how full the bar is. */
  fraction: number;
  tone: "ok" | "soon" | "low";
  daysLeft: number;
  /** Show the one-tap "choose where to collect". */
  offerCollect: boolean;
}

/** Unknown days (or a supply that covers the whole course) shows no bar: a missing number is never drawn as empty. */
export function runwayBar(daysLeft: number | null, cfg: RunwayConfig = RUNWAY_CONFIG): RunwayBar | null {
  if (daysLeft === null || !Number.isFinite(daysLeft) || daysLeft < 0) return null;
  const days = Math.floor(daysLeft);
  return {
    fraction: Math.min(1, days / cfg.barFullDays),
    tone: days <= cfg.lowSupplyDays ? "low" : days <= cfg.offerCollectBelowDays ? "soon" : "ok",
    daysLeft: days,
    offerCollect: days <= cfg.offerCollectBelowDays,
  };
}

export type StockLine =
  | { kind: "unknown" }
  | { kind: "confirmed"; asOfMs: number }
  /** Older than the limit, or stamped in the future: never shown as available. */
  | { kind: "ask_pharmacy"; asOfMs: number };

export function stockLine(confirmedAtMs: number | null, nowMs: number, cfg: RunwayConfig = RUNWAY_CONFIG): StockLine {
  if (confirmedAtMs === null || !Number.isFinite(confirmedAtMs)) return { kind: "unknown" };
  const ageMs = nowMs - confirmedAtMs;
  if (ageMs < 0 || ageMs > cfg.maxStockAgeHours * 3_600_000) return { kind: "ask_pharmacy", asOfMs: confirmedAtMs };
  return { kind: "confirmed", asOfMs: confirmedAtMs };
}
