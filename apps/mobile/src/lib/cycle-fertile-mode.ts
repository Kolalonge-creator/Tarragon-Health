import { en } from "@tarragon/i18n";
import { PHASE_DESCRIPTION, PHASE_LABEL, type CyclePhase, type CyclePrediction } from "./cycle-prediction";

/**
 * S85 D2 / OQ-12 (founder decision, CMO wording unsigned), phone side. Mirrors
 * apps/web/src/lib/rules/cycle-fertile-mode.ts: the estimated ovulation date and the days around it are hidden by
 * default and shown only when the person has switched on "Planning a pregnancy".
 *
 * ONE place decides what the screen may see. `loadCycleTracker` runs the prediction through `applyPlanningMode`, so the
 * screen never holds the raw one, and takes its phase words from `phaseLabel` and `phaseDescription`.
 *
 * Switched off, the prediction keeps what a period tracker needs and loses the ovulation date, the window, and every
 * phase that names or implies one (luteal too: where it starts is where the window ends).
 *
 * The default is OFF everywhere: a missing profile row, a null, or `undefined` is off.
 */

const WINDOW_PHASES: ReadonlySet<CyclePhase> = new Set<CyclePhase>(["fertile", "ovulation", "luteal"]);

/** Shown beside the temperature field only while the mode is on, always with the label (S85 D2). */
export const THERMAL_SHIFT_EXPLAINER =
  "A temperature rise suggests ovulation has already happened, so it confirms rather than predicts.";

/** Strict: only a real `true` turns the mode on. */
export function isPlanningMode(value: boolean | null | undefined): boolean {
  return value === true;
}

export function applyPlanningMode(prediction: CyclePrediction, planningMode: boolean): CyclePrediction {
  if (planningMode) return prediction;
  return {
    ...prediction,
    predictedOvulationDate: null,
    fertileWindowStart: null,
    fertileWindowEnd: null,
    currentPhase: WINDOW_PHASES.has(prediction.currentPhase) ? "follicular" : prediction.currentPhase,
  };
}

/** Off: any phase that is not a period or unknown reads as "between periods", even if a stale prediction still carries one of the hidden ones. */
function betweenPeriods(phase: CyclePhase, planningMode: boolean): boolean {
  return !planningMode && (phase === "follicular" || WINDOW_PHASES.has(phase));
}

export function phaseLabel(phase: CyclePhase, planningMode: boolean): string {
  if (betweenPeriods(phase, planningMode)) return en["cycle.between_periods.label"];
  return PHASE_LABEL[phase];
}

export function phaseDescription(phase: CyclePhase, planningMode: boolean): string {
  if (betweenPeriods(phase, planningMode)) return en["cycle.between_periods.description"];
  return PHASE_DESCRIPTION[phase];
}
