"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isReadableDocumentType, normaliseForVision } from "@/lib/lab-reports/heic";
import { extractSpecialistConsultationReport, isSpecialistReportExtractionConfigured } from "./extract";
import {
  addSpecialistReferralActionItemSchema,
  confirmSpecialistConsultationExtractionSchema,
  patientSpecialistConsultationUploadSchema,
  staffSpecialistConsultationUploadSchema,
  validateSpecialistConsultationDocFile,
} from "@/lib/validation/specialist-consultation-documents";

export const SPECIALIST_CONSULTATION_REPORT_BUCKET = "specialist-consultation-reports";

type DocumentSource = Database["public"]["Enums"]["specialist_consultation_document_source"];
export type SpecialistReportActionResult = { error?: string; success?: boolean; message?: string };

const EXTRACTION_MODEL_ID = "claude-sonnet-5";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

/** Which staff account roles may upload a specialist report on a patient's
 * behalf, and the document `source` each is recorded as. Care Coordinators
 * ARE included — uploading a document is logistics, not one of the three
 * writes CLAUDE.md reserves from that role (medications, escalation
 * resolution, protocol signing). */
const UPLOADER_SOURCE: Partial<Record<string, DocumentSource>> = {
  care_coordinator: "care_coordinator",
  clinician: "clinician",
  doctor: "clinician",
  admin: "admin",
};

async function requireClinicalStaff() {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" as const };

  const supabase = await createClient();
  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!staff) {
    return { error: "Only a Tarragon care-team clinician can do this." as const };
  }
  return { user, supabase, staffId: staff.id };
}

/**
 * Read an uploaded specialist report into a draft. Runs under the
 * SERVICE-ROLE client and takes the document's own ids as arguments, same
 * shape as runLabReportExtraction/runEcgReportExtraction — the acting
 * session may be a patient uploading their own report.
 *
 * NEVER THROWS. Every failure persists a `failed` row and leaves the
 * existing manual treatment_plan_note path exactly as it was.
 */
