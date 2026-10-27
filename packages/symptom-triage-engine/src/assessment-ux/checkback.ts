/**
 * S59c: the follow-up check-back after a completed assessment ("better, same or worse?"), the pure half. The database holds the schedule,
 * the sweep and the escalation; this module holds the same decision table so the screen can show the right guidance at once, on the device,
 * and so a test can pin the table against the database proof.
 *
 * WHO GETS ONE. Only a check that ended as self-care or a routine appointment (the config names the categories and a delay for each).
 * An urgent or emergency result already put a human in the loop, so it is never scheduled (and `delayHours` returns null for it).
 *
 * THE DECISION TABLE (deterministic, no model):
 *   - the red-flag floor, re-run on the original answers plus anything newly ticked, says emergency        -> emergency
 *   - anything newly ticked (a new warning sign), or the floor says urgent, or the person says "worse"    -> escalate
 *   - "same" and at least `same_nudge_after_hours` since the check                                          -> book
 *   - "same" earlier than that                                                                              -> keep_watching
 *   - "better" with nothing newly ticked                                                                    -> close
 * "Did you get care?" is recorded and never changes the action. The actions are ordered and every extra signal can only move the result UP
 * the order (a property test enumerates every combination). Nothing here can close a check-back that has a warning sign or a "worse".
 */
import { z } from "zod";
import { evaluateBundledRedFlags } from "../safety/bundled-red-flags";
import type { SymptomCapture, TriageCategory } from "../types/index";
import { envelopeShape, parseInForce } from "./ux-config";

export const CHECKBACK_CATEGORIES = ["self_management", "routine"] as const;
export const PROGRESS_OPTIONS = ["better", "same", "worse"] as const;
export type CheckbackProgress = (typeof PROGRESS_OPTIONS)[number];
export const CARE_OPTIONS = ["saw_clinician", "pharmacist", "not_yet", "not_needed"] as const;
export type CheckbackCare = (typeof CARE_OPTIONS)[number];

const categoryRule = z
  .object({
    /** Hours after the check before the check-back opens. */
    delay_hours: z.number().int().min(1).max(168),
    /** "Same" answered at least this long after the check nudges toward a booking. */
    same_nudge_after_hours: z.number().int().min(1).max(336),
  })
  .strict();

export const checkbackConfigSchema = z
  .object({
    ...envelopeShape,
    categories: z.object({ self_management: categoryRule, routine: categoryRule }).strict(),
    /** How long an opened check-back can be answered. */
    expire_after_hours: z.number().int().min(1).max(336),
    /** One reminder at most, this long after it opened. */
    nudge_after_hours: z.number().int().min(1).max(168),
    max_nudges: z.number().int().min(0).max(1),
    /** Africa/Lagos hours inside which a notice is sent; the in-app item is never held. */
    notification_window: z.object({ start_hour: z.number().int().min(0).max(23), end_hour: z.number().int().min(1).max(24) }).strict(),
  })
  .strict()
  .refine((c) => c.notification_window.start_hour < c.notification_window.end_hour, { message: "notification window is empty" });
export type CheckbackConfig = z.infer<typeof checkbackConfigSchema>;

/** Hours after the check at which a check-back opens, or null when none is scheduled (not in force, or an urgent or emergency result). */
export function checkbackDelayHours(category: TriageCategory, rawConfig: unknown): number | null {
  const config = parseInForce(checkbackConfigSchema, rawConfig);
  if (!config) return null;
  if (category !== "self_management" && category !== "routine") return null;
  return config.categories[category].delay_hours;
}

export const CHECKBACK_ACTIONS = ["close", "keep_watching", "book", "escalate", "emergency"] as const;
export type CheckbackAction = (typeof CHECKBACK_ACTIONS)[number];
const RANK: Record<CheckbackAction, number> = { close: 0, keep_watching: 1, book: 2, escalate: 3, emergency: 4 };
export function checkbackActionRank(a: CheckbackAction): number {
  return RANK[a];
}

export interface CheckbackAnswers {
  progress: CheckbackProgress;
  /** Recorded only; never changes the action. */
  careReceived?: CheckbackCare | null;
  /** Warning signs newly ticked from the pathway's own vocabulary. */
  newSigns: readonly string[];
  /** The red-flag floor re-run on the original answers plus the new ones: the category it asked for, or null when nothing fired. */
  floorCategory: TriageCategory | null;
}

/**
 * The category the red-flag floor asks for when run on the ORIGINAL answers plus the newly ticked signs: `urgent`, `emergency`, or null.
 * Used on the device (to show an emergency at once) and on the server (to hand the database the same figure). If the floor cannot be evaluated
 * and the person ticked anything, the answer is `urgent`, never nothing.
 */
export function floorForAnswer(capture: SymptomCapture, newSigns: readonly string[]): TriageCategory | null {
  try {
    const merged: SymptomCapture = { ...capture, associatedSymptoms: [...new Set([...capture.associatedSymptoms, ...newSigns])] };
    const top = evaluateBundledRedFlags(merged).topCategory;
    return top === "emergency" || top === "urgent" ? top : null;
  } catch {
    return newSigns.length > 0 ? "urgent" : null;
  }
}

/** The action for an answered check-back. Same table as `public.answer_symptom_checkback`. */
export function decideCheckback(answers: CheckbackAnswers, ctx: { hoursSinceCheck: number; sameNudgeAfterHours: number }): CheckbackAction {
  if (answers.floorCategory === "emergency") return "emergency";
  if (answers.newSigns.length > 0 || answers.floorCategory === "urgent" || answers.progress === "worse") return "escalate";
  if (answers.progress === "same") return ctx.hoursSinceCheck >= ctx.sameNudgeAfterHours ? "book" : "keep_watching";
  return "close";
}
