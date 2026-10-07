import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import { AI_SYSTEMS, runGovernedAi } from "@/lib/ai-governance";
import { isReadableDocumentType, normaliseForVision } from "@/lib/lab-reports/heic";
import {
  DOCUMENT_CAPTURE_MODEL_ID,
  extractDocumentSuggestions,
  type DocumentCaptureResult,
} from "./extract";
import { DOCUMENT_CAPTURE_TYPES, toSuggestionPayload, type DocumentCaptureType } from "./suggestions";

export const DOCUMENT_BUCKET = "patient-documents";
export const DOCUMENT_CAPTURE_GUARD = "document_capture_enabled";

export type CaptureRunStatus = "suggested" | "failed" | "not_pending" | "closed";

export interface CaptureRunOutcome {
  status: CaptureRunStatus;
  fieldCount: number;
  message: string;
}

export interface CaptureRunDeps {
  /** Injectable for tests. */
  extract?: typeof extractDocumentSuggestions;
}

function asDocumentType(value: string): DocumentCaptureType {
  return (DOCUMENT_CAPTURE_TYPES as readonly string[]).includes(value) ? (value as DocumentCaptureType) : "other";
}

/**
 * Reads one uploaded document into SUGGESTIONS and records them with
 * record_document_suggestion (the only writer of the reading columns).
 * Authorisation is the caller's job and is done before this is reached; this
 * runs under the service-role client.
 *
 * NEVER THROWS, and NEVER touches anything but the reading columns of the one
 * document: no medication, vital, lab result, alert or risk row is read or
 * written here, so an unconfirmed value cannot feed escalation or risk. Every
 * failure leaves the photo in place and tells the patient to type the details
 * by hand (the AI-018 fallback).
 *
 * The model call goes through runGovernedAi: the kill switch is honoured before
 * the model is reached, and every outcome reaches ai_interaction_log.
 */
export async function runDocumentCapture(
  service: SupabaseClient<Database>,
  documentId: string,
  deps: CaptureRunDeps = {}
): Promise<CaptureRunOutcome> {
  const extract = deps.extract ?? extractDocumentSuggestions;

  const { data: doc } = await service
    .from("patient_documents")
    .select("id, patient_id, document_type, file_path, ocr_state")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc || doc.ocr_state !== "pending") {
    return { status: "not_pending", fieldCount: 0, message: "That photo is not waiting to be read." };
  }

  const recordFailure = async (message: string): Promise<CaptureRunOutcome> => {
    await service.rpc("record_document_suggestion", {
      p_document: documentId,
      p_ocr_text: "",
      p_extracted: {} as Json,
      p_model: "none",
      p_failed: true,
    });
    return { status: "failed", fieldCount: 0, message };
  };

  let fileBase64: string;
  let mediaType: string;
  try {
    const { data: file, error } = await service.storage.from(DOCUMENT_BUCKET).download(doc.file_path);
    if (error || !file) throw error ?? new Error("Not found in storage");
    if (!isReadableDocumentType(file.type || null)) {
      return await recordFailure("This file type cannot be read automatically. Type the details in by hand.");
    }
    const normalised = await normaliseForVision(Buffer.from(await file.arrayBuffer()), file.type);
    fileBase64 = normalised.buffer.toString("base64");
    mediaType = normalised.mediaType;
  } catch (error) {
    console.error("document-capture: could not open the upload", error);
    return await recordFailure("Could not open the photo. Type the details in by hand.");
  }

  const documentType = asDocumentType(doc.document_type);
  const governed = await runGovernedAi<DocumentCaptureResult | null>({
    supabase: service,
    systemCode: AI_SYSTEMS.documentCapture.code,
    inputCategory: "patient_document_photo",
    subjectProfileId: doc.patient_id,
    run: async () => {
      const result = await extract({ fileBase64, mediaType, documentType });
      return {
        value: result,
        modelIdentifier: DOCUMENT_CAPTURE_MODEL_ID,
        // Counts only: the transcribed values stay on the patient's own row.
        outputSummary: result.ok ? `${result.suggestions.fields.length} suggested field(s)` : `failed: ${result.reason}`,
        resultingAction: result.ok ? "suggestions_awaiting_patient_confirmation" : "manual_entry_required",
        resultingEntityType: "patient_documents",
        resultingEntityId: documentId,
        degradedReason: result.ok ? null : `reading failed: ${result.reason}`,
      };
    },
    fallback: () => null,
  });

  const result = governed.value;
  if (!result || !result.ok) {
    return await recordFailure(
      result && !result.ok && result.reason === "unsupported_type"
        ? "This file type cannot be read automatically. Type the details in by hand."
        : "Automatic reading is not available just now. Type the details in by hand."
    );
  }

  const { suggestions } = result;
  if (suggestions.fields.length === 0) {
    return await recordFailure(
      suggestions.unreadableReason
        ? "That photo could not be read clearly. Try a straighter, brighter photo, or type the details in by hand."
        : "Nothing could be read from that photo. Type the details in by hand."
    );
  }

  const { error } = await service.rpc("record_document_suggestion", {
    p_document: documentId,
    p_ocr_text: suggestions.ocrText,
    p_extracted: toSuggestionPayload(suggestions) as unknown as Json,
    p_model: DOCUMENT_CAPTURE_MODEL_ID,
    p_failed: false,
  });
  if (error) {
    // 55000 is the capture guard being closed for this patient: nothing was stored.
    if (error.code === "55000") {
      return { status: "closed", fieldCount: 0, message: "Reading from photos is not open yet. Your photo is saved." };
    }
    console.error("document-capture: could not record suggestions", error);
    return { status: "failed", fieldCount: 0, message: "Could not save the reading. Type the details in by hand." };
  }
  return {
    status: "suggested",
    fieldCount: suggestions.fields.length,
    message: "Check each detail against your photo. Only the ones you confirm are kept.",
  };
}
