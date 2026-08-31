import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export const RESULT_DOC_BUCKET = "lab-result-documents";

export interface ResultDocumentView {
  id: string;
  source: Database["public"]["Enums"]["lab_result_document_source"];
  originalFilename: string | null;
  mimeType: string | null;
  note: string | null;
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
  aiSummaryStatus: Database["public"]["Enums"]["lab_result_ai_summary_status"];
  aiSummaryGeneratedAt: string | null;
  /** Short-lived signed URL for the file, or null if it could not be signed. */
  signedUrl: string | null;
  isPdf: boolean;
}

/**
 * Mint a short-lived signed URL for a result document's storage object. Uses
 * the service-role client because org staff have no storage-object read policy
 * (the bucket's policies only let a patient read their own uid folder) — the
 * row-level RLS on lab_result_documents is the real authorisation gate, so the
 * CALLER must already have read the row through their own RLS-scoped session
 * before asking for a URL. Never returns a public URL.
 */
export async function signResultDocumentPath(path: string): Promise<string | null> {
  const service = createServiceRoleClient();
  const { data } = await service.storage.from(RESULT_DOC_BUCKET).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
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
      "id, source, original_filename, mime_type, note, created_at, file_path, reviewed_by, reviewed_at, review_note, patient_interpretation, next_steps, interpretation_sent_at, acknowledgement_status, action_completed_at, ai_summary_status, ai_summary_generated_at",
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (!rows || rows.length === 0) return [];

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      source: row.source,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      note: row.note,
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
      signedUrl: await signResultDocumentPath(row.file_path),
      isPdf: row.mime_type === "application/pdf",
    })),
  );
}
