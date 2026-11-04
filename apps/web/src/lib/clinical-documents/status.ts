/**
 * What an intake status means, in plain words (clinical document engine). One list for every screen, so a coordinator, a clinician
 * and later the patient never see two different descriptions of the same state. Staff wording never claims a doctor has looked
 * at something unless the status says a clinician has acted (`reviewed`).
 */
export const CLINICAL_DOCUMENT_STATUSES = [
  "uploaded",
  "processing",
  "processed",
  "awaiting_verification",
  "doctor_review_required",
  "reviewed",
  "processing_failed",
  "superseded",
] as const;

export type ClinicalDocumentStatus = (typeof CLINICAL_DOCUMENT_STATUSES)[number];

export const STAFF_STATUS_LABEL: Record<ClinicalDocumentStatus, string> = {
  uploaded: "Uploaded",
  processing: "Being read",
  processed: "Read by computer, not yet checked",
  awaiting_verification: "Waiting for a person to check",
  doctor_review_required: "Waiting for a doctor",
  reviewed: "Dealt with by a clinician",
  processing_failed: "Could not be read, a person will read it",
  superseded: "Replaced by a newer upload",
};

export const STATUS_TONE: Record<ClinicalDocumentStatus, "grey" | "blue" | "amber" | "green" | "red"> = {
  uploaded: "grey",
  processing: "blue",
  processed: "blue",
  awaiting_verification: "amber",
  doctor_review_required: "amber",
  reviewed: "green",
  processing_failed: "red",
  superseded: "grey",
};

export function isClinicalDocumentStatus(value: string): value is ClinicalDocumentStatus {
  return (CLINICAL_DOCUMENT_STATUSES as readonly string[]).includes(value);
}

/** Database refusals from find_patient_for_upload / coordinator_submit_lab_report / correct_clinical_document_metadata, in words. */
const REFUSALS: Record<string, string> = {
  find_patient_query_too_short: "Type at least 3 characters.",
  find_patient_name_needs_date_of_birth: "To search by name, add the date of birth too. A name alone can match the wrong person.",
  identity_name_mismatch: "The name on the report does not match this patient. Check you picked the right person.",
  identity_date_of_birth_mismatch: "The date of birth on the report does not match this patient. Do not upload it to this record.",
  identity_patient_number_mismatch: "The patient number on the report does not match this patient. Do not upload it to this record.",
  identity_second_identifier_required: "Enter the date of birth or the patient number printed on the report, as well as the name.",
  identity_date_invalid: "The date of birth is not a valid date.",
  source_facility_required: "Say which laboratory or centre the report came from.",
  investigation_date_in_future: "The test date cannot be in the future.",
  clinical_document_already_reviewed: "A clinician has already dealt with this report, so its details can no longer be changed here.",
  "A reason is required": "Give a short reason for the change.",
  investigation_date_required: "Enter the test date. It cannot be in the future.",
  manual_source_required: "Say where the values came from.",
  manual_rows_required: "Add at least one result.",
  manual_rows_invalid: "One of the results could not be read. Check each row and try again.",
  lab_file_path_invalid: "The file could not be saved. Try again.",
};

export function describeDocumentRefusal(error: { message?: string } | null | undefined, fallback: string): string {
  const message = error?.message ?? "";
  for (const [code, words] of Object.entries(REFUSALS)) if (message.includes(code)) return words;
  if (message.includes("Not permitted") || message.includes("care coordinator")) return "You do not have access to that.";
  return fallback;
}
