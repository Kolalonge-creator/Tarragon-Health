import "server-only";
import { randomUUID } from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { LAB_RESULT_BUCKET, LAB_RESULT_EXT, validateLabResultFile } from "@/lib/lab-results/structured";
import { verifyResultDocSignature } from "@/lib/validation/result-doc-signature";
import { fileSha256 } from "@/lib/clinical-documents/fingerprint";

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
  const { error } = await createServiceRoleClient().storage.from(LAB_RESULT_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
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
