import { z } from "zod";

/**
 * Sexual dysfunction screens (spec §47.10) — four short, faithful
 * plain-language paraphrases of standard validated instruments (not the
 * copyrighted item wording verbatim), scored server-side by
 * apps/web/src/lib/rules/sexual-health-scoring.ts.
 *
 * Two scoring directions, deliberately kept internally consistent within
 * each instrument (every item points the same way) rather than needing
 * per-item reverse-scoring:
 *   - iief5 (erectile function) and libido_brief (low libido): each item is
 *     worded so a HIGHER answer means BETTER function / less concern.
 *     1-5 per item, total 5-25.
 *   - fsfi_pain (painful intercourse) and pe_diagnostic_tool (premature
 *     ejaculation): each item is worded so a HIGHER answer means WORSE
 *     symptoms. 0-5 per item, total 0-25.
 * See lib/rules/sexual-health-scoring.ts for exactly how each direction
 * bands into severity.
 */

export const SEXUAL_HEALTH_INSTRUMENTS = [
  "iief5",
  "fsfi_pain",
  "libido_brief",
  "pe_diagnostic_tool",
] as const;
export type SexualHealthInstrument = (typeof SEXUAL_HEALTH_INSTRUMENTS)[number];

export const SEXUAL_HEALTH_INSTRUMENT_LABEL: Record<SexualHealthInstrument, string> = {
  iief5: "Erectile difficulties",
  fsfi_pain: "Painful intercourse",
  libido_brief: "Low libido",
  pe_diagnostic_tool: "Ejaculation concerns",
};

const item1to5 = z.coerce.number().int().min(1).max(5);
const item0to5 = z.coerce.number().int().min(0).max(5);

function itemFields<T extends z.ZodTypeAny>(prefix: string, item: T): Record<string, T> {
  return Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`${prefix}_${i + 1}`, item]));
}

export const iief5Schema = z.object(itemFields("iief5", item1to5));
export const fsfiPainSchema = z.object(itemFields("fsfi_pain", item0to5));
export const libidoBriefSchema = z.object(itemFields("libido_brief", item1to5));
export const peDiagnosticToolSchema = z.object(itemFields("pe_diagnostic_tool", item0to5));

export const SEXUAL_HEALTH_SCHEMA_BY_INSTRUMENT = {
  iief5: iief5Schema,
  fsfi_pain: fsfiPainSchema,
  libido_brief: libidoBriefSchema,
  pe_diagnostic_tool: peDiagnosticToolSchema,
} satisfies Record<SexualHealthInstrument, z.ZodTypeAny>;

/** Generic 1-5 "higher = better" answer labels, reused across every item of
 * iief5/libido_brief (same simplification mental-health-screen.ts makes
 * with its single FREQUENCY_OPTIONS array across differently-worded
 * PHQ-9/GAD-7 items). */
export const BETTER_DIRECTION_OPTIONS = [
  { value: 1, label: "Not at all" },
  { value: 2, label: "A little" },
  { value: 3, label: "Somewhat" },
  { value: 4, label: "Mostly" },
  { value: 5, label: "Very much" },
] as const;

/** Generic 0-5 "higher = worse" answer labels, reused across every item of
 * fsfi_pain/pe_diagnostic_tool. */
export const WORSE_DIRECTION_OPTIONS = [
  { value: 0, label: "Never" },
  { value: 1, label: "Rarely" },
  { value: 2, label: "Sometimes" },
  { value: 3, label: "Often" },
  { value: 4, label: "Most of the time" },
  { value: 5, label: "Always" },
] as const;

export const IIEF5_QUESTIONS = [
  "How confident are you that you could get and keep an erection?",
  "When you had erections, how often were they firm enough for sex?",
  "During sex, how often were you able to maintain your erection after penetration?",
  "During sex, how easy was it to maintain your erection all the way to completion?",
  "Overall, how satisfied are you with your ability to have sex?",
] as const;

export const FSFI_PAIN_QUESTIONS = [
  "How often did you experience pain during vaginal penetration?",
  "When you had pain, how severe was it?",
  "How much discomfort did penetration cause?",
  "How much has this pain reduced your desire to be intimate?",
  "Overall, how bothered are you by this pain?",
] as const;

export const LIBIDO_BRIEF_QUESTIONS = [
  "How often do you have sexual thoughts or desire?",
  "How interested are you in initiating sex?",
  "How satisfied are you with your current level of desire?",
  "How comfortable are you with your current level of desire?",
  "Compared to 6 months ago, would you say your desire is the same or higher?",
] as const;

export const PE_DIAGNOSTIC_TOOL_QUESTIONS = [
  "How much difficulty do you have controlling when you ejaculate?",
  "How often do you ejaculate sooner than you would like to?",
  "How dissatisfied are you with the timing of your ejaculation?",
  "How much distress does this cause you?",
  "How much difficulty has this caused between you and your partner?",
] as const;
