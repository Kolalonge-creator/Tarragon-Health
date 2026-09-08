import { postSexualWellnessScreen } from "./api";
import type { QueryResult } from "./medications";

/**
 * Sexual dysfunction ("Sexual Wellness") screening (spec §47.10). Mirrors
 * apps/web/.../patient/sexual-health/sexual-wellness-actions.ts +
 * lib/validation/sexual-health-screen.ts + lib/rules/sexual-health-scoring.ts.
 * Scoring happens server-side, via
 * /api/mobile/sexual-health/sexual-wellness-screen —
 * sexual_health_screens has no client-facing INSERT policy at all (same
 * discipline as mental_health_screens). **patientId is always the device
 * owner's own id — see sti.ts's header comment.**
 */

export const SEXUAL_HEALTH_INSTRUMENTS = ["iief5", "fsfi_pain", "libido_brief", "pe_diagnostic_tool"] as const;
export type SexualHealthInstrument = (typeof SEXUAL_HEALTH_INSTRUMENTS)[number];

export const SEXUAL_HEALTH_INSTRUMENT_LABEL: Record<SexualHealthInstrument, string> = {
  iief5: "Erectile difficulties",
  fsfi_pain: "Painful intercourse",
  libido_brief: "Low libido",
  pe_diagnostic_tool: "Ejaculation concerns",
};

export type SexualHealthSeverityBand = "none_minimal" | "mild" | "moderate" | "severe";
export const SEXUAL_HEALTH_SEVERITY_BAND_LABEL: Record<SexualHealthSeverityBand, string> = {
  none_minimal: "Minimal or no concern",
  mild: "Mild",
  moderate: "Moderate",
  severe: "Significant",
};

/** Warm, never clinical-sounding framing for a result — the same four
 * phrases regardless of which instrument produced them. */
export const SEXUAL_HEALTH_SEVERITY_COPY: Record<SexualHealthSeverityBand, string> = {
  none_minimal: "This doesn't seem to be much of a concern right now.",
  mild: "This seems like a mild concern: common, and it often eases with small changes.",
  moderate: "This seems like a moderate concern, worth talking to your care team about.",
  severe: "This seems like a significant concern, and your care team can help, so it's worth reaching out soon.",
};

export type LikertOption = { value: number; label: string };

export const BETTER_DIRECTION_OPTIONS: LikertOption[] = [
  { value: 1, label: "Not at all" },
  { value: 2, label: "A little" },
  { value: 3, label: "Somewhat" },
  { value: 4, label: "Mostly" },
  { value: 5, label: "Very much" },
];

export const WORSE_DIRECTION_OPTIONS: LikertOption[] = [
  { value: 0, label: "Never" },
  { value: 1, label: "Rarely" },
  { value: 2, label: "Sometimes" },
  { value: 3, label: "Often" },
  { value: 4, label: "Most of the time" },
  { value: 5, label: "Always" },
];

export const IIEF5_QUESTIONS = [
  "How confident are you that you could get and keep an erection?",
  "When you had erections, how often were they firm enough for sex?",
  "During sex, how often were you able to maintain your erection after penetration?",
  "During sex, how easy was it to maintain your erection all the way to completion?",
  "Overall, how satisfied are you with your ability to have sex?",
];

export const FSFI_PAIN_QUESTIONS = [
  "How often did you experience pain during vaginal penetration?",
  "When you had pain, how severe was it?",
  "How much discomfort did penetration cause?",
  "How much has this pain reduced your desire to be intimate?",
  "Overall, how bothered are you by this pain?",
];

export const LIBIDO_BRIEF_QUESTIONS = [
  "How often do you have sexual thoughts or desire?",
  "How interested are you in initiating sex?",
  "How satisfied are you with your current level of desire?",
  "How comfortable are you with your current level of desire?",
  "Compared to 6 months ago, would you say your desire is the same or higher?",
];

export const PE_DIAGNOSTIC_TOOL_QUESTIONS = [
  "How much difficulty do you have controlling when you ejaculate?",
  "How often do you ejaculate sooner than you would like to?",
  "How dissatisfied are you with the timing of your ejaculation?",
  "How much distress does this cause you?",
  "How much difficulty has this caused between you and your partner?",
];

export const INSTRUMENT_CONFIG: Record<SexualHealthInstrument, { questions: string[]; options: LikertOption[] }> = {
  iief5: { questions: IIEF5_QUESTIONS, options: BETTER_DIRECTION_OPTIONS },
  libido_brief: { questions: LIBIDO_BRIEF_QUESTIONS, options: BETTER_DIRECTION_OPTIONS },
  fsfi_pain: { questions: FSFI_PAIN_QUESTIONS, options: WORSE_DIRECTION_OPTIONS },
  pe_diagnostic_tool: { questions: PE_DIAGNOSTIC_TOOL_QUESTIONS, options: WORSE_DIRECTION_OPTIONS },
};

export interface SexualWellnessResult {
  totalScore: number;
  severityBand: SexualHealthSeverityBand;
  cardiometabolicFlag: boolean;
}

export async function submitSexualHealthScreen(instrument: SexualHealthInstrument, items: number[]): Promise<QueryResult<SexualWellnessResult>> {
  if (items.length !== 5 || items.some((v) => Number.isNaN(v))) {
    return { ok: false, error: "Please answer every question" };
  }
  const result = await postSexualWellnessScreen(instrument, items);
  if (result.error || !result.success || !result.severityBand) {
    return { ok: false, error: result.error ?? "Please answer every question" };
  }
  return {
    ok: true,
    data: {
      totalScore: result.totalScore ?? 0,
      severityBand: result.severityBand as SexualHealthSeverityBand,
      cardiometabolicFlag: result.cardiometabolicFlag ?? false,
    },
  };
}
