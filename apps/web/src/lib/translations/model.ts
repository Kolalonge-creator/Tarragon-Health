import { z } from "zod";

/** S80a: translation status (spec 25.1). The database owns the state machine; the screen only offers the next legal step. */
export const STATES = ["draft", "native_reviewed", "clinical_reviewed"] as const;
export type TranslationState = (typeof STATES)[number];

export const translationRowSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  language: z.string(),
  is_clinical: z.boolean(),
  state: z.enum(STATES),
  reviewed_at: z.string().nullable(),
});
export type TranslationRow = z.infer<typeof translationRowSchema>;
export const translationRowsSchema = z.array(translationRowSchema);

export const NOTICES = ["reviewed", "failed", "denied"] as const;
export type Notice = (typeof NOTICES)[number];
export const asNotice = (v: string | undefined): Notice | null => (NOTICES as readonly string[]).includes(v ?? "") ? (v as Notice) : null;

export const reviewFormSchema = z.object({ id: z.string().uuid(), state: z.enum(STATES) });

/** The next legal steps from a state, mirroring public.review_translation (the server is the real gate). */
export function nextSteps(state: TranslationState): TranslationState[] {
  if (state === "draft") return ["native_reviewed"];
  if (state === "native_reviewed") return ["clinical_reviewed", "draft"];
  return ["draft"];
}
