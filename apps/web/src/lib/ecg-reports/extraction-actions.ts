"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { ECG_REPORT_BUCKET } from "./documents";
import { extractEcgReport, isEcgReportExtractionConfigured } from "./extract";
import { isReadableDocumentType, normaliseForVision } from "@/lib/lab-reports/heic";
import { confirmEcgReportExtractionSchema } from "@/lib/validation/ecg-report-extraction";

export type EcgExtractionActionResult = { error?: string; success?: boolean; message?: string };

const EXTRACTION_MODEL_ID = "claude-sonnet-5";

/**
 * Only an active clinical_staff member may run or confirm an extraction from
 * the clinician surface. Same reasoning as lib/lab-reports/extraction-actions.ts's
 * own gate: transcribing an ECG into a patient's permanent record is a
 * clinical act, so a Care Coordinator (org staff, non-clinical) is excluded
 * by the platform's standing write guardrail.
 *
 * The automatic-on-upload path (runEcgReportExtraction, below) deliberately
 * does NOT use this gate — a patient uploading their own ECG has no
 * clinical_staff row, and drafting is not a clinical act. Filing is, and that
 * still goes through this gate and through the confirm RPC's own check.
 */
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
    return { error: "Only a Tarragon care-team doctor can file parameters from an ECG." as const };
  }
  return { user, supabase, staffId: staff.id };
}

/**
 * Read an uploaded ECG into a draft.
 *
 * Runs under the SERVICE-ROLE client and takes the document's own ids as
 * arguments, because it serves two callers with very different sessions: a
 * clinician pressing "read this ECG", and the upload path, where the acting
 * session may be a patient uploading their own tracing. Authorisation is the
 * caller's job and is done before this is reached.
 *
 * NEVER THROWS. Every failure persists a `failed` row and leaves the manual
 * procedural_status entry exactly as it was. Extraction being down must
 * never stop a result reaching a doctor.
 *
 * No corpus/template-learning pass (unlike the lab pipeline) — the ECG
 * parameter vocabulary is small and stable across cart brands, so a single
 * unhinted pass is the whole of it for v1.
 */
export async function runEcgReportExtraction(
  service: SupabaseClient<Database>,
  params: {
    documentId: string;
    patientId: string;
    organisationId: string;
    filePath: string;
    mimeType: string | null;
    contextHint?: string | null;
  },
): Promise<{ status: "extracted" | "failed"; readyCount: number; message: string }> {
  const { documentId, patientId, organisationId, filePath, mimeType } = params;

  const fail = async (message: string, errorMessage: string) => {
    try {
      await service.from("ecg_report_extractions").upsert(
        {
          organisation_id: organisationId,
          patient_id: patientId,
          document_id: documentId,
          model_id: EXTRACTION_MODEL_ID,
          status: "failed",
          parameters: [] as unknown as Json,
          error_message: errorMessage,
          report_date: null,
          facility_name: null,
          patient_name_on_report: null,
          looks_twelve_lead: null,
          unreadable_reason: null,
          confirmed_by: null,
          confirmed_at: null,
          confirmed_codes: [] as unknown as Json,
        },
        { onConflict: "document_id" },
      );
    } catch (error) {
      console.error("ecg-reports: could not persist failure", error);
    }
    return { status: "failed" as const, readyCount: 0, message };
  };

  if (!mimeType) {
    return fail(
      "This file has no recorded type, so it cannot be read automatically.",
      "No mime type recorded on the document.",
    );
  }
  if (!isReadableDocumentType(mimeType)) {
    return fail(
      "This file type cannot be read automatically. Enter the parameters by hand.",
      `Unsupported media type: ${mimeType}`,
    );
  }
  if (!isEcgReportExtractionConfigured()) {
    return fail(
      "Automatic reading is not configured on this environment.",
      "ANTHROPIC_API_KEY is not set.",
    );
  }

  let fileBase64: string;
  let visionMediaType: string = mimeType;
  try {
    const { data: file, error } = await service.storage.from(ECG_REPORT_BUCKET).download(filePath);
    if (error || !file) throw error ?? new Error("Not found in storage");

    // An iPhone photographing a printed ECG produces HEIC, same as a
    // photographed lab report — reuses lib/lab-reports/heic.ts rather than
    // duplicating the conversion. Never throws.
    const normalised = await normaliseForVision(Buffer.from(await file.arrayBuffer()), mimeType);
    fileBase64 = normalised.buffer.toString("base64");
    visionMediaType = normalised.mediaType;
  } catch (error) {
    console.error("ecg-reports: could not download document", error);
    return fail("Could not open the stored ECG file.", "Download failed.");
  }

  const result = await extractEcgReport({
    fileBase64,
    mediaType: visionMediaType,
    contextHint: params.contextHint ?? null,
  });

  if (!result.ok) {
    return fail(
      result.reason === "unsupported_type"
        ? "This file type cannot be read automatically. Enter the parameters by hand."
        : result.reason === "unavailable"
          ? "Automatic reading is not configured on this environment."
          : "Automatic reading failed. Enter the parameters by hand.",
      `Extraction failed: ${result.reason}`,
    );
  }

  const extraction = result.extraction;
  const parameters = extraction.parameters;
  const readyCount = parameters.filter((p) => p.status === "ready").length;

  const { error: upsertError } = await service.from("ecg_report_extractions").upsert(
    {
      organisation_id: organisationId,
      patient_id: patientId,
      document_id: documentId,
      model_id: EXTRACTION_MODEL_ID,
      status: "extracted",
      parameters: parameters as unknown as Json,
      report_date: extraction.reportDate,
      facility_name: extraction.facilityName,
      patient_name_on_report: extraction.patientNameOnReport,
      looks_twelve_lead: extraction.looksTwelveLead,
      unreadable_reason: extraction.unreadableReason,
      error_message: null,
      confirmed_by: null,
      confirmed_at: null,
      confirmed_codes: [] as unknown as Json,
    },
    { onConflict: "document_id" },
  );
  if (upsertError) {
    return fail("Could not save the draft.", upsertError.message);
  }

  // Deliberately no escalation bridge here — unlike the lab pipeline's
  // raise_lab_extraction_alert on a critical lab value, nothing about this
  // draft ever raises an alert priority. This module transcribes; it does
  // not decide anything is clinically critical. See CLAUDE.md's ECG feature
  // notes for the reasoning.

  return {
    status: "extracted",
    readyCount,
    message:
      readyCount > 0
        ? `Read ${readyCount} parameter${readyCount === 1 ? "" : "s"}. Check them against the tracing before filing.`
        : "Nothing could be read from this ECG. Enter the parameters by hand.",
  };
}

