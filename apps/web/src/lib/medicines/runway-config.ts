import { getProposedConfig } from "@tarragon/shared";
import type { RunwayConfig } from "@tarragon/medicines";

/** The runway bar and stock-freshness limits from the versioned registry (medicines.runway_and_stock_freshness). A malformed entry fails loudly in a test, not on a page. */
export function loadRunwayConfig(asOf?: string): RunwayConfig {
  const v = getProposedConfig("medicines.runway_and_stock_freshness", asOf).value;
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("medicines.runway_and_stock_freshness must be an object");
  const num = (field: string, min: number): number => {
    const x = (v as Record<string, unknown>)[field];
    if (typeof x !== "number" || !Number.isFinite(x) || x < min) throw new Error(`medicines.runway_and_stock_freshness.${field} must be a number >= ${min}`);
    return x;
  };
  return { barFullDays: num("barFullDays", 1), offerCollectBelowDays: num("offerCollectBelowDays", 0), lowSupplyDays: num("lowSupplyDays", 1), maxStockAgeHours: num("maxStockAgeHours", 1) };
}
