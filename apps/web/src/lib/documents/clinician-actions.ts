"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";
import {
  archivePatientDocumentSchema,
  flagDocumentDiscrepancySchema,
  resolveDocumentDiscrepancySchema,
  reviewDocumentClassificationSchema,
} from "@/lib/validation/patient-document-discrepancies";

export type DocumentActionResult = { error?: string; success?: boolean };

/**
 * The app-layer clinical-authority gate every action below shares: only a
 * clinical-tier doctor (never a Care Coordinator, who carries an active
 * clinical_staff row too — see isClinicalTier's own comment) may take a
 * clinical-judgment action on a patient document. This is a UX-quality gate
 * — it stops a Care Coordinator ever seeing the outcome of a call they
 * shouldn't have made — not the only line of defence: publish/archive run
 * through SECURITY DEFINER RPCs that re-check is_org_staff themselves, and
 * the discrepancy RPCs do the same. Flagging/resolving a discrepancy and
 * reviewing a classification mismatch have no DB-level clinical-tier check
 * at all (their RPC/RLS only requires org staff), so this app-layer check is
 * the REAL enforcement boundary for those two — never skip it.
 */
async function requireClinicalStaff(): Promise<
  { error: string } | { userId: string }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("doctor_tier, is_clinical_director")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!isClinicalTier(staff ?? null)) {
    return { error: "Only a Tarragon care-team doctor can do this." };
  }
  return { userId: user.id };
}

/**
 * Moves a validated document to available (public.publish_patient_document).
 * The RPC itself only requires org staff, so this app-layer clinical-tier
 * check is a UX gate, not the sole boundary — matches the pattern used for
 * every other clinical-judgment action on this platform.
 */
export async function publishClinicianUploadedDocument(
  documentId: string
): Promise<DocumentActionResult> {
  const gate = await requireClinicalStaff();
  if ("error" in gate) return { error: gate.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_patient_document", {
    p_document_id: documentId,
  });
  if (error || !data) return { error: error?.message ?? "Could not publish that document." };

  revalidatePath(`/clinician/patients/${data.patient_id}`);
  return { success: true };
}

/**
 * Archives a document out of the working record
 * (public.archive_patient_document). Requires a reason, matching the RPC's
 * own requirement.
 */
export async function archivePatientDocumentAsStaff(
  documentId: string,
  reason: string
): Promise<DocumentActionResult> {
  const parsed = archivePatientDocumentSchema.safeParse({
    document_id: documentId,
    reason,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const gate = await requireClinicalStaff();
  if ("error" in gate) return { error: gate.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("archive_patient_document", {
    p_document_id: parsed.data.document_id,
    p_reason: parsed.data.reason,
  });
  if (error || !data) return { error: error?.message ?? "Could not archive that document." };

  revalidatePath(`/clinician/patients/${data.patient_id}`);
  return { success: true };
}

/**
 * A clinician records their review verdict on an OCR classification
 * disagreement (patient_document_extractions.classification_status =
 * 'needs_review'). A plain .update() through the clinician's own RLS-scoped
 * session — the enforce_patient_document_extraction_review trigger
 * server-derives reviewed_by/reviewed_at and freezes them once set, so this
 * never trusts the client for either. Confirming a classification mismatch
 * is a clinical judgment (the declared document_type is never changed here,
 * or anywhere — only a corrected version via supersede does that), so this
 * has NO DB-level clinical-tier check of its own: this app-layer gate is the
 * real enforcement boundary, not just a UX nicety.
 */
export async function reviewDocumentClassification(
  extractionId: string,
  reviewNote: string
): Promise<DocumentActionResult> {
  const parsed = reviewDocumentClassificationSchema.safeParse({
    extraction_id: extractionId,
    review_note: reviewNote,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const gate = await requireClinicalStaff();
  if ("error" in gate) return { error: gate.error };

  const supabase = await createClient();
  const { data: extraction, error: fetchError } = await supabase
    .from("patient_document_extractions")
    .select("id, patient_id, reviewed_at")
    .eq("id", parsed.data.extraction_id)
    .maybeSingle();
  if (fetchError || !extraction) return { error: "Extraction not found." };
  if (extraction.reviewed_at) return { error: "This classification was already reviewed." };

  const { error: updateError } = await supabase
    .from("patient_document_extractions")
    .update({
      reviewed_at: new Date().toISOString(),
      review_note: parsed.data.review_note,
    })
    .eq("id", parsed.data.extraction_id);
  if (updateError) return { error: updateError.message };

  revalidatePath(`/clinician/patients/${extraction.patient_id}`);
  return { success: true };
}

/**
 * Flags a conflict between a document and the patient's existing structured
 * record (public.flag_patient_document_discrepancy) — always raises a
 * matching clinician_alerts entry in the same RPC call. The RPC's own gate
 * is org-staff, not clinical-tier, so — same as reviewDocumentClassification
 * — this app-layer check is the real boundary excluding a Care Coordinator.
 */
export async function flagDocumentDiscrepancy(input: {
  documentId: string;
  fieldDescription: string;
  existingValue?: string;
  documentValue?: string;
  conflictingTable?: string;
  conflictingRecordId?: string;
}): Promise<DocumentActionResult> {
  const parsed = flagDocumentDiscrepancySchema.safeParse({
    document_id: input.documentId,
    field_description: input.fieldDescription,
    existing_value: input.existingValue || undefined,
    document_value: input.documentValue || undefined,
    conflicting_table: input.conflictingTable || undefined,
    conflicting_record_id: input.conflictingRecordId || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const gate = await requireClinicalStaff();
  if ("error" in gate) return { error: gate.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("flag_patient_document_discrepancy", {
    p_document_id: parsed.data.document_id,
    p_field_description: parsed.data.field_description,
    p_existing_value: parsed.data.existing_value ?? undefined,
    p_document_value: parsed.data.document_value ?? undefined,
    p_conflicting_table: parsed.data.conflicting_table ?? undefined,
    p_conflicting_record_id: parsed.data.conflicting_record_id ?? undefined,
  });
  if (error || !data) return { error: error?.message ?? "Could not flag that discrepancy." };

  revalidatePath(`/clinician/patients/${data.patient_id}`);
  return { success: true };
}

/**
 * Resolves a previously flagged discrepancy
 * (public.resolve_patient_document_discrepancy) — one-shot, requires a
 * resolution note, and the RPC itself rejects resolving back to 'open'.
 * Same org-staff-only RPC gate as flagDocumentDiscrepancy, so this app-layer
 * clinical-tier check is again the real boundary.
 */
export async function resolveDocumentDiscrepancy(
  discrepancyId: string,
  status: string,
  resolutionNote: string
): Promise<DocumentActionResult> {
  const parsed = resolveDocumentDiscrepancySchema.safeParse({
    discrepancy_id: discrepancyId,
    status,
    resolution_note: resolutionNote,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const gate = await requireClinicalStaff();
  if ("error" in gate) return { error: gate.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_patient_document_discrepancy", {
    p_discrepancy_id: parsed.data.discrepancy_id,
    p_status: parsed.data.status,
    p_resolution_note: parsed.data.resolution_note,
  });
  if (error || !data) return { error: error?.message ?? "Could not resolve that discrepancy." };

  revalidatePath(`/clinician/patients/${data.patient_id}`);
  return { success: true };
}
