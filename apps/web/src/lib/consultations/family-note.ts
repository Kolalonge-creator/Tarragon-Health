import { z } from "zod";
import { FAMILY_NOTE_MAX } from "@tarragon/i18n";

/** What the doctor's "line for the family" form may send. Trimmed first; 1 to 280 characters, as the database CHECK says. */
export const familyNoteInputSchema = z.object({
  encounterId: z.string().uuid(),
  body: z.string().trim().min(1).max(FAMILY_NOTE_MAX),
});
export type FamilyNoteInput = z.infer<typeof familyNoteInputSchema>;

export type FamilyNoteFailReason = "invalid" | "too_long" | "signed_out" | "not_allowed" | "failed";
export type FamilyNoteResult = { ok: true } | { ok: false; reason: FamilyNoteFailReason };

/** The latest line this doctor saved for this consultation, read under the author's own RLS policy. */
export const savedFamilyNoteSchema = z.object({ body: z.string(), created_at: z.string() });
export type SavedFamilyNote = z.infer<typeof savedFamilyNoteSchema>;
