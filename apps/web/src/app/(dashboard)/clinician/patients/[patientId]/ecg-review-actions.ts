"use server";

import { createClient } from "@/lib/supabase/server";
import { loadEcgReportDocuments, type EcgReportDocumentView } from "@/lib/ecg-reports/documents";
import type { ExtractedParameter } from "@/lib/ecg-reports/extract";
import type { EcgExtractionView } from "./ecg-report-extraction-panel";

export interface EcgReviewData {
  documents: EcgReportDocumentView[];
  extractionByDocument: Record<string, EcgExtractionView>;
  patientName: string | null;
}

/**
 * Server-side fetch of a patient's ECG documents + drafts + signed URLs, for
 * the client-side EcgResultPanel embedded in screen-order-checklist.tsx to
 * call via React Query. Same underlying query as EcgReportDocumentsSection
 * (the always-visible "12-lead ECGs" card) — this exists because that
 * component is an async Server Component and can't be mounted from
 * client-triggered state the way ScreeningResultForm is; the data still comes
 * from the caller's own RLS-scoped session either way.
 */
export async function loadEcgReviewForPatient(patientId: string): Promise<EcgReviewData> {
  const supabase = await createClient();
  const documents = await loadEcgReportDocuments(supabase, patientId);

  const { data: extractionRows } = await supabase
    .from("ecg_report_extractions")
    .select(
      "id, document_id, status, report_date, facility_name, patient_name_on_report, looks_twelve_lead, parameters, unreadable_reason, error_message, confirmed_at, confirmed_codes",
    )
    .eq("patient_id", patientId);

  const extractionByDocument: Record<string, EcgExtractionView> = {};
  for (const row of extractionRows ?? []) {
    extractionByDocument[row.document_id] = {
      id: row.id,
      status: row.status as EcgExtractionView["status"],
      reportDate: row.report_date,
      facilityName: row.facility_name,
      patientNameOnReport: row.patient_name_on_report,
      looksTwelveLead: row.looks_twelve_lead ?? false,
      parameters: (row.parameters ?? []) as unknown as ExtractedParameter[],
      unreadableReason: row.unreadable_reason,
      errorMessage: row.error_message,
      confirmedAt: row.confirmed_at,
      confirmedCodes: (row.confirmed_codes ?? []) as unknown as string[],
    };
  }

  const { data: patient } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", patientId)
    .maybeSingle();

  return { documents, extractionByDocument, patientName: patient?.full_name ?? null };
}
