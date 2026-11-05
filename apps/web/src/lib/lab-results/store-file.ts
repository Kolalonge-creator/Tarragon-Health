import { prepareUpload } from "@/lib/uploads/prepare-upload";
import "server-only";
import { randomUUID } from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { LAB_RESULT_BUCKET, LAB_RESULT_EXT, validateLabResultFile } from "@/lib/lab-results/structured";
import { verifyResultDocSignature } from "@/lib/validation/result-doc-signature";
import { fileSha256 } from "@/lib/clinical-documents/fingerprint";
import { RESULT_DOC_BUCKET } from "@/lib/lab-results/documents";
import { validateResultDocFile } from "@/lib/validation/lab-result-documents";

/**
 * Storage for S27 lab result files, shared by the care-team, partner, patient and care-coordinator upload actions. Deliberately NOT a
 * "use server" module: an exported function there becomes a server action a browser can call, and this one writes into any
 * patient's folder with the service role. Callers check who may upload for whom first; the database function they call next is
 * the real gate.
 */

// content_sha256: computed on the server from the bytes it stored (never from the browser). team_submit_lab_result hands it to the
// intake record, which refuses a file already in this patient's record (clinical document engine step 1).
export type StoredFile = { file_path: string; original_filename: string; mime_type: string; file_size_bytes: number; content_sha256: string };

/** Stores the file in the private bucket under the patient's folder. Only the server ever reads or signs it. */
export async function storeFile(patientId: string, file: File): Promise<StoredFile | { error: string }> {
  const bad = validateLabResultFile(file);
  if (bad) return { error: bad };
  const signatureError = await verifyResultDocSignature(file);
  if (signatureError) return { error: signatureError };
  const path = `${patientId}/${randomUUID()}.${LAB_RESULT_EXT[file.type] ?? "bin"}`;
  // Bytes must match the declared type, and photo location data is removed (security audit 2026-11-05, M-4/L-4).
  const prepared = await prepareUpload(file);
  if (!prepared.ok) return { error: prepared.error };
  const { error } = await createServiceRoleClient().storage.from(LAB_RESULT_BUCKET).upload(path, prepared.upload.body, { contentType: prepared.upload.contentType, upsert: false });
  if (error) return { error: "The file could not be stored. Please try again." };
  return {
    file_path: path,
    original_filename: file.name.slice(0, 200),
    mime_type: file.type,
    file_size_bytes: file.size,
    content_sha256: await fileSha256(file),
  };
}

export async function removeFile(path: string): Promise<void> {
  await createServiceRoleClient().storage.from(LAB_RESULT_BUCKET).remove([path]);
}

/**
 * Storage for a lab_result_documents file (the patient-document bucket) written on a patient's behalf by the care team: an original
 * report, or the record of results typed in by hand (CDE-02). Same checks as a patient's own upload: declared type, size and the
 * file's own first bytes.
 */
export async function storeResultDocument(patientId: string, file: File): Promise<StoredFile | { error: string }> {
  const bad = validateResultDocFile(file);
  if (bad) return { error: bad };
  const signatureError = await verifyResultDocSignature(file);
  if (signatureError) return { error: signatureError };
  const ext = RESULT_DOC_EXT[file.type] ?? "bin";
  const path = `${patientId}/${randomUUID()}.${ext}`;
  // Bytes must match the declared type, and photo location data is removed (security audit 2026-11-05, M-4/L-4).
  const prepared = await prepareUpload(file);
  if (!prepared.ok) return { error: prepared.error };
  const { error } = await createServiceRoleClient().storage.from(RESULT_DOC_BUCKET).upload(path, prepared.upload.body, { contentType: prepared.upload.contentType, upsert: false });
  if (error) return { error: "The file could not be stored. Please try again." };
  return {
    file_path: path,
    original_filename: file.name.slice(0, 200),
    mime_type: file.type,
    file_size_bytes: file.size,
    content_sha256: await fileSha256(file),
  };
}

export async function removeResultDocument(path: string): Promise<void> {
  await createServiceRoleClient().storage.from(RESULT_DOC_BUCKET).remove([path]);
}

const RESULT_DOC_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};
