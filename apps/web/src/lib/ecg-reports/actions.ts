"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import type { Database } from "@tarragon/shared";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { ECG_REPORT_BUCKET } from "./documents";
import { runEcgReportExtraction } from "./extraction-actions";
import {
  markEcgReportReviewedSchema,
  patientEcgUploadSchema,
  staffEcgUploadSchema,
  validateEcgDocFile,
} from "@/lib/validation/ecg-report-documents";

type DocumentSource = Database["public"]["Enums"]["ecg_report_document_source"];
export type EcgUploadResult = { error?: string; success?: boolean };

/**
 * Which staff account roles may upload an ECG on a patient's behalf, and the
 * document `source` each is recorded as. Mirrors lib/lab-results/actions.ts's
 * UPLOADER_SOURCE exactly. Care Coordinators are deliberately absent — the
 * non-clinical write guardrail (CLAUDE.md) keeps them read-only here.
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
 * 12-lead ECG into a patient's record on their behalf.
 *
 * Storage + row writes go through the service-role client: the file lands
 * under the *patient's* uid folder, which the own-folder storage policy
 * forbids a staff session from writing directly. Mirrors
 * uploadResultDocumentForPatient exactly.
 */
export async function uploadEcgReportForPatient(formData: FormData): Promise<EcgUploadResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { data: me } = await supabase
    .from("profiles")
    .select("role, organisation_id")
    .eq("id", user.id)
    .single();

  const source = me ? UPLOADER_SOURCE[me.role] : undefined;
  if (!source) {
    return {
      error: "Your role can't upload ECGs for a patient. Ask a Lab Liaison Officer, clinician, or admin.",
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Attach the ECG file (PDF or photo)." };
  }
  const fileError = validateEcgDocFile(file);
  if (fileError) return { error: fileError };

  const parsed = staffEcgUploadSchema.safeParse({
    patient_id: formData.get("patient_id"),
    lab_order_id: formData.get("lab_order_id") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { patient_id: patientId, lab_order_id: labOrderId, note } = parsed.data;

  // The org is compared explicitly, not inferred from "the caller could read
  // the row": profiles carries several permissive SELECT policies that OR
  // together, and everything below this line runs on the service-role client,
  // which has no RLS of its own. Defence in depth for the 20260905000206
  // care_access_requests disclosure, which reached exactly this seam.
  const { data: patient } = await supabase
    .from("profiles")
    .select("id, organisation_id")
    .eq("id", patientId)
    .eq("role", "patient")
    .maybeSingle();
  if (!patient || !patient.organisation_id || patient.organisation_id !== me?.organisation_id) {
    return { error: "That patient isn't in your organisation." };
  }

  const service = createServiceRoleClient();
  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const path = `${patientId}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await service.storage
    .from(ECG_REPORT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { error: uploadError.message };

  const { data: inserted, error: insertError } = await service
    .from("ecg_report_documents")
    .insert({
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
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    await service.storage.from(ECG_REPORT_BUCKET).remove([path]);
    return { error: insertError?.message ?? "Could not save that upload." };
  }

  await runEcgReportExtraction(service, {
    documentId: inserted.id,
    organisationId: patient.organisation_id,
    patientId,
    filePath: path,
    mimeType: file.type,
  });

  revalidatePath(`/clinician/patients/${patientId}`);
  return { success: true };
}

/**
 * A patient uploads their own 12-lead ECG, from whichever hospital or lab
 * they used. Mirrors uploadResultDocumentAsPatient exactly: runs through the
 * patient's OWN session (storage own-folder + row insert policies already
 * allow this, nothing here needs elevated access), source is pinned to
 * 'patient' and patient_id comes from the session, never the form.
 *
 * Uploading a file never records a clinical finding on its own — a clinician
 * reviews the extracted parameters and separately records their own read via
 * the procedural_status field on the screening result.
 */
export async function uploadEcgReportAsPatient(formData: FormData): Promise<EcgUploadResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Attach the ECG file (PDF or photo)." };
  }
  const fileError = validateEcgDocFile(file);
  if (fileError) return { error: fileError };

  const parsed = patientEcgUploadSchema.safeParse({
    lab_order_id: formData.get("lab_order_id") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { lab_order_id: labOrderId, note } = parsed.data;

  const supabase = await createClient();
  const { data: me } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!me?.organisation_id) {
    return { error: "Your account isn't set up for uploads yet. Message your care team." };
  }

  if (labOrderId) {
    const { data: order } = await supabase
      .from("lab_orders")
      .select("id")
      .eq("id", labOrderId)
      .eq("patient_id", user.id)
      .maybeSingle();
    if (!order) return { error: "That test request isn't on your record." };
  }

  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const path = `${user.id}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(ECG_REPORT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { error: uploadError.message };

  const { data: inserted, error: insertError } = await supabase
    .from("ecg_report_documents")
    .insert({
      organisation_id: me.organisation_id,
      patient_id: user.id,
      lab_order_id: labOrderId ?? null,
      file_path: path,
      original_filename: file.name,
      mime_type: file.type,
      file_size_bytes: file.size,
      source: "patient",
      uploaded_by: user.id,
      note: note ?? null,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    await supabase.storage.from(ECG_REPORT_BUCKET).remove([path]);
    return { error: insertError?.message ?? "Could not save that upload." };
  }

  // Read the tracing into structured parameters so the clinician opening the
  // alert already has numbers to check. Awaited (never throws) so the
  // clinician isn't racing the model; the patient's own confirmation does not
  // depend on the outcome either way.
  await runEcgReportExtraction(createServiceRoleClient(), {
    documentId: inserted.id,
    organisationId: me.organisation_id,
    patientId: user.id,
    filePath: path,
    mimeType: file.type,
  });

  revalidatePath("/patient");
  revalidatePath("/patient/prevention");
  return { success: true };
}

/**
 * A clinician marks an uploaded ECG reviewed (they've interpreted it).
 * Mirrors markResultDocumentReviewed exactly: runs through the clinician's
 * own RLS-scoped session so the insert-guard trigger stamps
 * reviewed_by = their auth.uid() (never spoofable), gated on an active
 * clinical_staff record.
 */
export async function markEcgReportReviewed(input: {
  documentId: string;
  note?: string;
}): Promise<EcgUploadResult> {
  const parsed = markEcgReportReviewedSchema.safeParse({
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
    return { error: "Only a Tarragon care-team doctor can mark an ECG reviewed." };
  }

  const { data: doc, error: docError } = await supabase
    .from("ecg_report_documents")
    .select("id, patient_id, reviewed_at, clinician_alert_id")
    .eq("id", documentId)
    .maybeSingle();
  if (docError || !doc) return { error: "ECG not found." };
  if (doc.reviewed_at) return { error: "This ECG was already marked reviewed." };

  const { error: updateError } = await supabase
    .from("ecg_report_documents")
    .update({ reviewed_at: new Date().toISOString(), review_note: note ?? null })
    .eq("id", documentId);
  if (updateError) return { error: updateError.message };

  if (doc.clinician_alert_id) {
    await supabase
      .from("clinician_alerts")
      .update({ status: "resolved", acknowledged_by: user.id, acknowledged_at: new Date().toISOString() })
      .eq("id", doc.clinician_alert_id);
  }

  revalidatePath("/clinician");
  revalidatePath(`/clinician/patients/${doc.patient_id}`);
  return { success: true };
}