/**
 * A clinician asks for an uploaded ECG to be read (or re-read).
 *
 * Authorisation is the document's own RLS through the caller's session: a
 * clinician cannot extract a document belonging to another organisation's
 * patient. Only after that does the service-role client run.
 */
export async function extractEcgReportAction(documentId: string): Promise<EcgExtractionActionResult> {
  const gate = await requireClinicalStaff();
  if ("error" in gate) return { error: gate.error };
  const { supabase } = gate;

  const { data: doc } = await supabase
    .from("ecg_report_documents")
    .select("id, patient_id, organisation_id, file_path, mime_type")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return { error: "That ECG is not in your organisation." };

  const outcome = await runEcgReportExtraction(createServiceRoleClient(), {
    documentId: doc.id,
    patientId: doc.patient_id,
    organisationId: doc.organisation_id,
    filePath: doc.file_path,
    mimeType: doc.mime_type,
  });

  revalidatePath(`/clinician/patients/${doc.patient_id}`);
  if (outcome.status === "failed") return { error: outcome.message };
  return { success: true, message: outcome.message };
}

/**
 * A clinician confirms the drafted parameters, filing them into the
 * patient's permanent record.
 *
 * The values written are the ones the REVIEWER submitted, not the ones the
 * model drafted — the review screen lets them correct any figure, and the
 * schema re-validates every code and value from scratch.
 *
 * Filing goes through public.confirm_ecg_report_extraction rather than a
 * direct insert, for the same reasons as the lab pipeline's confirm RPC: the
 * already-filed check and the write happen in ONE transaction, and
 * confirmed_by is derived inside the database from the caller's own active
 * clinical_staff row.
 *
 * DELIBERATELY DOES NOT record a `screening_results` row. Filing parameters
 * and the clinician's own procedural_status judgement stay two separate,
 * both-required acts.
 */
export async function confirmEcgReportExtraction(input: unknown): Promise<EcgExtractionActionResult> {
  const parsed = confirmEcgReportExtractionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { extraction_id: extractionId, report_date: reportDate, parameters } = parsed.data;

  const gate = await requireClinicalStaff();
  if ("error" in gate) return { error: gate.error };
  const { supabase } = gate;

  const { data: extraction } = await supabase
    .from("ecg_report_extractions")
    .select("id, patient_id")
    .eq("id", extractionId)
    .maybeSingle();
  if (!extraction) return { error: "That extraction is not in your organisation." };

  const { data: filed, error } = await supabase.rpc("confirm_ecg_report_extraction", {
    p_extraction_id: extractionId,
    p_readings: parameters.map((p) => ({
      code: p.code,
      value: p.value ?? null,
      value_text: p.value_text ?? null,
      unit: p.unit ?? null,
    })) as unknown as Json,
    p_report_date: reportDate,
  });
  if (error) return { error: error.message };

  revalidatePath(`/clinician/patients/${extraction.patient_id}`);
  revalidatePath("/patient");

  const count = typeof filed === "number" ? filed : parameters.length;
  return {
    success: true,
    message: `Filed ${count} parameter${count === 1 ? "" : "s"} to the patient's record.`,
  };
}

/** A reviewer rejects the whole draft — the ECG still needs entering by hand. */
export async function discardEcgReportExtraction(extractionId: string): Promise<EcgExtractionActionResult> {
  const gate = await requireClinicalStaff();
  if ("error" in gate) return { error: gate.error };
  const { supabase } = gate;

  const { data: extraction } = await supabase
    .from("ecg_report_extractions")
    .select("id, patient_id, status")
    .eq("id", extractionId)
    .maybeSingle();
  if (!extraction) return { error: "That extraction is not in your organisation." };
  if (extraction.status === "confirmed") {
    return { error: "These parameters have already been filed and cannot be discarded." };
  }

  const service = createServiceRoleClient();
  await service.from("ecg_report_extractions").update({ status: "discarded" }).eq("id", extractionId);

  revalidatePath(`/clinician/patients/${extraction.patient_id}`);
  return { success: true, message: "Draft discarded." };
}
