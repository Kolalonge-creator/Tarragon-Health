import { z } from "zod";
import { en, type MessageKey } from "@tarragon/i18n";

/**
 * P6: how a graded result is shown to people. Two readers, one source of wording:
 *  - the patient sees the grade and the approved guidance they were shown when they saved the reading;
 *  - the tied clinician sees the rule id, the rule set and version, and the facts the rule was given (decision-support
 *    transparency: a doctor can check WHY the engine raised a task, and can disagree).
 * Wording comes from the approved clinical catalogue by explanation code (TRI-001 becomes triage.tri_001.*), so there is
 * one place to change a sentence. Nothing here names a condition in a notification; this is in-app only (INV-07).
 */

export const gradeSchema = z.enum(["green", "amber", "red"]);
export type TriageGrade = z.infer<typeof gradeSchema>;

export const GRADE_KEY: Readonly<Record<TriageGrade, MessageKey>> = {
  green: "triage.grade.green",
  amber: "triage.grade.amber",
  red: "triage.grade.red",
};

/** triage.tri_001.title / .body for TRI-001, or null when the catalogue has no wording for the code. */
export function wordingKeys(explanationKey: string | null): { title: MessageKey; body: MessageKey } | null {
  if (!explanationKey) return null;
  const stem = `triage.${explanationKey.toLowerCase().replace(/-/g, "_")}`;
  const title = `${stem}.title`;
  const body = `${stem}.body`;
  if (!Object.hasOwn(en, title) || !Object.hasOwn(en, body)) return null;
  return { title: title as MessageKey, body: body as MessageKey };
}

/** What a patient reads next to a saved reading. */
export const patientTriageRowSchema = z.object({
  id: z.string(),
  grade: gradeSchema,
  explanation_key: z.string().nullable(),
  created_at: z.string(),
});
export type PatientTriageRow = z.infer<typeof patientTriageRowSchema>;

const readingContext = z
  .object({
    systolic: z.number().nullish(),
    diastolic: z.number().nullish(),
    value: z.number().nullish(),
    takenAt: z.string().nullish(),
  })
  .partial();

/** The facts stored with a result. Each field is optional: a silence result has no reading, a reading has no percentage. */
export const triageContextSchema = z
  .object({
    type: z.enum(["silence", "adherence"]).optional(),
    lastReadingAt: z.string().nullish(),
    sinceAt: z.string().nullish(),
    percent7d: z.number().nullish(),
    reading: readingContext.optional(),
    cuffType: z.enum(["upper_arm", "wrist", "not_sure"]).nullish(),
    symptoms: z.array(z.string()).optional(),
    severity: z.number().optional(),
    noReading: z.boolean().optional(),
  })
  .passthrough();
export type TriageContext = z.infer<typeof triageContextSchema>;

export const explainerSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("denied") }),
  z.object({ status: z.literal("none") }),
  z.object({
    status: z.literal("ok"),
    task_id: z.string(),
    triage_event: z.object({
      id: z.string(),
      grade: gradeSchema,
      trigger_type: z.string(),
      rule_id: z.string().nullable(),
      rule_set_code: z.string(),
      rule_set_version: z.number(),
      rule_set_status: z.string(),
      matched_rule_ids: z.array(z.string()),
      explanation_key: z.string().nullable(),
      task_key: z.string().nullable(),
      context: z.unknown().nullable(),
      created_at: z.string(),
    }),
  }),
]);
export type Explainer = z.infer<typeof explainerSchema>;

/** A context that does not match the expected shape is shown as nothing rather than guessed at. */
export function parseContext(raw: unknown): TriageContext | null {
  const parsed = triageContextSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function readingLine(c: TriageContext): string | null {
  const r = c.reading;
  if (!r) return null;
  if (typeof r.systolic === "number" && typeof r.diastolic === "number") return `${r.systolic}/${r.diastolic} mmHg`;
  if (typeof r.value === "number") return String(r.value);
  return null;
}

export const CUFF_KEY: Readonly<Record<"upper_arm" | "wrist" | "not_sure", MessageKey>> = {
  upper_arm: "cuff.upper_arm",
  wrist: "cuff.wrist",
  not_sure: "cuff.not_sure",
};
