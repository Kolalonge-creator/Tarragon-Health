import { z } from "zod";

/**
 * Procedures and family history a person enters about themselves (S43, spec 2.2).
 * The database fixes source (patient), recorded_by and verification on insert, so
 * nothing here can claim a clinician stood behind an entry: these schemas only
 * keep the text sane before it is sent.
 */
export const FAMILY_RELATIONSHIPS = [
  "mother",
  "father",
  "sibling",
  "child",
  "maternal_grandmother",
  "maternal_grandfather",
  "paternal_grandmother",
  "paternal_grandfather",
  "aunt_or_uncle",
  "other",
] as const;
export type FamilyRelationship = (typeof FAMILY_RELATIONSHIPS)[number];

function currentYear(): number {
  return new Date().getFullYear();
}

export const procedureInputSchema = z.object({
  name: z.string().trim().min(1, "Say what was done").max(200),
  /** A rough year is enough: many people only remember the year. */
  year: z.coerce
    .number()
    .int()
    .min(1900)
    .refine((y) => y <= currentYear(), "That year has not happened yet")
    .optional(),
  facility: z.string().trim().max(200).optional(),
});
export type ProcedureInput = z.infer<typeof procedureInputSchema>;

export const familyHistoryInputSchema = z.object({
  condition: z.string().trim().min(1, "Say which condition").max(120),
  relationship: z.enum(FAMILY_RELATIONSHIPS),
  onsetAge: z.coerce.number().int().min(0).max(120).optional(),
});
export type FamilyHistoryInput = z.infer<typeof familyHistoryInputSchema>;

export const removeHistoryItemSchema = z.object({
  kind: z.enum(["procedure", "family_history"]),
  id: z.string().uuid(),
});
