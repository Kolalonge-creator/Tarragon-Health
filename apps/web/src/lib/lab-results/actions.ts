"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import type { Database } from "@tarragon/shared";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { RESULT_DOC_BUCKET } from "@/lib/lab-results/documents";
import {
  markResultReviewedSchema,
  staffResultUploadSchema,
  validateResultDocFile,
} from "@/lib/validation/lab-result-documents";

type DocumentSource = Database["public"]["Enums"]["lab_result_document_source"];
export type ResultUploadResult = { error?: string; success?: boolean };

/**
 * Which staff account roles may upload a result on a patient's behalf, and the
 * document `source` each is recorded as. Derived from the caller's real role —
 * never trusted from the client. Care Coordinators are deliberately absent: the
 * non-clinical write guardrail (CLAUDE.md) keeps them read-only here, enforced
 * at this app layer exactly like medications/protocol signing.
 */
const UPLOADER_SOURCE: Partial<Record<string, DocumentSource>> = {
  lab_liaison: "lab_liaison",
  clinician: "clinician",
  doctor: "clinician",
  admin: "admin",
};

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

/**
 * A staff member (Lab Liaison Officer, clinician/doctor, or admin) uploads a
 * lab result document into a patient's record — the emailed-result path for
 * labs that never log into Tarragon.
 *
 * Storage + row writes go through the service-role client: the file lands under
 * the *patient's* uid folder, which the own-folder storage policy forbids a
 * staff session from writing directly. Authorisation is checked here first
 * (role gate + the patient must be readable in the caller's org via their own
 * RLS-scoped session); uploaded_by is pinned to the acting staff id, and the
 * insert trigger raises the clinician-review alert + notifies the patient.
 */
export async function uploadResultDocumentForPatient(
  formData: FormData,
): Promise<ResultUploadResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const source = me ? UPLOADER_SOURCE[me.role] : undefined;
  if (!source) {
    return {
      error:
        "Your role can't upload results for a patient. Ask a Lab Liaison Officer, clinician, or admin.",
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Attach the result file (PDF or image)." };
  }
  const fileError = validateResultDocFile(file);
  if (fileError) return { error: fileError };

  const parsed = staffResultUploadSchema.safeParse({
    patient_id: formData.get("patient_id"),
    lab_order_id: formData.get("lab_order_id") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { patient_id: patientId, lab_order_id: labOrderId, note } = parsed.data;

  // The patient must be visible to the caller under their own RLS-scoped session
  // — i.e. genuinely a patient in the caller's organisation. This is the real
  // cross-tenant gate (same as any org-staff patient lookup in this app).
  const { data: patient } = await supabase
    .from("profiles")
    .select("id, organisation_id")
    .eq("id", patientId)
    .eq("role", "patient")
    .maybeSingle();
  if (!patient || !patient.organisation_id) {
    return { error: "That patient isn't in your organisation." };
  }

  const service = createServiceRoleClient();
  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const path = `${patientId}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await service.storage
    .from(RESULT_DOC_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { error: uploadError.message };

  const { error: insertError } = await service.from("lab_result_documents").insert({
    organisation_id: patient.organisation_id,
    patient_id: patientId,
    lab_order_id: labOrderId ?? null,
    file_path: path,
    original_filename: file.name,
    mime_type: file.type,
    file_size_bytes: file.size,
    source,
    uploaded_by: user.id,
    note: note ?? null,
  });
  if (insertError) {
    // Roll back the orphaned object so a failed insert leaves no stray file.
    await service.storage.from(RESULT_DOC_BUCKET).remove([path]);
    return { error: insertError.message };
  }

  revalidatePath("/lab-liaison");
  revalidatePath(`/clinician/patients/${patientId}`);
  return { success: true };
}

/**
 * A clinician marks an uploaded document reviewed (they've interpreted it).
 * Runs through the clinician's own RLS-scoped session so the insert-guard
 * trigger stamps reviewed_by = their auth.uid() (never spoofable). Gated on an
 * active clinical_staff record — a Care Coordinator (org staff, non-clinical)
 * cannot review, matching the vaccination-verification pattern. Interpreting a
 * result is a clinical judgement; recording an abnormal finding is a separate,
 * deliberate step via the screening-result form (never auto-derived here).
 */
export async function markResultDocumentReviewed(input: {
  documentId: string;
  note?: string;
}): Promise<ResultUploadResult> {
  const parsed = markResultReviewedSchema.safeParse({
    document_id: input.documentId,
    note: input.note,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { document_id: documentId, note } = parsed.data;

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const supabase = await createClient();

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff) {
    return { error: "Only a Tarragon care-team doctor can mark a result reviewed." };
  }

  const { data: doc, error: docError } = await supabase
    .from("lab_result_documents")
    .select("id, patient_id, reviewed_at, clinician_alert_id")
    .eq("id", documentId)
    .maybeSingle();
  if (docError || !doc) return { error: "Document not found." };
  if (doc.reviewed_at) return { error: "This result was already marked reviewed." };

  const { error: updateError } = await supabase
    .from("lab_result_documents")
    .update({ reviewed_at: new Date().toISOString(), review_note: note ?? null })
    .eq("id", documentId);
  if (updateError) return { error: updateError.message };

  // Resolve the linked review alert — best-effort, never blocks the review.
  if (doc.clinician_alert_id) {
    await supabase
      .from("clinician_alerts")
      .update({
        status: "resolved",
        acknowledged_by: user.id,
        acknowledged_at: new Date().toISOString(),
      })
      .eq("id", doc.clinician_alert_id);
  }

  revalidatePath("/clinician");
  revalidatePath(`/clinician/patients/${doc.patient_id}`);
  return { success: true };
}
