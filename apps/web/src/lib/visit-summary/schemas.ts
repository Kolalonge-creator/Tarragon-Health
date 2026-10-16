import { z } from "zod";
import { AVS_ITEM_KINDS, AVS_ITEM_TEXT_MAX, AVS_TEXT_MAX } from "@tarragon/i18n";

/** Shapes for the after-visit summary (AVS): the patient read, the clinician review read, and the clinician action inputs. */

const kindSchema = z.enum(AVS_ITEM_KINDS as unknown as [string, ...string[]]);
/** Checklist params are plain values only (a name, a dose, a sentence). Anything else is dropped to an empty object. */
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const paramsSchema = z.record(z.string(), scalar);
export type ItemParams = z.infer<typeof paramsSchema>;
const readParams = paramsSchema.nullish().transform((v) => v ?? {}).catch({});

// ----- patient ---------------------------------------------------------------------------------------------

export const patientItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  params: readParams,
  custom_text: z.string().nullish().transform((v) => v ?? null),
  due_on: z.string().nullish().transform((v) => v ?? null),
  done_at: z.string().nullish().transform((v) => v ?? null),
  task_id: z.string().nullish().transform((v) => v ?? null),
});
export type PatientSummaryItem = z.infer<typeof patientItemSchema>;

export const patientSummarySchema = z.object({
  id: z.string(),
  note_id: z.string(),
  revision: z.number().int().nullish().transform((v) => v ?? 1),
  summary_text: z.string(),
  approved_at: z.string().nullish().transform((v) => v ?? null),
  approved_by_name: z.string().nullish().transform((v) => v ?? null),
  items: z.array(patientItemSchema).nullish().transform((v) => v ?? []),
});
export type PatientSummary = z.infer<typeof patientSummarySchema>;

/** Unreadable rows are dropped, never shown half-filled. */
export function parsePatientSummaries(raw: unknown): PatientSummary[] {
  if (!Array.isArray(raw)) return [];
  const out: PatientSummary[] = [];
  for (const row of raw) {
    const p = patientSummarySchema.safeParse(row);
    if (p.success) out.push(p.data);
  }
  return out;
}

// ----- clinician review ------------------------------------------------------------------------------------

export const reviewItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  params: readParams,
  custom_text: z.string().nullish().transform((v) => v ?? null),
  due_on: z.string().nullish().transform((v) => v ?? null),
  source_table: z.string().nullish().transform((v) => v ?? null),
});
export type ReviewItem = z.infer<typeof reviewItemSchema>;

export const reviewSchema = z.object({
  note_signed: z.boolean(),
  note_protected: z.boolean().nullish().transform((v) => v === true),
  stale: z.boolean().nullish().transform((v) => v === true),
  patient_can_see: z.boolean().nullish().transform((v) => v === true),
  summary: z
    .object({
      id: z.string(),
      state: z.enum(["draft", "approved", "withdrawn"]),
      revision: z.number().int(),
      summary_text: z.string(),
      approved_at: z.string().nullish().transform((v) => v ?? null),
      approved_by_name: z.string().nullish().transform((v) => v ?? null),
      withdrawn_at: z.string().nullish().transform((v) => v ?? null),
      withdrawn_reason: z.string().nullish().transform((v) => v ?? null),
    })
    .nullable(),
  items: z.array(reviewItemSchema).nullish().transform((v) => v ?? []),
});
export type VisitSummaryReview = z.infer<typeof reviewSchema>;

// ----- clinician action inputs -----------------------------------------------------------------------------

export const noteIdSchema = z.object({ noteId: z.string().uuid() });

export const draftItemSchema = z.object({
  id: z.string().uuid().optional(),
  kind: kindSchema,
  params: paramsSchema.optional(),
  customText: z.string().trim().max(AVS_ITEM_TEXT_MAX).optional(),
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-03.")
    .optional(),
});
export type DraftItemInput = z.infer<typeof draftItemSchema>;

export const saveDraftSchema = z.object({
  summaryId: z.string().uuid(),
  text: z.string().max(AVS_TEXT_MAX, "That is too long. Keep it under 4000 characters."),
  items: z.array(draftItemSchema).max(30, "Please keep the list to 30 steps or fewer."),
});

export const summaryIdSchema = z.object({ summaryId: z.string().uuid() });

export const withdrawSummarySchema = z.object({
  summaryId: z.string().uuid(),
  reason: z.string().trim().min(10, "Please give a reason of 10 characters or more.").max(1000),
});

export const doneSchema = z.object({ itemId: z.string().uuid(), done: z.boolean() });

/** Plain words for the errors the AVS functions raise. Anything else gets the generic line. */
export const AVS_ERROR_WORDS: Readonly<Record<string, string>> = {
  visit_summary_note_unsigned: "Sign the note first. A summary can only follow a signed note.",
  visit_summary_note_withdrawn: "This note was withdrawn, so it cannot have a summary.",
  visit_summary_already_approved: "This summary is already approved.",
  visit_summary_not_a_draft: "This summary is not a draft any more.",
  visit_summary_text_needed: "Write the summary in plain words before you approve it (at least 20 characters).",
  visit_summary_text_too_long: "That is too long. Keep it under 4000 characters.",
  visit_summary_reason_needed: "Please give a reason of 10 characters or more.",
  visit_summary_copy_rules: "The text breaks the plain-language rules. Check the marked words and try again.",
  "only a doctor can": "Only a doctor can do that.",
};

export function describeAvsError(error: { message?: string; code?: string } | null | undefined, fallback: string): string {
  const message = error?.message ?? "";
  for (const key of Object.keys(AVS_ERROR_WORDS)) {
    if (message.includes(key)) return AVS_ERROR_WORDS[key] as string;
  }
  if (error?.code === "42501") return "You do not have access to do that.";
  return fallback;
}
