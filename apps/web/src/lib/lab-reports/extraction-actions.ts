"use server";

import { revalidatePath } from "next/cache";
import type { Json } from "@tarragon/shared";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { RESULT_DOC_BUCKET } from "@/lib/lab-results/documents";
import { extractLabReport, isLabReportExtractionConfigured } from "./extract";
import { getAnalyte } from "./analyte-catalogue";
import { confirmLabReportExtractionSchema } from "@/lib/validation/lab-report-extraction";

export type ExtractionActionResult = { error?: string; success?: boolean; message?: string };

const EXTRACTION_MODEL_ID = "claude-sonnet-5";

/**
 * Only an active clinical_staff member may run or confirm an extraction.
 *
 * Same gate as `markResultDocumentReviewed`: transcribing a lab report into a
 * patient's permanent record is a clinical act, so a Care Coordinator (org
 * staff, non-clinical) is excluded by the platform's standing write guardrail.
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
    return { error: "Only a Tarragon care-team doctor can file results from a report." as const };
  }
  return { user, supabase, staffId: staff.id };
}

/**
 * Read an uploaded lab report and draft the results it contains.
 *
 * Produces a DRAFT for a clinician to check against the original document. It
 * writes nothing to `lab_analyte_readings`, raises no alert, and reaches no
 * patient — `confirmLabReportExtraction` is the only path from here into the
 * clinical record.
 *
 * Never blocks: a failure is persisted as a `failed` row so the reviewer sees
 * why, and the existing manual-entry form remains completely usable.
 */
export async function extractLabReportAction(documentId: string): Promise<ExtractionActionResult> {
  const gate = await requireClinicalStaff();
  if ("error" in gate) return { error: gate.error };
  const { supabase } = gate;

  // Read the document through the caller's OWN session, so org-scoped RLS on
  // lab_result_documents is the real authorisation check — a clinician cannot
  // extract a document belonging to another organisation's patient.
  const { data: doc } = await supabase
    .from("lab_result_documents")
    .select("id, patient_id, organisation_id, file_path, mime_type, lab_order_id")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return { error: "That report is not in your organisation." };

  // mime_type is nullable on lab_result_documents. Without it we cannot tell
  // the model whether it is reading a PDF or an image, and guessing would send
  // a malformed content block — refuse rather than fail obscurely downstream.
  if (!doc.mime_type) {
    return { error: "This file has no recorded type, so it cannot be read automatically." };
  }

  if (!isLabReportExtractionConfigured()) {
    return { error: "Automatic reading is not configured on this environment." };
  }

  const service = createServiceRoleClient();

  const { data: file, error: downloadError } = await service.storage
    .from(RESULT_DOC_BUCKET)
    .download(doc.file_path);
  if (downloadError || !file) {
    return { error: "Could not open the stored report file." };
  }

  const fileBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  // Give the model the ordered panel as a hint, but the prompt explicitly tells
  // it to transcribe what is actually on the page regardless — a hint must
  // never become an expectation the model satisfies by inventing rows.
  let contextHint: string | null = null;
  if (doc.lab_order_id) {
    const { data: order } = await supabase
      .from("lab_orders")
      .select("panel_bundle_id, panel_bundles(name)")
      .eq("id", doc.lab_order_id)
      .maybeSingle();
    const bundle = order?.panel_bundles as { name?: string } | null;
    contextHint = bundle?.name ?? null;
  }

  const result = await extractLabReport({
    fileBase64,
    mediaType: doc.mime_type,
    contextHint,
  });

  const baseRow = {
    organisation_id: doc.organisation_id,
    patient_id: doc.patient_id,
    document_id: doc.id,
    model_id: EXTRACTION_MODEL_ID,
    confirmed_by: null,
    confirmed_at: null,
    confirmed_codes: [] as unknown as Json,
  };

  if (!result.ok) {
    await service.from("lab_report_extractions").upsert(
      {
        ...baseRow,
        status: "failed",
        rows: [] as unknown as Json,
        error_message:
          result.reason === "unsupported_type"
            ? "This file type cannot be read automatically. Enter the results by hand."
            : result.reason === "unavailable"
              ? "Automatic reading is not configured on this environment."
              : "Automatic reading failed. Enter the results by hand.",
        report_date: null,
        lab_name: null,
        patient_name_on_report: null,
        unreadable_reason: null,
      },
      { onConflict: "document_id" },
    );
    revalidatePath(`/clinician/patients/${doc.patient_id}`);
    return { error: "Could not read this report automatically. Enter the results by hand." };
  }

  const { extraction } = result;
  const { error: upsertError } = await service.from("lab_report_extractions").upsert(
    {
      ...baseRow,
      status: "extracted",
      rows: extraction.rows as unknown as Json,
      report_date: extraction.reportDate,
      lab_name: extraction.labName,
      patient_name_on_report: extraction.patientNameOnReport,
      unreadable_reason: extraction.unreadableReason,
      error_message: null,
    },
    { onConflict: "document_id" },
  );
  if (upsertError) return { error: upsertError.message };

  revalidatePath(`/clinician/patients/${doc.patient_id}`);

  const readyCount = extraction.rows.filter((r) => r.status === "ready").length;
  return {
    success: true,
    message:
      readyCount > 0
        ? `Read ${readyCount} result${readyCount === 1 ? "" : "s"}. Check them against the report before filing.`
        : "Nothing could be read from this report. Enter the results by hand.",
  };
}

