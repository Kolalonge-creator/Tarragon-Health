/**
 * "Report a problem with this draft" (S76-S80): a fixed taxonomy so the Chief Medical Officer can count what goes wrong. Pure.
 * The report names the draft kind, optionally the section, and one category; a short comment is optional and clinician-written.
 */
import { z } from "zod";
import { DRAFT_SECTION_KEYS } from "./draft-review";

export const PROBLEM_CATEGORIES = ["invented_content", "omission", "wrong_medicine_or_dose", "wrong_patient", "other"] as const;
export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number];

export const PROBLEM_LABEL_KEYS: Readonly<Record<ProblemCategory, string>> = {
  invented_content: "scribeui.problem.invented_content",
  omission: "scribeui.problem.omission",
  wrong_medicine_or_dose: "scribeui.problem.wrong_medicine_or_dose",
  wrong_patient: "scribeui.problem.wrong_patient",
  other: "scribeui.problem.other",
};

export const PROBLEM_DRAFT_KINDS = ["note", "letter", "prescription_proposal", "follow_up_tasks"] as const;
export const MAX_PROBLEM_COMMENT = 500;

export const problemReportSchema = z.object({
  noteId: z.string().uuid(),
  consentId: z.string().uuid().nullable(),
  draftKind: z.enum(PROBLEM_DRAFT_KINDS),
  section: z.enum(DRAFT_SECTION_KEYS).nullable(),
  category: z.enum(PROBLEM_CATEGORIES),
  comment: z.string().max(MAX_PROBLEM_COMMENT).optional(),
});
export type ProblemReport = z.infer<typeof problemReportSchema>;

/** A report that names a wrong patient or a wrong medicine/dose is a safety concern: the screen tells the clinician not to use the draft. */
export function isSafetyCategory(c: ProblemCategory): boolean {
  return c === "wrong_patient" || c === "wrong_medicine_or_dose";
}

export const problemCountsSchema = z.object({
  total: z.number(),
  by_category: z.record(z.string(), z.number()),
  by_kind: z.record(z.string(), z.number()),
});
