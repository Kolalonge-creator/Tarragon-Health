import { z } from "zod";

/**
 * Input for recording a staff check of the MDCN register (S76, decision S-18). No MDCN API is used or claimed: a
 * person looks the clinician up on the register and records what they saw. The database decides who may record it.
 */
export const REGISTER_RESULTS = ["good_standing", "conditions", "not_found", "suspended_or_erased"] as const;
export type RegisterResult = (typeof REGISTER_RESULTS)[number];

export const REGISTER_RESULT_LABEL: Record<RegisterResult, string> = {
  good_standing: "On the register, in good standing",
  conditions: "On the register, with conditions",
  not_found: "Not found on the register",
  suspended_or_erased: "Suspended or erased",
};

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();

export const licenceVerificationSchema = z
  .object({
    staffId: z.string().uuid(),
    folio: z.string().trim().min(2, "Enter the folio number you saw on the register."),
    result: z.enum(REGISTER_RESULTS),
    evidenceDocumentId: z.string().uuid().nullable(),
    notes: optionalText,
  })
  .refine((v) => v.evidenceDocumentId !== null || (v.notes !== null && v.notes.length >= 10), {
    message: "Attach the evidence document, or write at least 10 characters about what you checked.",
    path: ["notes"],
  });

export type LicenceVerificationInput = z.infer<typeof licenceVerificationSchema>;

/** Arguments for public.record_licence_verification. The check date and next due date are left to the database. */
export function toVerificationRpcArgs(input: LicenceVerificationInput): Record<string, unknown> {
  return {
    p_staff: input.staffId,
    p_folio: input.folio,
    p_register_result: input.result,
    p_evidence_document: input.evidenceDocumentId,
    p_notes: input.notes,
  };
}