/**
 * A clinician confirms the drafted results, which files them into the patient's
 * permanent record.
 *
 * The values written are the ones the REVIEWER submitted, not the ones the
 * model drafted — the review screen lets them correct any figure, and this
 * action re-validates every code and value from scratch.
 *
 * DELIBERATELY DOES NOT record a `screening_results` row or touch the abnormal-
 * result pipeline. Filing numbers and declaring a result abnormal are two
 * separate clinical acts, and this codebase already draws that line: see
 * `markResultDocumentReviewed`, which says the same thing for the same reason.
 * A clinician who wants to record an abnormal finding does it through the
 * screening-result form, deliberately.
 */
export async function confirmLabReportExtraction(
  input: unknown,
): Promise<ExtractionActionResult> {
  const parsed = confirmLabReportExtractionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { extraction_id: extractionId, report_date: reportDate, rows } = parsed.data;

  const gate = await requireClinicalStaff();
  if ("error" in gate) return { error: gate.error };
  const { user, supabase } = gate;

  // Read through the caller's own session — the org-staff select policy on
  // lab_report_extractions is the cross-tenant gate.
  const { data: extraction } = await supabase
    .from("lab_report_extractions")
    .select("id, patient_id, organisation_id, status")
    .eq("id", extractionId)
    .maybeSingle();
  if (!extraction) return { error: "That extraction is not in your organisation." };
  if (extraction.status === "confirmed") {
    return { error: "These results have already been filed." };
  }
  if (extraction.status === "failed") {
    return { error: "This report could not be read, so there is nothing to file." };
  }

  // Stamp every reading with the report's own collection date, at midday UTC so
  // a timezone shift can never move it across a day boundary and reorder a
  // trend.
  const takenAt = new Date(`${reportDate}T12:00:00Z`).toISOString();

  // Written through the caller's session so lab_analyte_readings' own RLS
  // applies, exactly as `submitScreeningResult` does.
  const { error: insertError } = await supabase.from("lab_analyte_readings").insert(
    rows.map((row) => ({
      organisation_id: extraction.organisation_id,
      patient_id: extraction.patient_id,
      code: row.code,
      value: row.value,
      unit: getAnalyte(row.code)?.canonicalUnit ?? "",
      taken_at: takenAt,
    })),
  );
  if (insertError) return { error: insertError.message };

  const service = createServiceRoleClient();
  await service
    .from("lab_report_extractions")
    .update({
      status: "confirmed",
      confirmed_by: user.id,
      confirmed_at: new Date().toISOString(),
      confirmed_codes: rows.map((r) => r.code) as unknown as Json,
      report_date: reportDate,
    })
    .eq("id", extractionId);

  revalidatePath(`/clinician/patients/${extraction.patient_id}`);
  revalidatePath("/patient");

  return {
    success: true,
    message: `Filed ${rows.length} result${rows.length === 1 ? "" : "s"} to the patient's record.`,
  };
}

/** A reviewer rejects the whole draft — the report still needs entering by hand. */
export async function discardLabReportExtraction(
  extractionId: string,
): Promise<ExtractionActionResult> {
  const gate = await requireClinicalStaff();
  if ("error" in gate) return { error: gate.error };
  const { supabase } = gate;

  const { data: extraction } = await supabase
    .from("lab_report_extractions")
    .select("id, patient_id, status")
    .eq("id", extractionId)
    .maybeSingle();
  if (!extraction) return { error: "That extraction is not in your organisation." };
  if (extraction.status === "confirmed") {
    return { error: "These results have already been filed and cannot be discarded." };
  }

  const service = createServiceRoleClient();
  await service.from("lab_report_extractions").update({ status: "discarded" }).eq("id", extractionId);

  revalidatePath(`/clinician/patients/${extraction.patient_id}`);
  return { success: true, message: "Draft discarded." };
}
