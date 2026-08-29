import { z } from "zod";

/**
 * Form/validation schema for admin-set document-retention policy rows
 * (public.document_retention_policies). One row per (organisation_id,
 * document_type) — organisation_id is always server-derived from the
 * caller's own profile, never accepted from the client, and set_by is
 * stamped by a DB trigger on insert, so neither field appears here.
 */
export const DOCUMENT_TYPES = [
  "laboratory_report",
  "imaging_report",
  "referral_letter",
  "consultation_note",
  "prescription",
  "discharge_summary",
  "consent_form",
  "invoice",
  "insurance_document",
  "identification_document",
  "clinical_photograph",
  "other",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Human labels for the document types, shown in the policy form's select. */
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  laboratory_report: "Laboratory report",
  imaging_report: "Imaging report",
  referral_letter: "Referral letter",
  consultation_note: "Consultation note",
  prescription: "Prescription",
  discharge_summary: "Discharge summary",
  consent_form: "Consent form",
  invoice: "Invoice",
  insurance_document: "Insurance document",
  identification_document: "Identification document",
  clinical_photograph: "Clinical photograph",
  other: "Other",
};

export const documentRetentionPolicySchema = z.object({
  document_type: z.enum(DOCUMENT_TYPES),
  retention_years: z.coerce.number().int().positive(),
  // Never a bare number with no justification — the regulation, contract
  // clause, or internal policy that set this retention period.
  basis: z.string().trim().min(1).max(500),
  active: z.boolean().optional().default(true),
});

export type DocumentRetentionPolicyInput = z.infer<typeof documentRetentionPolicySchema>;
