import { z } from "zod";

/**
 * W-02: the short list of reasons a clinician can give when changing the system's answer. The list awaits CMO approval; until then the
 * codes are only recorded. Nothing ranks, orders or scores by them, and nothing here is ever used to rate a clinician.
 */
export const OVERRIDE_REASON_CODES = ["system_too_high", "system_too_low", "context_known", "data_error", "other"] as const;
export type OverrideReasonCode = (typeof OVERRIDE_REASON_CODES)[number];
export const overrideReasonCodeSchema = z.enum(OVERRIDE_REASON_CODES);

export const OVERRIDE_REASON_LABEL: Record<OverrideReasonCode, string> = {
  system_too_high: "The system rated this too high",
  system_too_low: "The system rated this too low",
  context_known: "I know something the system does not",
  data_error: "The reading or record looks wrong",
  other: "Something else",
};

export const BRIEF_FEEDBACK_VALUES = ["useful", "unsafe", "missing"] as const;
export type BriefFeedback = (typeof BRIEF_FEEDBACK_VALUES)[number];
export const briefFeedbackSchema = z.enum(BRIEF_FEEDBACK_VALUES);

export const BRIEF_FEEDBACK_LABEL: Record<BriefFeedback, string> = {
  useful: "Useful",
  unsafe: "Not safe",
  missing: "Missing something",
};
