import "server-only";
import { signStoragePaths } from "@/lib/supabase/sign-storage-paths";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export const RESULT_DOC_BUCKET = "lab-result-documents";

export interface ResultDocumentView {
  id: string;
  source: Database["public"]["Enums"]["lab_result_document_source"];
  originalFilename: string | null;
  mimeType: string | null;
  note: string | null;
  /** The test type the patient (or the per-test checklist) named at upload —
   * e.g. "hba1c", "kft" — or null when it wasn't known/asked. See
   * apps/web/src/lib/labs/test-code-labels.ts for turning this into a
   * patient-readable label. */
  testCode: string | null;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  /** Doctor-authored, patient-facing explanation — null until a clinician
   * sends one via markResultDocumentReviewed. */
  patientInterpretation: string | null;
  /** Optional doctor-authored next steps, populated only when the result
   * needs the patient to do something. */
  nextSteps: string | null;
  /** Set once, alongside patientInterpretation — gates patient visibility. */
  interpretationSentAt: string | null;
  /** Care Team / Provider Workspace §5.7 — New/Opened/Reviewed/Action
   * required/Action completed. See 20260827204355_result_acknowledgement_status.sql
   * for how each state is reached; enforce_lab_result_document_update is the
   * only place that may actually move it. */
  acknowledgementStatus: Database["public"]["Enums"]["result_document_acknowledgement_status"];
  actionCompletedAt: string | null;
  /** Deterministic, patient-visible summary status — never a doctor opinion,
   * never freeform text. Distinct from patientInterpretation/acknowledgementStatus
   * above, which are both doctor-authored. See extraction-actions.ts. */
  aiSummaryStatus: Database["public"]["Enums"]["ai_document_summary_status"];
  aiSummaryGeneratedAt: string | null;
  /** Which test(s) `aiSummaryStatus = 'flagged'` refers to — label and the
   * lab's own printed range, both copied verbatim off the document. Empty
   * unless aiSummaryStatus is 'flagged'. See
   * lib/lab-reports/ai-summary.ts#FlaggedAnalyte. */
  aiFlaggedAnalytes: { label: string; reportedRange: string | null }[];
  /** Short-lived signed URL for the file, or null if it could not be signed. */
  signedUrl: string | null;
  isPdf: boolean;
  /** Module 57.14 — set when THIS document is a correction of an earlier one. */
  supersedesDocumentId: string | null;
  /** Module 57.14 — set (server-derived) when a LATER document corrected this one. The original stays fully visible; this is a pointer, not a delete. */
  supersededByDocumentId: string | null;
  supersededAt: string | null;
}

/**
 * Load a patient's result documents (RLS-scoped to the passed caller client —
 * a patient sees their own, org staff see org patients') and attach a signed
 * URL to each. Newest first.
 */
export async function loadResultDocuments(
  supabase: SupabaseClient<Database>,
  patientId: string,
): Promise<ResultDocumentView[]> {
  const { data: rows } = await supabase
    .from("lab_result_documents")
    .select(
      "id, source, original_filename, mime_type, note, test_code, created_at, file_path, reviewed_by, reviewed_at, review_note, patient_interpretation, next_steps, interpretation_sent_at, acknowledgement_status, action_completed_at, supersedes_document_id, superseded_by_document_id, superseded_at, ai_summary_status, ai_summary_generated_at, ai_flagged_analytes",
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (!rows || rows.length === 0) return [];

  // One batched Storage call for every document's signed URL instead of one
  // request per row (see signStoragePaths).
  const signedUrlByPath = await signStoragePaths(
    RESULT_DOC_BUCKET,
    rows.map((row) => row.file_path),
    300,
  );

  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    note: row.note,
    testCode: row.test_code,
    createdAt: row.created_at,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    patientInterpretation: row.patient_interpretation,
    nextSteps: row.next_steps,
    interpretationSentAt: row.interpretation_sent_at,
    acknowledgementStatus: row.acknowledgement_status,
    actionCompletedAt: row.action_completed_at,
    aiSummaryStatus: row.ai_summary_status,
    aiSummaryGeneratedAt: row.ai_summary_generated_at,
    aiFlaggedAnalytes:
      (row.ai_flagged_analytes as { label: string; reportedRange: string | null }[] | null) ?? [],
    signedUrl: signedUrlByPath.get(row.file_path) ?? null,
    isPdf: row.mime_type === "application/pdf",
    supersedesDocumentId: row.supersedes_document_id,
    supersededByDocumentId: row.superseded_by_document_id,
    supersededAt: row.superseded_at,
  }));
}
