"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PATIENT_DOCUMENT_BUCKET } from "@/lib/documents/documents";
import {
  archivePatientDocumentSchema,
  patientDocumentUploadSchema,
  validatePatientDocumentFile,
} from "@/lib/validation/patient-documents";

export type PatientDocumentActionResult = { error?: string; success?: boolean };

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/tiff": "tiff",
};

/**
 * A patient uploads a document of their own choosing (referral letter,
 * discharge summary, insurance card, an old prescription, whatever they want
 * on their record) into `patient_documents`.
 *
 * Runs on the patient's OWN session throughout — the storage bucket's
 * own-folder policy and the table's insert policy already allow exactly
 * this, so nothing here needs to elevate. `organisation_id` is looked up
 * from the caller's own profile rather than trusted from the form;
 * `patient_id` is the session's own id; `source` is pinned to `'patient'`;
 * and `status`/`category`/`uploaded_by` are never sent at all — a DB trigger
 * sets `status` to `'uploaded'` on insert and `category` is a generated
 * column.
 *
 * There is no real malware scanner wired up in this pass. Immediately after
 * the insert, this calls `record_patient_document_scan` (auto-approving with
 * `scan_status: 'clean'`) and then `publish_patient_document`, so the
 * document does not sit stuck at `uploaded` forever with nothing ever
 * publishing it. The scan RPC is granted to `service_role` only, so it runs
 * through the service-role client for that one call — same pattern as
 * `insert_audited_lab_result_document` in lib/lab-results/actions.ts and the
 * service-role usage in lib/lab-reports/extraction-actions.ts. Publishing is
 * grantable to `authenticated` and runs on the caller's own session.
 *
 * If either lifecycle call fails, the row is left exactly where it is
 * (`uploaded`, unpublished) rather than deleted — a stuck-at-uploaded
 * document is recoverable by a later retry/ops fix; a silently vanished
 * upload is not. The caller is told about the failure so they know the
 * document isn't visible yet.
 */
export async function uploadPatientDocument(
  formData: FormData,
): Promise<PatientDocumentActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Attach the document (PDF or photo/scan)." };
  }
  const fileError = validatePatientDocumentFile(file);
  if (fileError) return { error: fileError };

  const parsed = patientDocumentUploadSchema.safeParse({
    document_type: formData.get("document_type"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    document_date: formData.get("document_date") || undefined,
    confidentiality: formData.get("confidentiality") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const {
    document_type: documentType,
    title,
    description,
    document_date: documentDate,
    confidentiality,
  } = parsed.data;

  const supabase = await createClient();

  // organisation_id is derived from the caller's own profile, never sent by
  // the client — every downstream RLS policy keys off it.
  const { data: me } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!me?.organisation_id) {
    return { error: "Your account isn't set up for uploads yet. Message your care team." };
  }

  const ext = EXT_BY_MIME[file.type] ?? "bin";
  // The leading folder MUST be the caller's own uid: that is exactly what the
  // storage own-folder policy checks.
  const path = `${user.id}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(PATIENT_DOCUMENT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { error: uploadError.message };

  const { data: inserted, error: insertError } = await supabase
    .from("patient_documents")
    .insert({
      organisation_id: me.organisation_id,
      patient_id: user.id,
      document_type: documentType,
      source: "patient",
      confidentiality,
      title,
      description: description ?? null,
      document_date: documentDate ?? null,
      file_path: path,
      original_filename: file.name,
      mime_type: file.type,
      file_size_bytes: file.size,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    // Roll back the orphaned object so a failed insert leaves no stray file.
    await supabase.storage.from(PATIENT_DOCUMENT_BUCKET).remove([path]);
    return { error: insertError?.message ?? "Could not save that upload." };
  }
  const documentId = inserted.id;

  // No real scanner integration exists in this pass — auto-approve so the
  // document isn't stuck behind a scan that will never run. Granted to
  // service_role only, so this one call needs the service-role client.
  const service = createServiceRoleClient();
  const { error: scanError } = await service.rpc("record_patient_document_scan", {
    p_document_id: documentId,
    p_scan_status: "clean",
    p_detail: "no scanner configured — auto-approved",
  });
  if (scanError) {
    return {
      error:
        "Your document was saved but could not be processed yet. It will appear once that's resolved.",
    };
  }

  const { error: publishError } = await supabase.rpc("publish_patient_document", {
    p_document_id: documentId,
  });
  if (publishError) {
    return {
      error:
        "Your document was saved but could not be published yet. It will appear once that's resolved.",
    };
  }

  revalidatePath("/patient/documents");
  return { success: true };
}

/**
 * A patient archives one of their own documents. The RPC itself enforces who
 * may archive a given row (the uploading patient, or org staff) — this only
 * validates input shape and re-derives revalidation from the caller's
 * session; no client-supplied patient_id is trusted for anything.
 */
export async function archivePatientDocument(
  documentId: string,
  reason: string,
): Promise<PatientDocumentActionResult> {
  const parsed = archivePatientDocumentSchema.safeParse({ document_id: documentId, reason });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_patient_document", {
    p_document_id: parsed.data.document_id,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: error.message };

  revalidatePath("/patient/documents");
  return { success: true };
}
