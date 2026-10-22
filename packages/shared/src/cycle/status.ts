import type { CycleConfidence, CyclePrediction } from "./prediction";

/**
 * UI-A: the one plain-word status for the top of a cycle card, and the three-dot confidence scale. Pure, no strings: the screens turn
 * the result into words with `@tarragon/i18n` (`cycle.status.*`, `cycle.confidence.*`). Everything comes from the prediction the engine
 * already returned, so the status line can never disagree with the numbers beside it, and no certainty is invented: the dots are the
 * engine's own confidence level, nothing more.
 *
 * Tone never means "danger". A late period is amber ("worth a look"), never red: red is for the clinical flags and alerts only.
 */

export type CycleStatusKind = "no_history" | "overdue" | "today" | "any_day" | "in_days";
export type CycleStatusTone = "brand" | "amber" | "grey";
export type ConfidenceDots = 0 | 1 | 2 | 3;

export interface CycleStatus {
  kind: CycleStatusKind;
  /** Whole days to the expected period (kind "in_days") or past the estimate (kind "overdue"). Null otherwise. */
  days: number | null;
  tone: CycleStatusTone;
}

export function cycleStatus(prediction: CyclePrediction): CycleStatus {
  if (!prediction.predictedNextPeriodDate) return { kind: "no_history", days: null, tone: "grey" };
  if (prediction.isOverdue) {
    const days = prediction.daysOverdue !== null && prediction.daysOverdue > 0 ? prediction.daysOverdue : null;
    return { kind: "overdue", days, tone: "amber" };
  }
  const until = prediction.daysUntilNextPeriod;
  if (until === null || until < 0) return { kind: "any_day", days: null, tone: "brand" };
  if (until === 0) return { kind: "today", days: 0, tone: "brand" };
  return { kind: "in_days", days: until, tone: "brand" };
}

/** None 0 dots, low 1, medium 2, high 3. A reading of "none" never shows a filled dot. */
export function confidenceDots(confidence: CycleConfidence): ConfidenceDots {
  switch (confidence) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}
