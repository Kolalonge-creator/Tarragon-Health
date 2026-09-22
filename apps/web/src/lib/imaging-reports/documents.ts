import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export const IMAGING_REPORT_BUCKET = "imaging-reports";

export interface ImagingReportDocumentView {
  id: string;
  source: Database["public"]["Enums"]["imaging_report_document_source"];
  originalFilename: string | null;
  mimeType: string | null;
  note: string | null;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  /** Deterministic, patient-visible summary status — never a doctor opinion.
   * See lib/imaging-reports/extraction-actions.ts (AI-016). */
  aiSummaryStatus: Database["public"]["Enums"]["lab_result_ai_summary_status"];
  /** The radiologist's own Impression/Conclusion, verbatim. Shown regardless
   * of flagged/ready when present. */
  aiImpressionText: string | null;
  aiSummaryGeneratedAt: string | null;
  /** Short-lived signed URL for the file, or null if it could not be signed. */
  signedUrl: string | null;
  isPdf: boolean;
}

/**
 * Mint a short-lived signed URL for an imaging report document's storage
 * object. Uses the service-role client because org staff have no
 * storage-object read policy (the bucket's policies only let a patient read
 * their own uid folder) — the row-level RLS on imaging_report_documents is
 * the real authorisation gate, so the CALLER must already have read the row
 * through their own RLS-scoped session before asking for a URL. Never
 * returns a public URL. Mirrors lib/ecg-reports/documents.ts's
 * signEcgReportPath exactly.
 */
export async function signImagingReportPath(path: string): Promise<string | null> {
  const service = createServiceRoleClient();
  const { data } = await service.storage.from(IMAGING_REPORT_BUCKET).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

/**
 * Load a patient's imaging report documents (RLS-scoped to the passed
 * caller client — a patient sees their own, org staff see org patients')
 * and attach a signed URL to each. Newest first. Mirrors
 * lib/ecg-reports/documents.ts's loadEcgReportDocuments exactly.
 */
export async function loadImagingReportDocuments(
  supabase: SupabaseClient<Database>,
  patientId: string,
): Promise<ImagingReportDocumentView[]> {
  const { data: rows } = await supabase
    .from("imaging_report_documents")
    .select(
      "id, source, original_filename, mime_type, note, created_at, file_path, reviewed_by, reviewed_at, review_note, ai_summary_status, ai_impression_text, ai_summary_generated_at",
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
      aiSummaryStatus: row.ai_summary_status,
      aiImpressionText: row.ai_impression_text,
      aiSummaryGeneratedAt: row.ai_summary_generated_at,
      signedUrl: await signImagingReportPath(row.file_path),
      isPdf: row.mime_type === "application/pdf",
    })),
  );
}
