"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import type { Database } from "@tarragon/shared";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { DIAGNOSTIC_REPORT_BUCKET } from "./documents";
import {
  createDiagnosticRequestSchema,
  markDiagnosticReportActionCompletedSchema,
  patientDiagnosticReportUploadSchema,
  reviewDiagnosticReportSchema,
  staffDiagnosticReportUploadSchema,
  validateDiagnosticReportFile,
} from "@/lib/validation/diagnostic-requests";

type DocumentSource = Database["public"]["Enums"]["diagnostic_report_source"];
export type DiagnosticActionResult = { error?: string; success?: boolean };

/** Which staff account roles may upload a diagnostic report on a patient's
 * behalf, and the document `source` each is recorded as. Mirrors
 * lib/ecg-reports/actions.ts's UPLOADER_SOURCE exactly. Care Coordinators
 * are deliberately absent — the non-clinical write guardrail (CLAUDE.md)
 * keeps them read-only here. */
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
 * A clinician creates a diagnostic request (15.2) — "Echocardiogram
 * requested" for a documented indication. Runs through the clinician's own
 * RLS-scoped session: diagnostic_requests_insert requires an active
 * clinical_staff row for the target organisation, and
 * derive_diagnostic_request_attribution stamps requested_by server-side —
 * neither is spoofable from here. There is deliberately no equivalent
 * "patient creates their own request" action anywhere in this module (see
 * Master Operating Plan §6's "never patient-orderable" guardrail).
 */
export async function createDiagnosticRequest(
  input: unknown,
): Promise<DiagnosticActionResult & { requestId?: string }> {
  const parsed = createDiagnosticRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { patient_id: patientId, ...rest } = parsed.data;

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const supabase = await createClient();

  const { data: patient } = await supabase
    .from("profiles")
    .select("id, organisation_id")
    .eq("id", patientId)
    .eq("role", "patient")
    .maybeSingle();
  if (!patient || !patient.organisation_id) {
    return { error: "That patient isn't in your organisation." };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("diagnostic_requests")
    .insert({
      organisation_id: patient.organisation_id,
      patient_id: patientId,
      // requested_by is overwritten server-side by
      // derive_diagnostic_request_attribution regardless of what's sent —
      // this value is never trusted, only a placeholder is required by the
      // NOT NULL column.
      requested_by: user.id,
      catalogue_id: rest.catalogue_id ?? null,
      modality: rest.modality,
      service_name: rest.service_name,
      indication: rest.indication,
      clinical_question: rest.clinical_question ?? null,
      relevant_information: rest.relevant_information ?? null,
      urgency: rest.urgency,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return {
      error:
        insertError?.message ??
        "Could not create that request — only an active care-team clinician can order a diagnostic service.",
    };
  }

  revalidatePath(`/clinician/patients/${patientId}`);
  revalidatePath("/patient");
  return { success: true, requestId: inserted.id };
}

/**
 * A staff member (Lab Liaison Officer, clinician/doctor, or admin) uploads a
 * diagnostic report into a patient's record on their behalf. Storage + row
 * writes go through the service-role client: the file lands under the
 * *patient's* uid folder, which the own-folder storage policy forbids a
 * staff session from writing directly. Mirrors uploadEcgReportForPatient
 * exactly.
 */
export async function uploadDiagnosticReportForPatient(
  formData: FormData,
): Promise<DiagnosticActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();

  const source = me ? UPLOADER_SOURCE[me.role] : undefined;
  if (!source) {
    return {
      error: "Your role can't upload diagnostic reports for a patient. Ask a Lab Liaison Officer, clinician, or admin.",
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Attach the report (PDF or photo)." };
  }
  const fileError = validateDiagnosticReportFile(file);
  if (fileError) return { error: fileError };

  const parsed = staffDiagnosticReportUploadSchema.safeParse({
    patient_id: formData.get("patient_id"),
    diagnostic_request_id: formData.get("diagnostic_request_id"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { patient_id: patientId, diagnostic_request_id: requestId, note } = parsed.data;

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
    .from(DIAGNOSTIC_REPORT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { error: uploadError.message };

  const { error: insertError } = await service
    .from("diagnostic_reports")
    .insert({
      organisation_id: patient.organisation_id,
      patient_id: patientId,
      diagnostic_request_id: requestId,
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
  if (insertError) {
    await service.storage.from(DIAGNOSTIC_REPORT_BUCKET).remove([path]);
    return { error: insertError.message };
  }

  revalidatePath(`/clinician/patients/${patientId}`);
  return { success: true };
}

/**
 * A patient uploads their own diagnostic report. Runs through the patient's
 * OWN session (storage own-folder + row insert policies already allow
 * this). Source is pinned to 'patient' and patient_id comes from the
 * session, never the form. Uploading a file never records a clinical
 * finding on its own — a clinician reviews it and separately files the
 * structured findings/impression/abnormal flag.
 */
export async function uploadDiagnosticReportAsPatient(
  formData: FormData,
): Promise<DiagnosticActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Attach the report (PDF or photo)." };
  }
  const fileError = validateDiagnosticReportFile(file);
  if (fileError) return { error: fileError };

  const parsed = patientDiagnosticReportUploadSchema.safeParse({
    diagnostic_request_id: formData.get("diagnostic_request_id"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { diagnostic_request_id: requestId, note } = parsed.data;

  const supabase = await createClient();
  const { data: me } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!me?.organisation_id) {
    return { error: "Your account isn't set up for uploads yet. Message your care team." };
  }

  const { data: request } = await supabase
    .from("diagnostic_requests")
    .select("id")
    .eq("id", requestId)
    .eq("patient_id", user.id)
    .maybeSingle();
  if (!request) return { error: "That diagnostic request isn't on your record." };

  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const path = `${user.id}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(DIAGNOSTIC_REPORT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { error: uploadError.message };

  const { error: insertError } = await supabase
    .from("diagnostic_reports")
    .insert({
      organisation_id: me.organisation_id,
      patient_id: user.id,
      diagnostic_request_id: requestId,
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
  if (insertError) {
    await supabase.storage.from(DIAGNOSTIC_REPORT_BUCKET).remove([path]);
    return { error: insertError.message };
  }

  revalidatePath("/patient");
  return { success: true };
}

/**
 * A clinician files the structured review (15.6) — findings, impression,
 * reporting clinician, date, facility — and the abnormal flag (15.9), which
 * when true raises an urgent clinician_alerts row via the same Abnormal
 * Result Engine every other abnormal-result pathway on the platform uses
 * (private.handle_diagnostic_report_review). Runs through the clinician's
 * own RLS-scoped session so reviewed_by is server-derived, gated on an
 * active clinical_staff record.
 */
export async function reviewDiagnosticReport(input: unknown): Promise<DiagnosticActionResult> {
  const parsed = reviewDiagnosticReportSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { report_id: reportId, ...rest } = parsed.data;

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
    return { error: "Only a Tarragon care-team doctor can review a diagnostic report." };
  }

  const { data: report, error: reportError } = await supabase
    .from("diagnostic_reports")
    .select("id, patient_id, reviewed_at")
    .eq("id", reportId)
    .maybeSingle();
  if (reportError || !report) return { error: "Report not found." };
  if (report.reviewed_at) return { error: "This report was already reviewed." };

  const { error: updateError } = await supabase
    .from("diagnostic_reports")
    .update({
      reviewed_at: new Date().toISOString(),
      findings: rest.findings ?? null,
      impression: rest.impression ?? null,
      reporting_clinician_name: rest.reporting_clinician_name ?? null,
      report_date: rest.report_date ?? null,
      facility_name: rest.facility_name ?? null,
      review_note: rest.review_note ?? null,
      is_abnormal: rest.is_abnormal,
      abnormal_severity: rest.abnormal_severity ?? null,
    })
    .eq("id", reportId);
  if (updateError) return { error: updateError.message };

  revalidatePath("/clinician");
  revalidatePath(`/clinician/patients/${report.patient_id}`);
  return { success: true };
}

/**
 * A clinician confirms the abnormal-finding follow-up actually happened
 * (e.g. a specialist referral was created, or the care plan was updated) —
 * distinct from the review itself, matching
 * mark_result_document_action_completed's "written down" vs "actually
 * happened" split. Gated to a report currently in action_required by the DB
 * trigger (private.handle_diagnostic_report_review); this action just calls
 * that guarded UPDATE through the clinician's own session.
 */
export async function markDiagnosticReportActionCompleted(
  input: unknown,
): Promise<DiagnosticActionResult> {
  const parsed = markDiagnosticReportActionCompletedSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { report_id: reportId } = parsed.data;

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
    return { error: "Only a Tarragon care-team doctor can mark this follow-up completed." };
  }

  const { data: report, error: reportError } = await supabase
    .from("diagnostic_reports")
    .select("id, patient_id, acknowledgement_status")
    .eq("id", reportId)
    .maybeSingle();
  if (reportError || !report) return { error: "Report not found." };
  if (report.acknowledgement_status !== "action_required") {
    return { error: "Only a report awaiting follow-up action can be marked completed." };
  }

  const { error: updateError } = await supabase
    .from("diagnostic_reports")
    .update({ action_completed_at: new Date().toISOString() })
    .eq("id", reportId);
  if (updateError) return { error: updateError.message };

  revalidatePath("/clinician");
  revalidatePath(`/clinician/patients/${report.patient_id}`);
  return { success: true };
}