export async function runSpecialistReportExtraction(
  service: SupabaseClient<Database>,
  params: {
    documentId: string;
    referralId: string;
    patientId: string;
    organisationId: string;
    filePath: string;
    mimeType: string | null;
    contextHint?: string | null;
  },
): Promise<{ status: "extracted" | "failed"; message: string }> {
  const { documentId, referralId, patientId, organisationId, filePath, mimeType } = params;

  const fail = async (message: string, errorMessage: string) => {
    try {
      await service.from("specialist_consultation_extractions").upsert(
        {
          organisation_id: organisationId,
          patient_id: patientId,
          referral_id: referralId,
          document_id: documentId,
          model_id: EXTRACTION_MODEL_ID,
          status: "failed",
          recommendations: [] as unknown as Json,
          medications_mentioned: [] as unknown as Json,
          investigations_mentioned: [] as unknown as Json,
          error_message: errorMessage,
          report_date: null,
          specialist_name_on_report: null,
          facility_name_on_report: null,
          patient_name_on_report: null,
          diagnosis: null,
          follow_up_interval_days: null,
          unreadable_reason: null,
          confirmed_by: null,
          confirmed_at: null,
          confirmed_recommendation_indexes: [] as unknown as Json,
        },
        { onConflict: "document_id" },
      );
    } catch (error) {
      console.error("specialist-reports: could not persist failure", error);
    }
    return { status: "failed" as const, message };
  };

  if (!mimeType) {
    return fail("This file has no recorded type, so it cannot be read automatically.", "No mime type recorded.");
  }
  if (!isReadableDocumentType(mimeType)) {
    return fail("This file type cannot be read automatically. Enter the plan by hand.", `Unsupported media type: ${mimeType}`);
  }
  if (!isSpecialistReportExtractionConfigured()) {
    return fail("Automatic reading is not configured on this environment.", "ANTHROPIC_API_KEY is not set.");
  }

  let fileBase64: string;
  let visionMediaType: string = mimeType;
  try {
    const { data: file, error } = await service.storage
      .from(SPECIALIST_CONSULTATION_REPORT_BUCKET)
      .download(filePath);
    if (error || !file) throw error ?? new Error("Not found in storage");

    const normalised = await normaliseForVision(Buffer.from(await file.arrayBuffer()), mimeType);
    fileBase64 = normalised.buffer.toString("base64");
    visionMediaType = normalised.mediaType;
  } catch (error) {
    console.error("specialist-reports: could not download document", error);
    return fail("Could not open the stored report file.", "Download failed.");
  }

  const result = await extractSpecialistConsultationReport({
    fileBase64,
    mediaType: visionMediaType,
    contextHint: params.contextHint ?? null,
  });

  if (!result.ok) {
    return fail(
      result.reason === "unsupported_type"
        ? "This file type cannot be read automatically. Enter the plan by hand."
        : result.reason === "unavailable"
          ? "Automatic reading is not configured on this environment."
          : "Automatic reading failed. Enter the plan by hand.",
      `Extraction failed: ${result.reason}`,
    );
  }

  const extraction = result.extraction;
  const { error: upsertError } = await service.from("specialist_consultation_extractions").upsert(
    {
      organisation_id: organisationId,
      patient_id: patientId,
      referral_id: referralId,
      document_id: documentId,
      model_id: EXTRACTION_MODEL_ID,
      status: "extracted",
      report_date: extraction.reportDate,
      specialist_name_on_report: extraction.specialistName,
      facility_name_on_report: extraction.facilityName,
      patient_name_on_report: extraction.patientNameOnReport,
      diagnosis: extraction.diagnosis,
      recommendations: extraction.recommendations.map((r) => ({
        description: r.description,
        action_type: r.actionType,
        suggested_due_days: r.suggestedDueDays,
        confidence: r.confidence,
      })) as unknown as Json,
      medications_mentioned: extraction.medicationsMentioned as unknown as Json,
      investigations_mentioned: extraction.investigationsMentioned as unknown as Json,
      follow_up_interval_days: extraction.followUpIntervalDays,
      unreadable_reason: extraction.unreadableReason,
      error_message: null,
      confirmed_by: null,
      confirmed_at: null,
      confirmed_recommendation_indexes: [] as unknown as Json,
    },
    { onConflict: "document_id" },
  );
  if (upsertError) {
    return fail("Could not save the draft.", upsertError.message);
  }

  return {
    status: "extracted",
    message:
      extraction.recommendations.length > 0
        ? `Read ${extraction.recommendations.length} recommendation${extraction.recommendations.length === 1 ? "" : "s"}. Check them against the report before filing.`
        : "Read the report, but found no distinct recommendations. Check the diagnosis and file by hand if needed.",
  };
}

