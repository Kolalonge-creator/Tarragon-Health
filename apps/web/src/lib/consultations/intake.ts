/**
 * S64 (15.3): the manual structured intake. Pure rules, mirrored by the database (private.intake_answers_valid and the table checks),
 * so the form says what is wrong before the call and the database still refuses what the form let through.
 *
 * What this is: the patient's own words, in a fixed shape, sent to their care team before a visit. The summary is written by plain code
 * in the database only when the patient presses send. No language model is involved (INV-01, INV-11), nothing here decides urgency, and
 * the screen always carries the standing "go to the nearest hospital" line instead of trying to read the text for danger.
 *
 * The seam for later: a symptom-checker summary (S60) arrives as the same row with source "symptom_checker" and a source_ref that
 * names where it came from. The database refuses such a row without the reference. Nothing here builds that path.
 */

export const INTAKE_DURATIONS = ["today", "few_days", "one_to_four_weeks", "over_a_month", "not_sure"] as const;
export type IntakeDuration = (typeof INTAKE_DURATIONS)[number];

export const INTAKE_ANSWER_KEYS = ["tried_so_far", "medicines_now", "allergies", "main_worry", "question_for_visit"] as const;
export type IntakeAnswerKey = (typeof INTAKE_ANSWER_KEYS)[number];

export const INTAKE_MAX_REASON_CHARS = 500;
export const INTAKE_MAX_ANSWER_CHARS = 400;

export type IntakeSource = "manual" | "symptom_checker";

/** The shape a later symptom-checker summary must arrive in. Not built or called anywhere in S64. */
export interface IntakeFromSymptomChecker {
  source: "symptom_checker";
  /** Names the checker run that produced it; required, so a summary never appears without its origin. */
  sourceRef: string;
}

export interface IntakeDraft {
  reason: string;
  duration: IntakeDuration | "";
  answers: Partial<Record<IntakeAnswerKey, string>>;
}

export type IntakeProblem = "reason_missing" | "reason_too_long" | "duration_missing" | "answer_too_long";

/** Drops blank answers and trims, so what is saved is exactly what will be sent. */
export function cleanAnswers(answers: Partial<Record<IntakeAnswerKey, string>>): Partial<Record<IntakeAnswerKey, string>> {
  const out: Partial<Record<IntakeAnswerKey, string>> = {};
  for (const key of INTAKE_ANSWER_KEYS) {
    const v = answers[key]?.trim();
    if (v) out[key] = v;
  }
  return out;
}

/** What is wrong with a draft that is about to be SENT (a draft can be saved half done). */
export function problemsBeforeSend(d: IntakeDraft): IntakeProblem[] {
  const out: IntakeProblem[] = [];
  const reason = d.reason.trim();
  if (reason.length === 0) out.push("reason_missing");
  if (reason.length > INTAKE_MAX_REASON_CHARS) out.push("reason_too_long");
  if (d.duration === "") out.push("duration_missing");
  if (Object.values(cleanAnswers(d.answers)).some((v) => v.length > INTAKE_MAX_ANSWER_CHARS)) out.push("answer_too_long");
  return out;
}
