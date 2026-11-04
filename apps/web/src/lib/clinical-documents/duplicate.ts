/**
 * The duplicate-file refusal (clinical document engine step 1). Kept apart from fingerprint.ts, which needs Node's crypto, so
 * client-safe modules (lib/lab-results/structured.ts) can map the error to words.
 */
/** The error code and message private.cde_open_intake raises for a file already in the patient's record. */
export const DUPLICATE_DOCUMENT_CODE = "clinical_document_duplicate";

/** The unique index that backstops the same refusal when two uploads of one file race each other. */
export const DUPLICATE_DOCUMENT_INDEX = "clinical_documents_one_file_per_patient";

export const DUPLICATE_DOCUMENT_MESSAGE =
  "This file is already in this record, so it was not added again. If it is a newer report, check you picked the right file.";

/** True when a Supabase/PostgREST error is the duplicate refusal (unique violation raised by the intake trigger). */
export function isDuplicateDocumentError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return message.includes(DUPLICATE_DOCUMENT_CODE) || message.includes(DUPLICATE_DOCUMENT_INDEX);
}
