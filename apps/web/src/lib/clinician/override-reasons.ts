import { z } from "zod";
import type { MessageKey } from "@tarragon/i18n";

/**
 * W-02: the short list of reasons a clinician can give when changing the system's answer. The list awaits CMO approval; until then the
 * codes are only recorded, and choosing one is OPTIONAL in every form. Nothing ranks, orders or scores by them, and the data layer lets
 * only the clinician who wrote a row read it (the CMO reads counts of 3 or more, with no clinician field).
 */
export const OVERRIDE_REASON_CODES = ["system_too_high", "system_too_low", "context_known", "data_error", "other"] as const;
export type OverrideReasonCode = (typeof OVERRIDE_REASON_CODES)[number];
export const overrideReasonCodeSchema = z.enum(OVERRIDE_REASON_CODES);

export const OVERRIDE_REASON_LABEL_KEY: Record<OverrideReasonCode, MessageKey> = {
  system_too_high: "override.code.system_too_high",
  system_too_low: "override.code.system_too_low",
  context_known: "override.code.context_known",
  data_error: "override.code.data_error",
  other: "override.code.other",
};

export const BRIEF_FEEDBACK_VALUES = ["useful", "unsafe", "missing"] as const;
export type BriefFeedback = (typeof BRIEF_FEEDBACK_VALUES)[number];
export const briefFeedbackSchema = z.enum(BRIEF_FEEDBACK_VALUES);

export const BRIEF_FEEDBACK_LABEL_KEY: Record<BriefFeedback, MessageKey> = {
  useful: "override.brief.useful",
  unsafe: "override.brief.unsafe",
  missing: "override.brief.missing",
};

/** A code may only go with a concern about the brief, never with 'useful'. Mirrors the database check. */
export function codeAllowedWith(feedback: BriefFeedback): boolean {
  return feedback !== "useful";
}
