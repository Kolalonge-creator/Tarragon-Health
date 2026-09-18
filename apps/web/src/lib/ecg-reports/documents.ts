import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
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
  /** Short-lived signed URL for the file, or null if it could not be signed. */
  signedUrl: string | null;
  isPdf: boolean;
}

/**
 * Mint a short-lived signed URL for an ECG document's storage object. Uses
 * the service-role client because org staff have no storage-object read
 * policy (the bucket's policies only let a patient read their own uid
 * folder) — the row-level RLS on ecg_report_documents is the real
 * authorisation gate, so the CALLER must already have read the row through
 * their own RLS-scoped session before asking for a URL. Never returns a
 * public URL. Mirrors lib/lab-results/documents.ts's signResultDocumentPath.
 */
export async function signEcgReportPath(path: string): Promise<string | null> {
  const service = createServiceRoleClient();
  const { data } = await service.storage.from(ECG_REPORT_BUCKET).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

/**
 * Batched form of signEcgReportPath — one Storage API call for the whole
 * list instead of one per document (mirrors
 * lib/lab-results/documents.ts's signResultDocumentPaths, same N+1 fix).
 * Returns a Map keyed by storage path; a path that failed to sign maps to
 * null rather than dropping the entry.
 */
export async function signEcgReportPaths(paths: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (paths.length === 0) return map;
  const service = createServiceRoleClient();
  const { data } = await service.storage.from(ECG_REPORT_BUCKET).createSignedUrls(paths, 300);
  for (const entry of data ?? []) {
    map.set(entry.path ?? "", entry.signedUrl ?? null);
  }
  return map;
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
      "id, source, original_filename, mime_type, note, created_at, file_path, reviewed_by, reviewed_at, review_note",
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (!rows || rows.length === 0) return [];

  // One batched Storage call for every document's signed URL instead of one
  // request per row (see signEcgReportPaths).
  const signedUrlByPath = await signEcgReportPaths(rows.map((row) => row.file_path));

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
    signedUrl: signedUrlByPath.get(row.file_path) ?? null,
    isPdf: row.mime_type === "application/pdf",
  }));
}