async function uploadSpecialistConsultationReport(input: {
  file: File;
  referralId: string;
  note: string | undefined;
  source: DocumentSource;
  patientId: string;
  organisationId: string;
  specialistType: string;
  uploaderId: string;
  client: SupabaseClient<Database>;
  serviceForExtraction: SupabaseClient<Database>;
}): Promise<SpecialistReportActionResult> {
  const { file, referralId, note, source, patientId, organisationId, specialistType, uploaderId, client, serviceForExtraction } =
    input;

  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const path = `${patientId}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await client.storage
    .from(SPECIALIST_CONSULTATION_REPORT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { error: uploadError.message };

  const { data: inserted, error: insertError } = await client
    .from("specialist_consultation_documents")
    .insert({
      organisation_id: organisationId,
      patient_id: patientId,
      referral_id: referralId,
      file_path: path,
      original_filename: file.name,
      mime_type: file.type,
      file_size_bytes: file.size,
      source,
      uploaded_by: uploaderId,
      note: note ?? null,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    await client.storage.from(SPECIALIST_CONSULTATION_REPORT_BUCKET).remove([path]);
    return { error: insertError?.message ?? "Could not save that upload." };
  }

  await runSpecialistReportExtraction(serviceForExtraction, {
    documentId: inserted.id,
    referralId,
    organisationId,
    patientId,
    filePath: path,
    mimeType: file.type,
    contextHint: specialistType,
  });

  revalidatePath(`/clinician/referrals/${referralId}`);
  revalidatePath("/patient/referrals");
  return { success: true };
}

/** A staff member (clinician, Care Coordinator, or admin) uploads a
 * specialist's report on a patient's behalf. */
export async function uploadSpecialistConsultationReportForPatient(
  formData: FormData,
): Promise<SpecialistReportActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const source = me ? UPLOADER_SOURCE[me.role] : undefined;
  if (!source) {
    return { error: "Your role can't upload a specialist report. Ask a clinician, care coordinator, or admin." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Attach the report (PDF or photo)." };
  const fileError = validateSpecialistConsultationDocFile(file);
  if (fileError) return { error: fileError };

  const parsed = staffSpecialistConsultationUploadSchema.safeParse({
    referral_id: formData.get("referral_id"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { data: referral } = await supabase
    .from("specialist_referrals")
    .select("id, patient_id, organisation_id, specialist_type")
    .eq("id", parsed.data.referral_id)
    .maybeSingle();
  if (!referral) return { error: "That referral isn't in your organisation." };

  const service = createServiceRoleClient();
  return uploadSpecialistConsultationReport({
    file,
    referralId: referral.id,
    note: parsed.data.note,
    source,
    patientId: referral.patient_id,
    organisationId: referral.organisation_id,
    specialistType: referral.specialist_type,
    uploaderId: user.id,
    client: service,
    serviceForExtraction: service,
  });
}

/** A patient uploads the report a specialist gave them, against their own referral. */
export async function uploadSpecialistConsultationReportAsPatient(
  formData: FormData,
): Promise<SpecialistReportActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Attach the report (PDF or photo)." };
  const fileError = validateSpecialistConsultationDocFile(file);
  if (fileError) return { error: fileError };

  const parsed = patientSpecialistConsultationUploadSchema.safeParse({
    referral_id: formData.get("referral_id"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { data: referral } = await supabase
    .from("specialist_referrals")
    .select("id, patient_id, organisation_id, specialist_type")
    .eq("id", parsed.data.referral_id)
    .eq("patient_id", user.id)
    .maybeSingle();
  if (!referral) return { error: "That referral isn't on your record." };

  return uploadSpecialistConsultationReport({
    file,
    referralId: referral.id,
    note: parsed.data.note,
    source: "patient",
    patientId: user.id,
    organisationId: referral.organisation_id,
    specialistType: referral.specialist_type,
    uploaderId: user.id,
    client: supabase,
    serviceForExtraction: createServiceRoleClient(),
  });
}

/** A clinician asks for an uploaded report to be (re-)read. */
export async function extractSpecialistConsultationReportAction(
  documentId: string,
): Promise<SpecialistReportActionResult> {
  const gate = await requireClinicalStaff();
  if ("error" in gate) return { error: gate.error };
  const { supabase } = gate;

  const { data: doc } = await supabase
    .from("specialist_consultation_documents")
    .select("id, patient_id, organisation_id, file_path, mime_type, referral_id, specialist_referrals(specialist_type)")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return { error: "That report is not in your organisation." };

  const referral = doc.specialist_referrals as { specialist_type?: string } | null;

  const outcome = await runSpecialistReportExtraction(createServiceRoleClient(), {
    documentId: doc.id,
    referralId: doc.referral_id,
    patientId: doc.patient_id,
    organisationId: doc.organisation_id,
    filePath: doc.file_path,
    mimeType: doc.mime_type,
    contextHint: referral?.specialist_type ?? null,
  });

  revalidatePath(`/clinician/referrals/${doc.referral_id}`);
  if (outcome.status === "failed") return { error: outcome.message };
  return { success: true, message: outcome.message };
}

/**
 * A clinician confirms the drafted extraction — files it onto the referral
 * (treatment_plan_received_at/plan_acknowledged_at) and creates one
 * specialist_referral_action_items row per accepted recommendation, each
 * immediately routed by the DB trigger. Goes through
 * public.confirm_specialist_consultation_extraction for the same reasons
 * confirmLabReportExtraction goes through its own RPC: one transaction,
 * server-derived attribution, no race between two review tabs.
 */
export async function confirmSpecialistConsultationExtractionAction(
  input: unknown,
): Promise<SpecialistReportActionResult> {
  const parsed = confirmSpecialistConsultationExtractionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { extraction_id, diagnosis, accepted_recommendations, follow_up_interval_days, report_date } = parsed.data;

  const gate = await requireClinicalStaff();
  if ("error" in gate) return { error: gate.error };
  const { supabase } = gate;

  const { data: extraction } = await supabase
    .from("specialist_consultation_extractions")
    .select("id, patient_id, referral_id")
    .eq("id", extraction_id)
    .maybeSingle();
  if (!extraction) return { error: "That extraction is not in your organisation." };

  const { data: result, error } = await supabase.rpc("confirm_specialist_consultation_extraction", {
    p_extraction_id: extraction_id,
    p_diagnosis: diagnosis,
    p_accepted_recommendations: accepted_recommendations as unknown as Json,
    p_follow_up_interval_days: follow_up_interval_days ?? undefined,
    p_report_date: report_date ?? undefined,
  });
  if (error) return { error: error.message };

  revalidatePath(`/clinician/referrals/${extraction.referral_id}`);
  revalidatePath("/patient/referrals");
  revalidatePath("/clinician/outreach");
  revalidatePath("/dashboard/care-coordinator/outreach");

  const created = (result as { action_items_created?: number } | null)?.action_items_created ?? accepted_recommendations.length;
  return {
    success: true,
    message: `Filed the specialist's plan and created ${created} tracked action item${created === 1 ? "" : "s"}.`,
  };
}

