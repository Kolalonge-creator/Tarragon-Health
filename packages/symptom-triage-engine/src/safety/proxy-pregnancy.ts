/**
 * Pregnancy answers are the person's own (founder decision on OQ-S59d-05, 2026-10-22).
 *
 * When a carer or relative runs the check for another person (the acting-for or dependant flow), then:
 *  - the pregnancy pathway (`pregnancy_danger_signs`) is not offered and not run, whatever a direct call asks for;
 *  - the "I am pregnant" history answer is never passed to the engine or recorded (the record-side pregnancy context is already
 *    withheld for someone acted for, S59);
 *  - the result says plainly that pregnancy questions can only be answered by the person themselves, and still shows the normal
 *    emergency guidance.
 *
 * This is pure and fails toward caution: it only REMOVES an input or refuses a pathway, it never lowers anything, and the red-flag
 * floor and every other pathway are untouched.
 */
import type { SymptomCapture } from "../types/index";

/** Pathways whose questions are about the person's pregnancy and so can only be answered by that person. */
export const PREGNANCY_SELF_ONLY_PATHWAYS: readonly string[] = ["pregnancy_danger_signs"];
/** History answers that disclose pregnancy and so are never taken from someone answering for another person. */
export const PREGNANCY_SELF_ONLY_HISTORY: readonly string[] = ["pregnant"];

export interface ProxyPregnancyOutcome {
  /** The pathway must not run: show the "only the person themselves" message and the emergency guidance. */
  blocked: boolean;
  /** The capture to use: a proxy's capture with the pregnancy history answer removed. Unchanged for the person themselves. */
  capture: SymptomCapture;
  /** True when a pregnancy answer was removed from a proxy's capture. */
  strippedPregnancy: boolean;
}

export function applyProxyPregnancyRule(capture: SymptomCapture, forProxy: boolean): ProxyPregnancyOutcome {
  if (!forProxy) return { blocked: false, capture, strippedPregnancy: false };
  const blocked = PREGNANCY_SELF_ONLY_PATHWAYS.includes(capture.presentingComplaintKey);
  const kept = capture.relevantHistory.filter((h) => !PREGNANCY_SELF_ONLY_HISTORY.includes(h));
  const stripped = kept.length !== capture.relevantHistory.length;
  return { blocked, capture: stripped ? { ...capture, relevantHistory: kept } : capture, strippedPregnancy: stripped };
}

/** True when a pathway key may not be offered or run for someone acting for another person. */
export function pathwayIsSelfOnly(presentingComplaintKey: string): boolean {
  return PREGNANCY_SELF_ONLY_PATHWAYS.includes(presentingComplaintKey);
}
