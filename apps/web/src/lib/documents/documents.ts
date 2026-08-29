import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export const PATIENT_DOCUMENT_BUCKET = "patient-documents";

export interface PatientDocumentView {
  id: string;
  documentType: Database["public"]["Enums"]["patient_document_type"];
  category: Database["public"]["Enums"]["patient_document_category"];
  confidentiality: Database["public"]["Enums"]["patient_document_confidentiality"];
  title: string;
  description: string | null;
  documentDate: string | null;
  status: Database["public"]["Enums"]["patient_document_status"];
  source: Database["public"]["Enums"]["patient_document_source"];
  originalFilename: string | null;
  mimeType: string | null;
  isPdf: boolean;
  /** Short-lived signed URL for the file, or null if it could not be signed
   * (e.g. no file_path, or the storage object is missing). */
  signedUrl: string | null;
  createdAt: string;
  version: number;
  /** Set when a newer version of this document exists — the UI uses this to
   * point the reader at the current version instead of a stale one. */
  supersededById: string | null;
}

/**
 * Mint a short-lived signed URL for a patient document's storage object.
 * Uses the service-role client because org staff have no storage-object read
 * policy (the bucket's policies only let a patient read their own uid
 * folder) — the row-level RLS on patient_documents is the real authorisation
 * gate, so the CALLER must already have read the row through their own
 * RLS-scoped session before asking for a URL. Never returns a public URL.
 * Mirrors lib/lab-results/documents.ts's signResultDocumentPath and
 * lib/ecg-reports/documents.ts's signEcgReportPath.
 */
export async function signPatientDocumentPath(path: string): Promise<string | null> {
  const service = createServiceRoleClient();
  const { data } = await service.storage.from(PATIENT_DOCUMENT_BUCKET).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

/**
 * Load a patient's documents (RLS-scoped to the passed caller client — a
 * patient sees their own, org staff see org patients') and attach a signed
 * URL to each. Ordered by document_date desc (nulls last), then uploaded_at
 * desc. Excludes `rejected` documents — a failed upload isn't worth showing.
 */
export async function loadPatientDocuments(
  supabase: SupabaseClient<Database>,
  patientId: string,
): Promise<PatientDocumentView[]> {
  const { data: rows } = await supabase
    .from("patient_documents")
    .select(
      "id, document_type, category, confidentiality, title, description, document_date, status, source, original_filename, mime_type, file_path, created_at, uploaded_at, version, superseded_by_id",
    )
    .eq("patient_id", patientId)
    .neq("status", "rejected")
    .order("document_date", { ascending: false, nullsFirst: false })
    .order("uploaded_at", { ascending: false });

  if (!rows || rows.length === 0) return [];

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      documentType: row.document_type,
      category: row.category,
      confidentiality: row.confidentiality,
      title: row.title,
      description: row.description,
      documentDate: row.document_date,
      status: row.status,
      source: row.source,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      isPdf: row.mime_type === "application/pdf",
      signedUrl: row.file_path ? await signPatientDocumentPath(row.file_path) : null,
      createdAt: row.created_at,
      version: row.version,
      supersededById: row.superseded_by_id,
    })),
  );
}
