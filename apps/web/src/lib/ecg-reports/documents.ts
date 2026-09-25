import "server-only";
import { signStoragePaths } from "@/lib/supabase/sign-storage-paths";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export const ECG_REPORT_BUCKET = "ecg-reports";

export interface EcgReportDocumentView {
  id: string;
  source: Database["public"]["Enums"]["ecg_report_document_source"];
  originalFilename: string | null;
  mimeType: string | null;
  note: string | null;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  /** Deterministic, patient-visible summary status — never a doctor opinion.
   * See lib/ecg-reports/ai-summary.ts. */
  aiSummaryStatus: Database["public"]["Enums"]["ai_document_summary_status"];
  /** The ECG machine's own printed rhythm statement, verbatim — populated
   * whenever the extraction resolved one, regardless of aiSummaryStatus.
   * Null when no statement was printed/read. */
  aiRhythmStatement: string | null;
  aiSummaryGeneratedAt: string | null;
  /** Short-lived signed URL for the file, or null if it could not be signed. */
  signedUrl: string | null;
  isPdf: boolean;
}

/**
 * Load a patient's ECG documents (RLS-scoped to the passed caller client — a
 * patient sees their own, org staff see org patients') and attach a signed
 * URL to each. Newest first.
 */
export async function loadEcgReportDocuments(
  supabase: SupabaseClient<Database>,
  patientId: string,
): Promise<EcgReportDocumentView[]> {
  const { data: rows } = await supabase
    .from("ecg_report_documents")
    .select(
      "id, source, original_filename, mime_type, note, created_at, file_path, reviewed_by, reviewed_at, review_note, ai_summary_status, ai_rhythm_statement, ai_summary_generated_at",
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (!rows || rows.length === 0) return [];

  // One batched Storage call for every document's signed URL instead of one
  // request per row (see signStoragePaths).
  const signedUrlByPath = await signStoragePaths(
    ECG_REPORT_BUCKET,
    rows.map((row) => row.file_path),
    300,
  );

  return rows.map((row) => ({
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
    aiRhythmStatement: row.ai_rhythm_statement,
    aiSummaryGeneratedAt: row.ai_summary_generated_at,
    signedUrl: signedUrlByPath.get(row.file_path) ?? null,
    isPdf: row.mime_type === "application/pdf",
  }));
}
