import type { MessageKey } from "@tarragon/i18n";

/**
 * Plain-language guidance for one released result item, and the one next step (S46, function 3.13).
 *
 * Deterministic text, no model: the wording is keyed English (en.ts), reviewed once, and identical for everyone. HIV, hepatitis B surface antigen and
 * hepatitis C antibody results are NEVER explained here, by audio or by AI (INV-04): they get the single "your care team will talk this through with you
 * personally" line and nothing else. The same codes are enforced in the database by the sensitive_result_codes list and a trigger on
 * patient_result_explanations; sensitive-codes.test.ts fails if this list and the migration drift apart.
 */

/** Mirrors public.sensitive_result_codes (migration S46). Lower case. */
export const SENSITIVE_RESULT_CODES: ReadonlySet<string> = new Set([
  "hiv", "hiv_screen", "hiv_ab_ag", "hiv_antibody",
  "hep_b", "hbsag", "hbs_ag", "hbv_surface_antigen",
  "hep_c", "hcv_ab", "anti_hcv", "hcv_antibody",
]);

export function isSensitiveResultCode(code: string | null | undefined): boolean {
  return !!code && SENSITIVE_RESULT_CODES.has(code.trim().toLowerCase());
}

export type ResultFlag = "normal" | "low" | "high" | "critical" | "positive" | "negative";

export interface ResultGuidance {
  /** null means: say nothing about what the result means (sensitive, or not allowed). */
  readonly explanationKey: MessageKey | null;
  readonly nextStepKey: MessageKey;
}

const EXPLANATION: Record<ResultFlag, MessageKey> = {
  normal: "labres.guide.normal",
  low: "labres.guide.low",
  high: "labres.guide.high",
  critical: "labres.guide.critical",
  positive: "labres.guide.positive",
  negative: "labres.guide.negative",
};
const NEXT_STEP: Record<ResultFlag, MessageKey> = {
  normal: "labres.next.normal",
  low: "labres.next.outside",
  high: "labres.next.outside",
  critical: "labres.next.critical",
  positive: "labres.next.positive",
  negative: "labres.next.normal",
};

/**
 * @param explainAllowed the database's own answer for the whole result (`explain_allowed` from my_lab_results). False means no explanation of any item.
 */
export function guidanceForItem(item: { analyte_code: string; flag: ResultFlag; sensitive_positive?: boolean }, explainAllowed: boolean): ResultGuidance {
  if (isSensitiveResultCode(item.analyte_code) || item.sensitive_positive) {
    return { explanationKey: null, nextStepKey: "labres.next.sensitive" };
  }
  if (!explainAllowed) return { explanationKey: null, nextStepKey: "labres.next.ask_care_team" };
  return { explanationKey: EXPLANATION[item.flag], nextStepKey: NEXT_STEP[item.flag] };
}

/**
 * The only gate for recorded audio of a result. Audio plays only for a released result with no sensitive positive (explain_allowed) and never for a sensitive
 * analyte. No result audio clips are recorded today (the audio manifest, S32, has none), so this stays false in practice until the CMO signs recorded wording.
 */
export function resultAudioAllowed(item: { analyte_code: string; sensitive_positive?: boolean }, explainAllowed: boolean, manifestHasClip: boolean): boolean {
  return explainAllowed && manifestHasClip && !item.sensitive_positive && !isSensitiveResultCode(item.analyte_code);
}
