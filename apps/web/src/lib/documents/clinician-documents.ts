import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { signPatientDocumentPath } from "@/lib/documents/documents";

export { signPatientDocumentPath };

export interface ClinicianDocumentExtractionView {
  ocrStatus: Database["public"]["Enums"]["document_ocr_status"];
  suggestedDocumentType: Database["public"]["Enums"]["patient_document_type"] | null;
  classificationConfidence: number | null;
  classificationStatus: Database["public"]["Enums"]["document_classification_status"];
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface ClinicianDocumentDiscrepancyView {
  id: string;
  fieldDescription: string;
  existingValue: string | null;
  documentValue: string | null;
  conflictingTable: string | null;
  flaggedAt: string;
}

export interface ClinicianDocumentView {
  id: string;
  title: string;
  documentType: Database["public"]["Enums"]["patient_document_type"];
  status: Database["public"]["Enums"]["patient_document_status"];
  source: Database["public"]["Enums"]["patient_document_source"];
  documentDate: string | null;
  uploadedAt: string;
  originalFilename: string | null;
  signedUrl: string | null;
  isPdf: boolean;
  /** Present only once OCR has run on this document — its absence means "not
   * yet processed", not an error. */
  extraction: ClinicianDocumentExtractionView | null;
  /** Only OPEN discrepancies — a resolved one no longer needs a clinician's
   * attention on the chart. */
  openDiscrepancies: ClinicianDocumentDiscrepancyView[];
}

/**
 * Load a patient's documents for the clinician chart: everything except
 * 'created' (no file landed yet — nothing to show) and 'rejected' (failed
 * scan/validation, never became readable), newest first, each joined to its
 * OCR/classification extraction (if one exists) and any open discrepancies.
 *
 * Two follow-up queries by document_id, mirroring exactly the shape
 * ecg-report-documents-section.tsx uses for ecg_report_extractions — RLS on
 * both extraction and discrepancy tables is the real gate (a patient never
 * reaches either through this loader, but org-staff RLS also independently
 * protects them), this just avoids an N+1 by batching per document set.
 */
export async function loadPatientDocumentsForChart(
  supabase: SupabaseClient<Database>,
  patientId: string
): Promise<ClinicianDocumentView[]> {
  const { data: rows } = await supabase
    .from("patient_documents")
    .select(
      "id, title, document_type, status, source, document_date, uploaded_at, original_filename, mime_type, file_path"
    )
    .eq("patient_id", patientId)
    .not("status", "in", "(created,rejected)")
    .order("uploaded_at", { ascending: false });

  if (!rows || rows.length === 0) return [];

  const documentIds = rows.map((row) => row.id);

  const { data: extractionRows } = await supabase
    .from("patient_document_extractions")
    .select(
      "document_id, ocr_status, suggested_document_type, classification_confidence, classification_status, reviewed_at, review_note"
    )
    .in("document_id", documentIds);

  const extractionByDocument = new Map<string, ClinicianDocumentExtractionView>(
    (extractionRows ?? []).map((row) => [
      row.document_id,
      {
        ocrStatus: row.ocr_status,
        suggestedDocumentType: row.suggested_document_type,
        classificationConfidence: row.classification_confidence,
        classificationStatus: row.classification_status,
        reviewedAt: row.reviewed_at,
        reviewNote: row.review_note,
      },
    ])
  );

  const { data: discrepancyRows } = await supabase
    .from("patient_document_discrepancies")
    .select("id, document_id, field_description, existing_value, document_value, conflicting_table, flagged_at")
    .in("document_id", documentIds)
    .eq("status", "open")
    .order("flagged_at", { ascending: false });

  const discrepanciesByDocument = new Map<string, ClinicianDocumentDiscrepancyView[]>();
  for (const row of discrepancyRows ?? []) {
    const list = discrepanciesByDocument.get(row.document_id) ?? [];
    list.push({
      id: row.id,
      fieldDescription: row.field_description,
      existingValue: row.existing_value,
      documentValue: row.document_value,
      conflictingTable: row.conflicting_table,
      flaggedAt: row.flagged_at,
    });
    discrepanciesByDocument.set(row.document_id, list);
  }

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      title: row.title,
      documentType: row.document_type,
      status: row.status,
      source: row.source,
      documentDate: row.document_date,
      uploadedAt: row.uploaded_at,
      originalFilename: row.original_filename,
      signedUrl: row.file_path ? await signPatientDocumentPath(row.file_path) : null,
      isPdf: row.mime_type === "application/pdf",
      extraction: extractionByDocument.get(row.id) ?? null,
      openDiscrepancies: discrepanciesByDocument.get(row.id) ?? [],
    }))
  );
}
