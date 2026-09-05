"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import type { Database } from "@tarragon/shared";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { IMAGING_REPORT_BUCKET } from "./documents";
import {
  patientImagingReportUploadSchema,
  staffImagingReportUploadSchema,
  validateImagingReportDocFile,
} from "@/lib/validation/imaging-report-documents";

type DocumentSource = Database["public"]["Enums"]["imaging_report_document_source"];
export type ImagingReportUploadResult = { error?: string; success?: boolean };

/**
 * Which staff account roles may upload an imaging report on a patient's
 * behalf, and the document `source` each is recorded as. Mirrors
 * lib/ecg-reports/actions.ts's UPLOADER_SOURCE. Care Coordinators are
 * deliberately absent — the non-clinical write guardrail (CLAUDE.md) keeps
 * them read-only here.
 */
const UPLOADER_SOURCE: Partial<Record<string, DocumentSource>> = {
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
 * A staff member (clinician/doctor or admin) uploads an imaging report into
 * a patient's record on their behalf. Storage + row writes go through the
 * service-role client: the file lands under the *patient's* uid folder,
 * which the own-folder storage policy forbids a staff session from writing
 * directly. Mirrors uploadEcgReportForPatient exactly.
 */
export async function uploadImagingReportForPatient(
  formData: FormData
): Promise<ImagingReportUploadResult> {
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
    return { error: "Your role can't upload imaging reports for a patient. Ask a clinician or admin." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Attach the imaging report file (PDF or photo)." };
  }
  const fileError = validateImagingReportDocFile(file);
  if (fileError) return { error: fileError };

  const parsed = staffImagingReportUploadSchema.safeParse({
    patient_id: formData.get("patient_id"),
    imaging_order_id: formData.get("imaging_order_id") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { patient_id: patientId, imaging_order_id: imagingOrderId, note } = parsed.data;

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
  //
  // The one documented exception is the `admin` superadmin, who traverses
  // every role area (and, per CLAUDE.md's I9 rule, is the ONLY account that
  // may drill into an individual patient outside their own organisation).
  // Locking admin inside a single org here would have blocked a legitimate
  // oversight action, not closed a hole — private.is_admin() already grants
  // exactly this read in the profiles SELECT policy.
  const isSuperadmin = me?.role === "admin";
  if (
    !patient ||
    !patient.organisation_id ||
    (!isSuperadmin && patient.organisation_id !== me?.organisation_id)
  ) {
    return { error: "That patient isn't in your organisation." };
  }

  const service = createServiceRoleClient();
  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const path = `${patientId}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await service.storage
    .from(IMAGING_REPORT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { error: uploadError.message };

  const { error: insertError } = await service.from("imaging_report_documents").insert({
    organisation_id: patient.organisation_id,
    patient_id: patientId,
    imaging_order_id: imagingOrderId ?? null,
    file_path: path,
    original_filename: file.name,
    mime_type: file.type,
    file_size_bytes: file.size,
    source,
    uploaded_by: user.id,
    note: note ?? null,
  });
  if (insertError) {
    await service.storage.from(IMAGING_REPORT_BUCKET).remove([path]);
    return { error: insertError.message };
  }

  revalidatePath(`/clinician/patients/${patientId}`);
  return { success: true };
}

/**
 * A patient uploads their own imaging report — the self-arranged path (they
 * took the order to a facility, paid directly, and are uploading the
 * result). Runs through the patient's OWN session; storage own-folder +
 * row-insert policies already allow this. Mirrors uploadEcgReportAsPatient
 * exactly: source is pinned to 'patient', patient_id comes from the
 * session, never the form. Uploading a file never records a clinical
 * finding on its own — a clinician reviews it and separately files the
 * structured imaging_reports row.
 */
export async function uploadImagingReportAsPatient(
  formData: FormData
): Promise<ImagingReportUploadResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Attach the imaging report file (PDF or photo)." };
  }
  const fileError = validateImagingReportDocFile(file);
  if (fileError) return { error: fileError };

  const parsed = patientImagingReportUploadSchema.safeParse({
    imaging_order_id: formData.get("imaging_order_id") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { imaging_order_id: imagingOrderId, note } = parsed.data;

  const supabase = await createClient();
  const { data: me } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!me?.organisation_id) {
    return { error: "Your account isn't set up for uploads yet. Message your care team." };
  }

  if (imagingOrderId) {
    const { data: order } = await supabase
      .from("imaging_orders")
      .select("id")
      .eq("id", imagingOrderId)
      .eq("patient_id", user.id)
      .maybeSingle();
    if (!order) return { error: "That imaging order isn't on your record." };
  }

  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const path = `${user.id}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(IMAGING_REPORT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { error: uploadError.message };

  const { error: insertError } = await supabase.from("imaging_report_documents").insert({
    organisation_id: me.organisation_id,
    patient_id: user.id,
    imaging_order_id: imagingOrderId ?? null,
    file_path: path,
    original_filename: file.name,
    mime_type: file.type,
    file_size_bytes: file.size,
    source: "patient",
    uploaded_by: user.id,
    note: note ?? null,
  });
  if (insertError) {
    await supabase.storage.from(IMAGING_REPORT_BUCKET).remove([path]);
    return { error: insertError.message };
  }

  revalidatePath("/patient");
  return { success: true };
}

/**
 * A clinician marks an uploaded imaging report document reviewed. Mirrors
 * markEcgReportReviewed: runs through the clinician's own RLS-scoped
 * session so the update-guard trigger stamps reviewed_by = their auth.uid()
 * (never spoofable), gated on an active clinical_staff record. Acknowledges
 * (not resolves) the linked alert — see markImagingReportReviewed in
 * imaging-reports/actions.ts for why.
 */
export async function markImagingReportDocumentReviewed(input: {
  documentId: string;
  note?: string;
}): Promise<ImagingReportUploadResult> {
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
    return { error: "Only a Tarragon care-team doctor can mark an imaging report reviewed." };
  }

  const { data: doc, error: docError } = await supabase
    .from("imaging_report_documents")
    .select("id, patient_id, reviewed_at, clinician_alert_id")
    .eq("id", input.documentId)
    .maybeSingle();
  if (docError || !doc) return { error: "Imaging report document not found." };
  if (doc.reviewed_at) return { error: "This document was already marked reviewed." };

  const { error: updateError } = await supabase
    .from("imaging_report_documents")
    .update({ reviewed_at: new Date().toISOString(), review_note: input.note ?? null })
    .eq("id", input.documentId);
  if (updateError) return { error: updateError.message };

  if (doc.clinician_alert_id) {
    await supabase
      .from("clinician_alerts")
      .update({ status: "acknowledged", acknowledged_by: user.id, acknowledged_at: new Date().toISOString() })
      .eq("id", doc.clinician_alert_id);
  }

  revalidatePath("/clinician");
  revalidatePath(`/clinician/patients/${doc.patient_id}`);
  return { success: true };
}
