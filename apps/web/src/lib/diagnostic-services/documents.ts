import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export const DIAGNOSTIC_REPORT_BUCKET = "diagnostic-reports";

export interface DiagnosticReportView {
  id: string;
  diagnosticRequestId: string;
  source: Database["public"]["Enums"]["diagnostic_report_source"];
  originalFilename: string | null;
  mimeType: string | null;
  note: string | null;
  createdAt: string;
  findings: string | null;
  impression: string | null;
  reportingClinicianName: string | null;
  reportDate: string | null;
  facilityName: string | null;
  isAbnormal: boolean | null;
  abnormalSeverity: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  acknowledgementStatus: Database["public"]["Enums"]["result_document_acknowledgement_status"];
  actionCompletedAt: string | null;
  /** Short-lived signed URL for the file, or null if it could not be signed. */
  signedUrl: string | null;
  isPdf: boolean;
}

export interface DiagnosticRequestView {
  id: string;
  modality: Database["public"]["Enums"]["diagnostic_modality"];
  serviceName: string;
  indication: string;
  clinicalQuestion: string | null;
  relevantInformation: string | null;
  urgency: Database["public"]["Enums"]["diagnostic_urgency"];
  status: Database["public"]["Enums"]["diagnostic_request_status"];
  facilityId: string | null;
  facilityNameFreetext: string | null;
  scheduledDate: string | null;
  preferredTimeOfDay: Database["public"]["Enums"]["lab_order_time_of_day"] | null;
  createdAt: string;
}

/**
 * Mint a short-lived signed URL for a diagnostic report's storage object.
 * Uses the service-role client because org staff have no storage-object read
 * policy (the bucket's policies only let a patient read their own uid
 * folder) — the row-level RLS on diagnostic_reports is the real
 * authorisation gate, so the CALLER must already have read the row through
 * their own RLS-scoped session before asking for a URL. Never returns a
 * public URL. Mirrors lib/ecg-reports/documents.ts's signEcgReportPath.
 */
export async function signDiagnosticReportPath(path: string): Promise<string | null> {
  const service = createServiceRoleClient();
  const { data } = await service.storage.from(DIAGNOSTIC_REPORT_BUCKET).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

/**
 * Load a patient's diagnostic requests (RLS-scoped to the passed caller
 * client — a patient sees their own, org staff see org patients'). Newest
 * first.
 */
export async function loadDiagnosticRequests(
  supabase: SupabaseClient<Database>,
  patientId: string,
): Promise<DiagnosticRequestView[]> {
  const { data: rows } = await supabase
    .from("diagnostic_requests")
    .select(
      "id, modality, service_name, indication, clinical_question, relevant_information, urgency, status, facility_id, facility_name_freetext, scheduled_date, preferred_time_of_day, created_at",
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  return (rows ?? []).map((row) => ({
    id: row.id,
    modality: row.modality,
    serviceName: row.service_name,
    indication: row.indication,
    clinicalQuestion: row.clinical_question,
    relevantInformation: row.relevant_information,
    urgency: row.urgency,
    status: row.status,
    facilityId: row.facility_id,
    facilityNameFreetext: row.facility_name_freetext,
    scheduledDate: row.scheduled_date,
    preferredTimeOfDay: row.preferred_time_of_day,
    createdAt: row.created_at,
  }));
}

/**
 * Load a patient's diagnostic reports and attach a signed URL to each.
 * Newest first.
 */
export async function loadDiagnosticReports(
  supabase: SupabaseClient<Database>,
  patientId: string,
): Promise<DiagnosticReportView[]> {
  const { data: rows } = await supabase
    .from("diagnostic_reports")
    .select(
      "id, diagnostic_request_id, source, original_filename, mime_type, note, created_at, file_path, findings, impression, reporting_clinician_name, report_date, facility_name, is_abnormal, abnormal_severity, reviewed_by, reviewed_at, review_note, acknowledgement_status, action_completed_at",
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (!rows || rows.length === 0) return [];

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      diagnosticRequestId: row.diagnostic_request_id,
      source: row.source,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      note: row.note,
      createdAt: row.created_at,
      findings: row.findings,
      impression: row.impression,
      reportingClinicianName: row.reporting_clinician_name,
      reportDate: row.report_date,
      facilityName: row.facility_name,
      isAbnormal: row.is_abnormal,
      abnormalSeverity: row.abnormal_severity,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      reviewNote: row.review_note,
      acknowledgementStatus: row.acknowledgement_status,
      actionCompletedAt: row.action_completed_at,
      signedUrl: await signDiagnosticReportPath(row.file_path),
      isPdf: row.mime_type === "application/pdf",
    })),
  );
}
