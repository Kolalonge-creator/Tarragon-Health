import { en } from "@tarragon/i18n";
import {
  PHASE_DESCRIPTION,
  PHASE_LABEL,
  type CyclePhase,
  type CyclePrediction,
} from "./cycle-prediction";

/**
 * S85 D2 / OQ-12 (founder decision, CMO wording unsigned): the estimated ovulation date and the days around it are
 * hidden by default and shown only when the person has switched on "Planning a pregnancy".
 *
 * ONE place decides what the screens may see. Every surface takes the prediction through `applyPlanningMode` (the
 * hook does it, so a component never holds the raw one), and takes its phase words from `phaseLabel` and
 * `phaseDescription`, so no screen can show the window by reading a field this file removed.
 *
 * Switched off, the prediction keeps what a period tracker needs (cycle day, next period and its range, how sure we
 * are) and loses the ovulation date, the window, and every phase that names or implies one. Luteal goes too: where it
 * starts is where the window ends, so drawing or naming it would give the window back.
 *
 * Pure, no clock reads, no DB. The default everywhere is OFF: a missing profile row, a null, or `undefined` is off.
 */

/** Phases that name the window or imply where it ends. Hidden while the mode is off. */
const WINDOW_PHASES: ReadonlySet<CyclePhase> = new Set<CyclePhase>(["fertile", "ovulation", "luteal"]);

/** Strict: only a real `true` turns the mode on. Anything else (null, undefined, a missing column) is off. */
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

/** A phase that may be drawn or named while the mode is off. */
export function phaseVisible(phase: CyclePhase, planningMode: boolean): boolean {
  return planningMode || !WINDOW_PHASES.has(phase);
}

/** The words for the current phase. Off: the only non-period phase is "Between periods". */
export function phaseLabel(phase: CyclePhase, planningMode: boolean): string {
  if (!planningMode && phase === "follicular") return en["cycle.between_periods.label"];
  return PHASE_LABEL[phase];
}

export function phaseDescription(phase: CyclePhase, planningMode: boolean): string {
  if (!planningMode && phase === "follicular") return en["cycle.between_periods.description"];
  return PHASE_DESCRIPTION[phase];
}

/** "Usually ..." wording for a pattern. Off: never names a phase that is hidden. */
export function insightPhasePhrase(phase: CyclePhase, planningMode: boolean): string {
  if (planningMode) return `Usually in your ${PHASE_LABEL[phase].toLowerCase()}.`;
  return phase === "menstrual" ? "Usually during your period." : "Usually between periods.";
}