/** A reviewer rejects the whole draft — the plan still needs entering by hand. */
export async function discardSpecialistConsultationExtractionAction(
  extractionId: string,
): Promise<SpecialistReportActionResult> {
  const gate = await requireClinicalStaff();
  if ("error" in gate) return { error: gate.error };
  const { supabase } = gate;

  const { data: extraction } = await supabase
    .from("specialist_consultation_extractions")
    .select("id, referral_id, status")
    .eq("id", extractionId)
    .maybeSingle();
  if (!extraction) return { error: "That extraction is not in your organisation." };
  if (extraction.status === "confirmed") return { error: "This report has already been filed and cannot be discarded." };

  const service = createServiceRoleClient();
  await service.from("specialist_consultation_extractions").update({ status: "discarded" }).eq("id", extractionId);

  revalidatePath(`/clinician/referrals/${extraction.referral_id}`);
  return { success: true, message: "Draft discarded." };
}

/** A clinician adds a tracked action item by hand — no document behind it,
 * e.g. from a phone call with the specialist. Immediately routed by the same
 * DB trigger a confirmed extraction's items go through. */
export async function addSpecialistReferralActionItemAction(
  input: unknown,
): Promise<SpecialistReportActionResult> {
  const parsed = addSpecialistReferralActionItemSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const gate = await requireClinicalStaff();
  if ("error" in gate) return { error: gate.error };
  const { supabase } = gate;

  const { error } = await supabase.from("specialist_referral_action_items").insert({
    referral_id: parsed.data.referral_id,
    action_type: parsed.data.action_type,
    description: parsed.data.description,
    due_at: parsed.data.due_at ?? null,
  } as never);
  if (error) return { error: error.message };

  revalidatePath(`/clinician/referrals/${parsed.data.referral_id}`);
  revalidatePath("/clinician/outreach");
  revalidatePath("/dashboard/care-coordinator/outreach");
  return { success: true, message: "Action item created and routed to the right worklist." };
}
