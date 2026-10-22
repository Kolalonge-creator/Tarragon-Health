/**
 * Pregnancy answers are the person's own (founder decision on OQ-S59d-05, 2026-10-22, amended 2026-10-22 after review).
 *
 * When a carer or relative runs the check for another person (the acting-for or dependant flow):
 *  - the pregnancy pathway (`pregnancy_danger_signs`) is not offered and not run, whatever a direct call asks for;
 *  - a "pregnant" answer ticked in ANY other pathway is NEVER STORED (not in the recorded capture, not in the database), but it is NOT
 *    dropped from the decision either: the engine evaluates the pregnancy-dependent rules as if the person were pregnant, in memory
 *    only, so the rule-level result is at least as high as when the person answers for themselves, and the overall result is floored at
 *    `urgent` (never lowering a higher result), with a plain line that pregnancy changes how urgent this is and that pregnancy
 *    questions can only be answered by the person themselves;
 *  - the record-side pregnancy context stays withheld for someone acted for (S59), and the pathway itself is not offered.
 *
 * Nothing here ever lowers a result: dropping the answer from the engine would (headache.pregnancy_severe, fever.pregnant and the
 * pregnancy context entries all take it as input), so the engine capture keeps it and only the STORED capture loses it.
 * Pure and deterministic.
 */
import { mostUrgentCategory, type SymptomCapture, type TriageCategory } from "../types/index";

/** Pathways whose questions are about the person's pregnancy and so can only be answered by that person. */
export const PREGNANCY_SELF_ONLY_PATHWAYS: readonly string[] = ["pregnancy_danger_signs"];
/** History answers that disclose pregnancy and so are never STORED from someone answering for another person. */
export const PREGNANCY_SELF_ONLY_HISTORY: readonly string[] = ["pregnant"];
/** The least urgent a check can be when someone ticked "pregnant" on another person's behalf. */
export const PROXY_PREGNANCY_FLOOR: TriageCategory = "urgent";
/** Name recorded (names only) in `raised_by` when the proxy pregnancy floor raised the result. */
export const PROXY_PREGNANCY_RAISED_BY = "proxy_pregnancy_floor";

export interface ProxyPregnancyOutcome {
  /** The pathway must not run: show the "only the person themselves" message and the emergency guidance. */
  blocked: boolean;
  /** What the engine and the tightening layers see: the capture AS TICKED (a proxy's "pregnant" answer is still used, in memory). */
  engineCapture: SymptomCapture;
  /** What may be recorded: a proxy's capture with the pregnancy answer removed. Identical to the input for the person themselves. */
  storedCapture: SymptomCapture;
  /** True when a pregnancy answer was removed from the STORED capture (it was still used for the decision). */
  strippedPregnancy: boolean;
  /** True when a proxy ticked "pregnant": the result is floored at `urgent` and the plain line is shown. */
  pregnancyTickedByProxy: boolean;
}

export function applyProxyPregnancyRule(capture: SymptomCapture, forProxy: boolean): ProxyPregnancyOutcome {
  if (!forProxy) {
    return { blocked: false, engineCapture: capture, storedCapture: capture, strippedPregnancy: false, pregnancyTickedByProxy: false };
  }
  const blocked = PREGNANCY_SELF_ONLY_PATHWAYS.includes(capture.presentingComplaintKey);
  const kept = capture.relevantHistory.filter((h) => !PREGNANCY_SELF_ONLY_HISTORY.includes(h));
  const stripped = kept.length !== capture.relevantHistory.length;
  return {
    blocked,
    engineCapture: capture,
    storedCapture: stripped ? { ...capture, relevantHistory: kept } : capture,
    strippedPregnancy: stripped,
    pregnancyTickedByProxy: stripped,
  };
}

/** Floor a result at `urgent` when a proxy ticked "pregnant". Never lowers; `raised` is true only when the floor changed the category. */
export function applyProxyPregnancyFloor(category: TriageCategory, pregnancyTickedByProxy: boolean): { category: TriageCategory; raised: boolean } {
  if (!pregnancyTickedByProxy) return { category, raised: false };
  const next = mostUrgentCategory(category, PROXY_PREGNANCY_FLOOR);
  return { category: next, raised: next !== category };
}

/** True when a pathway key may not be offered or run for someone acting for another person. */
export function pathwayIsSelfOnly(presentingComplaintKey: string): boolean {
  return PREGNANCY_SELF_ONLY_PATHWAYS.includes(presentingComplaintKey);
}
