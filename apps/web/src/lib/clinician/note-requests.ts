import { z } from "zod";

/** Schemas and parsers for the clinician side of note amendment, protection and patient requests (S22). */

export const AMENDMENT_KINDS = ["addendum", "late_entry", "correction"] as const;
export type AmendmentKind = (typeof AMENDMENT_KINDS)[number];
export const AMENDMENT_KIND_LABEL: Record<AmendmentKind, string> = {
  addendum: "Addendum (add something new)",
  late_entry: "Late entry (written after the visit)",
  correction: "Correction (fix a mistake)",
};

export const CORRECTION_OUTCOMES = ["accepted", "annotated", "declined"] as const;
export type CorrectionOutcome = (typeof CORRECTION_OUTCOMES)[number];

export const createAmendmentSchema = z.object({
  noteId: z.string().uuid(),
  kind: z.enum(AMENDMENT_KINDS),
  reason: z.string().trim().min(10, "Please give a reason of 10 characters or more.").max(1000),
});

export const setProtectedSchema = z.object({ noteId: z.string().uuid(), protected: z.boolean() });

export const decideReleaseSchema = z
  .object({
    noteId: z.string().uuid(),
    release: z.boolean(),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.release || (v.reason?.length ?? 0) >= 10, {
    message: "Please give a reason of 10 characters or more for withholding the note.",
    path: ["reason"],
  });

export const respondCorrectionSchema = z.object({
  requestId: z.string().uuid(),
  outcome: z.enum(CORRECTION_OUTCOMES),
  response: z.string().trim().min(10, "Please write a response of 10 characters or more.").max(2000),
});

export const noteRequestsSchema = z.object({
  releases: z.array(z.object({ note_id: z.string().uuid(), requested_at: z.string(), is_protected: z.boolean() })),
  corrections: z.array(
    z.object({ id: z.string().uuid(), note_id: z.string().uuid(), request_text: z.string(), due_at: z.string().nullable() }),
  ),
});
export type NoteRequests = z.infer<typeof noteRequestsSchema>;

export type NoteActionState = { error?: string; message?: string } | undefined;
