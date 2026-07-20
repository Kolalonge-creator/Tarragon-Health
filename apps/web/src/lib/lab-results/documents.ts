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
      "id, source, original_filename, mime_type, note, created_at, file_path, reviewed_by, reviewed_at, review_note",
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
      signedUrl: await signResultDocumentPath(row.file_path),
      isPdf: row.mime_type === "application/pdf",
    })),
  );
}
