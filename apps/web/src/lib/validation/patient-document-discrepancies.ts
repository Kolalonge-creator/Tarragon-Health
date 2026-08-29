import { z } from "zod";

/**
 * The 4 non-open resolution verdicts a clinician may resolve a discrepancy
 * to — matches public.document_discrepancy_status minus 'open' (a
 * discrepancy is created open; resolve_patient_document_discrepancy itself
 * also rejects 'open', this just gives the same rule a friendly client-side
 * message instead of a raw RPC error).
 */
export const DISCREPANCY_RESOLUTION_STATUSES = [
  "document_confirmed_correct",
  "existing_confirmed_correct",
  "both_valid",
  "dismissed",
] as const;

export type DiscrepancyResolutionStatus = (typeof DISCREPANCY_RESOLUTION_STATUSES)[number];

/** A clinician flags a conflict between a document and the existing
 * structured record. Mirrors flag_patient_document_discrepancy's own
 * parameters — see the RPC (20260829110400_patient_document_discrepancies.sql)
 * for what each becomes. */
export const flagDocumentDiscrepancySchema = z.object({
  document_id: z.string().uuid(),
  field_description: z.string().trim().min(1, "Describe what conflicts").max(500),
  existing_value: z.string().trim().max(500).optional(),
  document_value: z.string().trim().max(500).optional(),
  conflicting_table: z.string().trim().max(200).optional(),
  conflicting_record_id: z.string().uuid().optional(),
});
export type FlagDocumentDiscrepancyInput = z.infer<typeof flagDocumentDiscrepancySchema>;

/** A clinician resolves a previously flagged discrepancy. resolve_patient_
 * document_discrepancy requires a non-empty note and rejects 'open' — both
 * enforced again here so the client gets a friendly message first. */
export const resolveDocumentDiscrepancySchema = z.object({
  discrepancy_id: z.string().uuid(),
  status: z.enum(DISCREPANCY_RESOLUTION_STATUSES),
  resolution_note: z.string().trim().min(1, "A resolution note is required").max(1000),
});
export type ResolveDocumentDiscrepancyInput = z.infer<typeof resolveDocumentDiscrepancySchema>;

/** A clinician archives a document out of the working record.
 * archive_patient_document requires a non-empty reason. */
export const archivePatientDocumentSchema = z.object({
  document_id: z.string().uuid(),
  reason: z.string().trim().min(1, "An archive reason is required").max(500),
});
export type ArchivePatientDocumentInput = z.infer<typeof archivePatientDocumentSchema>;

/** A clinician records their review verdict on an OCR classification
 * mismatch (patient_document_extractions.classification_status =
 * 'needs_review'). */
export const reviewDocumentClassificationSchema = z.object({
  extraction_id: z.string().uuid(),
  review_note: z.string().trim().min(1, "A review note is required").max(1000),
});
export type ReviewDocumentClassificationInput = z.infer<typeof reviewDocumentClassificationSchema>;
