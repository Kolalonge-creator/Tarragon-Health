"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { IMAGING_REPORT_BUCKET } from "./documents";
import { extractImagingReport, isImagingReportExtractionConfigured } from "./extract";
import { deriveImagingAiSummaryStatus } from "./ai-summary";
import { isReadableDocumentType, normaliseForVision } from "@/lib/lab-reports/heic";
import { AI_SYSTEMS, decideAiGovernance, recordAiInteraction } from "@/lib/ai-governance";

// Same convention as EXTRACTION_MODEL_ID in lib/lab-reports/extraction-actions.ts
// and lib/ecg-reports/extraction-actions.ts — named once rather than repeated
// as a literal at each recordAiInteraction call site.
const EXTRACTION_MODEL_ID = "claude-sonnet-5";

/**
 * Read an uploaded imaging/radiology report into a patient-facing automated
 * summary. Runs under the SERVICE-ROLE client and takes the document's own
 * ids as arguments — mirrors runLabReportExtraction/runEcgReportExtraction
 * exactly in shape and discipline, deliberately narrower in scope than
 * either: there is no confirmable draft here and nothing is ever filed into
 * imaging_reports (that stays entirely clinician-filed and manual, see
 * fileImagingReport in lib/imaging-reports/actions.ts) — this function's
 * only output is the ai_summary_status/ai_impression_text/
 * ai_impression_flagged columns on imaging_report_documents itself.
 *
 * NEVER THROWS. Every failure leaves ai_summary_status = 'unavailable' and
 * changes nothing else — the raw uploaded file and the existing
 * clinician-review alert are completely unaffected either way.
 *
 * AI-016 is registered DISABLED pending a real evaluation + Clinical
 * Director approval (see 20260922190712_ai016_imaging_report_extraction_registration.sql)
 * — decideAiGovernance will correctly report `allow: false` until a human
 * closes that gate, at which point this function starts actually reading
 * documents with no further code change needed.
 */
export async function runImagingReportExtraction(
  service: SupabaseClient<Database>,
  params: {
    documentId: string;
    patientId: string;
    filePath: string;
    mimeType: string | null;
  },
): Promise<{ status: "extracted" | "failed"; message: string }> {
  const { documentId, patientId, filePath, mimeType } = params;

  const fail = async (message: string, errorMessage: string) => {
    try {
      await service
        .from("imaging_report_documents")
        .update({
          ai_summary_status: "unavailable",
          ai_impression_text: null,
          ai_impression_flagged: null,
          ai_summary_generated_at: new Date().toISOString(),
        })
        .eq("id", documentId);
    } catch (error) {
      console.error("imaging-reports: could not persist AI summary status", error);
    }
    console.error(`imaging-reports: extraction failed for ${documentId}: ${errorMessage}`);
    return { status: "failed" as const, message };
  };

  if (!mimeType) {
    return fail("This file has no recorded type.", "No mime type recorded on the document.");
  }
  if (!isReadableDocumentType(mimeType)) {
    return fail("This file type cannot be read automatically.", `Unsupported media type: ${mimeType}`);
  }
  if (!isImagingReportExtractionConfigured()) {
    return fail("Automatic reading is not configured on this environment.", "ANTHROPIC_API_KEY is not set.");
  }

  // -- AI-016 governance gate -------------------------------------------------
  // Checked BEFORE the storage download/HEIC-normalisation below, not after:
  // AI-016 ships registered DISABLED (pending evaluation + approval), so
  // right now this gate is the ONLY thing every imaging upload hits — doing
  // the download/normalise first would mean paying that real network + CPU
  // cost on 100% of uploads purely to discard the result at this check.
  const governance = await decideAiGovernance(service, AI_SYSTEMS.imagingReportExtraction.code);
  if (!governance.allow) {
    await recordAiInteraction(service, {
      systemCode: AI_SYSTEMS.imagingReportExtraction.code,
      modelIdentifier: "none:fallback",
      inputCategory: "imaging_report_document",
      status: "fallback",
      subjectProfileId: patientId,
      fallbackReason: governance.message,
      resultingAction: "no_automated_summary",
      resultingEntityType: "imaging_report_documents",
      resultingEntityId: documentId,
    });
    return fail("Automatic reading is not turned on for imaging reports yet.", `AI governance: ${governance.reason}`);
  }

  let fileBase64: string;
  let visionMediaType: string = mimeType;
  try {
    const { data: file, error } = await service.storage.from(IMAGING_REPORT_BUCKET).download(filePath);
    if (error || !file) throw error ?? new Error("Not found in storage");

    // Same HEIC-to-vision-readable conversion every other extraction pipeline
    // in this codebase uses — an iPhone photographing a printed report is the
    // common case, and the bucket accepts HEIC while the vision model cannot
    // read it directly.
    const normalised = await normaliseForVision(Buffer.from(await file.arrayBuffer()), mimeType);
    fileBase64 = normalised.buffer.toString("base64");
    visionMediaType = normalised.mediaType;
  } catch (error) {
    console.error("imaging-reports: could not download document", error);
    return fail("Could not open the stored report file.", "Download failed.");
  }

  const startedAt = Date.now();
  const result = await extractImagingReport({ fileBase64, mediaType: visionMediaType });

  if (!result.ok) {
    await recordAiInteraction(service, {
      systemCode: AI_SYSTEMS.imagingReportExtraction.code,
      modelIdentifier: EXTRACTION_MODEL_ID,
      inputCategory: "imaging_report_document",
      status: "failed",
      subjectProfileId: patientId,
      errorMessage: `Extraction failed: ${result.reason}`,
      latencyMs: Date.now() - startedAt,
      resultingAction: "no_automated_summary",
      resultingEntityType: "imaging_report_documents",
      resultingEntityId: documentId,
    });
    return fail(
      result.reason === "unsupported_type"
        ? "This file type cannot be read automatically."
        : result.reason === "unavailable"
          ? "Automatic reading is not configured on this environment."
          : "Automatic reading failed.",
      `Extraction failed: ${result.reason}`,
    );
  }

  const { extraction } = result;
  const status = deriveImagingAiSummaryStatus(extraction);

  try {
    await service
      .from("imaging_report_documents")
      .update({
        ai_summary_status: status,
        ai_impression_text: extraction.impressionText,
        ai_impression_flagged: extraction.impressionIndicatesFinding,
        ai_summary_generated_at: new Date().toISOString(),
      })
      .eq("id", documentId);
  } catch (error) {
    console.error("imaging-reports: could not persist AI summary status", error);
  }

  // 40.11. Never the transcribed impression text itself — only counts and
  // provenance, same discipline as the lab/ECG pipelines' own audit rows.
  await recordAiInteraction(service, {
    systemCode: AI_SYSTEMS.imagingReportExtraction.code,
    modelIdentifier: EXTRACTION_MODEL_ID,
    inputCategory: "imaging_report_document",
    status: "completed",
    subjectProfileId: patientId,
    outputSummary: `impression ${extraction.impressionText ? "read" : "not found"}${
      extraction.impressionText ? `, indicates_finding=${extraction.impressionIndicatesFinding}` : ""
    }${extraction.unreadableReason ? `, unreadable: ${extraction.unreadableReason}` : ""}`,
    latencyMs: Date.now() - startedAt,
    resultingAction: "patient_facing_summary_only",
    resultingEntityType: "imaging_report_documents",
    resultingEntityId: documentId,
  });

  return {
    status: "extracted",
    message: extraction.impressionText
      ? "Read the report's own impression."
      : "Nothing could be read from this report.",
  };
}
