/**
 * §6.8 — "Baseline BP 155/94, Current average 138/84, Change: Improving".
 * A schedule item's baseline_value (monitoring_schedule_items, set from the
 * patient's first reading or by a clinician — see the migration) compared
 * to a current average. Pure and non-diagnostic, same boundary as
 * lib/rules/longitudinal.ts: this states which direction is objectively
 * better for the metric's units, it never grades the patient's condition.
 */

import type { VitalsTrendMetric } from "@/lib/rules/vitals-trend";
import { VITALS_TREND_HIGHER_IS_WORSE } from "@/lib/rules/vitals-trend";

export type BaselineChange = "improving" | "worsening" | "unchanged";

/** Movement smaller than this, either way, reads as noise rather than a
 * real change from baseline. */
const UNCHANGED_BAND_PCT = 3;

export function compareToBaseline(
  metric: VitalsTrendMetric,
  baseline: number,
  currentAverage: number,
): { change: BaselineChange; percentChange: number } {
  const percentChange = baseline === 0 ? 0 : ((currentAverage - baseline) / Math.abs(baseline)) * 100;
  const rounded = Math.round(percentChange * 10) / 10;

  if (Math.abs(percentChange) < UNCHANGED_BAND_PCT) {
    return { change: "unchanged", percentChange: rounded };
  }

  const rising = currentAverage > baseline;
  const higherIsWorse = VITALS_TREND_HIGHER_IS_WORSE[metric];
  return { change: rising === higherIsWorse ? "worsening" : "improving", percentChange: rounded };
}
