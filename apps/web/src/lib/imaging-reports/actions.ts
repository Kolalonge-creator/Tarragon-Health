"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  createIncidentalFindingSchema,
  fileImagingReportSchema,
} from "@/lib/validation/imaging-reports";

export type ImagingReportActionResult = { error?: string; success?: boolean; reportId?: string };

/**
 * A clinician files the structured imaging report for an order (spec
 * §59.10). Runs through the clinician's own RLS-scoped session
 * (private.is_org_staff gates the insert); the DB's own
 * private.handle_imaging_report_abnormal_pathway trigger raises the
 * clinician_alerts row and advances the parent order to 'reported' —
 * nothing here duplicates that logic, matching the platform's convention
 * that the abnormal-imaging pathway lives in the DB, not app code, so it
 * fires the same way regardless of which client wrote the row.
 */
export async function fileImagingReport(input: unknown): Promise<ImagingReportActionResult> {
  const parsed = fileImagingReportSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const {
    imaging_order_id: imagingOrderId,
    modality,
    body_region: bodyRegion,
    study_date: studyDate,
    radiologist_name: radiologistName,
    findings,
    impression,
    is_abnormal: isAbnormal,
    urgency,
    dicom_study_instance_uid: dicomStudyInstanceUid,
    dicom_accession_number: dicomAccessionNumber,
    pacs_url: pacsUrl,
    document_id: documentId,
  } = parsed.data;

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("imaging_orders")
    .select("id, organisation_id, patient_id")
    .eq("id", imagingOrderId)
    .maybeSingle();
  if (!order) return { error: "That imaging order isn't on your record." };

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id")
    .eq("profile_id", user.id)
    .eq("organisation_id", order.organisation_id)
    .eq("active", true)
    .maybeSingle();
  if (!staff) return { error: "Only a Tarragon care-team doctor can file an imaging report." };

  const { data: inserted, error: insertError } = await supabase
    .from("imaging_reports")
    .insert({
      organisation_id: order.organisation_id,
      patient_id: order.patient_id,
      imaging_order_id: imagingOrderId,
      modality,
      body_region: bodyRegion,
      study_date: studyDate,
      radiologist_name: radiologistName ?? null,
      findings,
      impression,
      is_abnormal: isAbnormal,
      urgency,
      dicom_study_instance_uid: dicomStudyInstanceUid ?? null,
      dicom_accession_number: dicomAccessionNumber ?? null,
      pacs_url: pacsUrl ?? null,
      document_id: documentId ?? null,
      source: "clinician",
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    return { error: insertError?.message ?? "Could not file that report." };
  }

  revalidatePath(`/clinician/patients/${order.patient_id}`);
  revalidatePath("/patient");
  return { success: true, reportId: inserted.id };
}

/** A clinician notes an incidental finding on a filed report (spec §59.12). */
export async function createIncidentalFinding(
  input: unknown
): Promise<ImagingReportActionResult> {
  const parsed = createIncidentalFindingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const {
    imaging_report_id: imagingReportId,
    description,
    is_urgent: isUrgent,
    follow_up_due_date: followUpDueDate,
  } = parsed.data;

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const supabase = await createClient();

  const { data: report } = await supabase
    .from("imaging_reports")
    .select("id, patient_id")
    .eq("id", imagingReportId)
    .maybeSingle();
  if (!report) return { error: "That imaging report isn't on your record." };

  const { error } = await supabase.from("imaging_incidental_findings").insert({
    imaging_report_id: imagingReportId,
    description,
    is_urgent: isUrgent,
    follow_up_due_date: followUpDueDate ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath(`/clinician/patients/${report.patient_id}`);
  return { success: true };
}

/**
 * A clinician marks a filed imaging report reviewed and acknowledges its
 * alert. Uses 'acknowledged', not 'resolved' — the Alert System's
 * clinician_alerts_resolution_requires_documentation CHECK (20260828014055)
 * requires resolution_action/resolution_outcome for a severity>=2 alert
 * moving to resolved/closed, which a plain "reviewed" acknowledgement isn't
 * meant to carry; closing the loop with a documented resolution is a
 * separate, more deliberate action against the alert itself.
 */
export async function markImagingReportReviewed(input: {
  reportId: string;
  note?: string;
}): Promise<ImagingReportActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const supabase = await createClient();

  const { data: report } = await supabase
    .from("imaging_reports")
    .select("id, patient_id, reviewed_at, clinician_alert_id")
    .eq("id", input.reportId)
    .maybeSingle();
  if (!report) return { error: "Imaging report not found." };
  if (report.reviewed_at) return { error: "This report was already marked reviewed." };

  const { error: updateError } = await supabase
    .from("imaging_reports")
    .update({ reviewed_at: new Date().toISOString(), review_note: input.note ?? null })
    .eq("id", input.reportId);
  if (updateError) return { error: updateError.message };

  if (report.clinician_alert_id) {
    await supabase
      .from("clinician_alerts")
      .update({ status: "acknowledged", acknowledged_by: user.id, acknowledged_at: new Date().toISOString() })
      .eq("id", report.clinician_alert_id);
  }

  revalidatePath("/clinician");
  revalidatePath(`/clinician/patients/${report.patient_id}`);
  return { success: true };
}
