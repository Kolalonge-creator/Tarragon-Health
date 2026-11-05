import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createScannerClientFromEnv, type Database, type ScannerClient } from "@tarragon/shared";
import { fileSha256 } from "@/lib/clinical-documents/fingerprint";
import { scanBytes } from "./screen";
import { runLabReportExtraction } from "@/lib/lab-reports/extraction-actions";
import { runEcgReportExtraction } from "@/lib/ecg-reports/extraction-actions";
import { runImagingReportExtraction } from "@/lib/imaging-reports/extraction-actions";
import { runDocumentClassification } from "@/lib/clinical-documents/classify-run";
import { testCodeLabel } from "@/lib/labs/test-code-labels";

/**
 * T2-08 retry: rescan intake documents held as 'pending_scan' (the scanner was down when they arrived), and backfill 'unscanned'
 * ones once the scanner is configured. Run first in the daily clinical-document retry (/api/cron/clinical-document-retry), so a
 * document cleared here is read by the readers' retry in the same run. Back-off and attempt counting live in the database
 * (public.apply_upload_scan_verdict); ops sees held documents through the ops_incidents row it keeps current.
 *
 * Never throws. Returns what it did, plus `cleared`: the held documents that are now clean and still need their reader started.
 */

export type ClearedDocument = { documentId: string; routedTable: string | null; routedId: string | null };

export type RescanSummary = {
  skipped?: "scanner_off";
  considered: number;
  clean: number;
  infected: number;
  stillHeld: number;
  errors: number;
  held: number | null;
  cleared: ClearedDocument[];
};

export async function rescanHeldUploads(
  service: SupabaseClient<Database>,
  client: ScannerClient | null = createScannerClientFromEnv(),
  limit = 50,
): Promise<RescanSummary> {
  const summary: RescanSummary = { considered: 0, clean: 0, infected: 0, stillHeld: 0, errors: 0, held: null, cleared: [] };
  if (!client) {
    summary.skipped = "scanner_off";
  } else {
    const { data: due, error } = await service.rpc("upload_scan_due", { p_limit: limit, p_include_unscanned: true });
    if (error) {
      console.error("upload-scan: could not list documents to scan", error.message);
      summary.errors += 1;
    }
    for (const doc of due ?? []) {
      summary.considered += 1;
      try {
        const { data: file, error: downloadError } = await service.storage.from(doc.bucket).download(doc.file_path);
        let facts;
        if (downloadError || !file) {
          facts = { verdict: "unavailable" as const, signature: null, engineVersion: null, dbVersion: null, detail: "stored file could not be read" };
        } else {
          facts = await scanBytes(client, file, await fileSha256(file));
        }
        const { data: status, error: applyError } = await service.rpc("apply_upload_scan_verdict", {
          p_document: doc.document_id,
          p_verdict: facts.verdict,
          p_signature: facts.signature as string,
          p_engine_version: facts.engineVersion as string,
          p_db_version: facts.dbVersion as string,
          p_error: facts.detail as string,
        });
        if (applyError) throw applyError;
        if (status === "clean") {
          summary.clean += 1;
          if (doc.scan_status === "pending_scan") {
            summary.cleared.push({ documentId: doc.document_id, routedTable: doc.routed_table, routedId: doc.routed_id });
          }
        } else if (status === "infected") summary.infected += 1;
        else summary.stillHeld += doc.scan_status === "pending_scan" ? 1 : 0;
      } catch (err) {
        console.error("upload-scan: rescan failed for a document", err);
        summary.errors += 1;
      }
    }
  }
  try {
    const { data } = await service.rpc("upload_scan_backlog_check");
    summary.held = typeof data === "number" ? data : null;
  } catch (err) {
    console.error("upload-scan: backlog check failed", err);
  }
  return summary;
}

/**
 * Start the reader each newly cleared document skipped while it was held, exactly as its upload would have. Never throws.
 * S27 files (lab_result_files) have no automatic reader: they wait for a clinician, as they always did.
 */
export async function startReadersForClearedUploads(
  service: SupabaseClient<Database>,
  cleared: readonly ClearedDocument[],
): Promise<number> {
  let started = 0;
  for (const doc of cleared) {
    try {
      if (doc.routedTable === "lab_result_documents" && doc.routedId) {
        const { data: d } = await service
          .from("lab_result_documents")
          .select("id, organisation_id, patient_id, file_path, mime_type, test_code, source")
          .eq("id", doc.routedId)
          .maybeSingle();
        // Same rule as the upload and the CDE retry: the automatic reader runs on a patient's own upload only.
        if (!d || d.source !== "patient") continue;
        await runLabReportExtraction(service, {
          documentId: d.id,
          organisationId: d.organisation_id,
          patientId: d.patient_id,
          filePath: d.file_path,
          mimeType: d.mime_type,
          contextHint: d.test_code ? testCodeLabel(d.test_code) : null,
        });
        started += 1;
      } else if (doc.routedTable === "ecg_report_documents" && doc.routedId) {
        const { data: d } = await service
          .from("ecg_report_documents")
          .select("id, organisation_id, patient_id, file_path, mime_type")
          .eq("id", doc.routedId)
          .maybeSingle();
        if (!d) continue;
        await runEcgReportExtraction(service, {
          documentId: d.id,
          organisationId: d.organisation_id,
          patientId: d.patient_id,
          filePath: d.file_path,
          mimeType: d.mime_type,
        });
        started += 1;
      } else if (doc.routedTable === "imaging_report_documents" && doc.routedId) {
        const { data: d } = await service
          .from("imaging_report_documents")
          .select("id, patient_id, file_path, mime_type")
          .eq("id", doc.routedId)
          .maybeSingle();
        if (!d) continue;
        await runImagingReportExtraction(service, { documentId: d.id, patientId: d.patient_id, filePath: d.file_path, mimeType: d.mime_type });
        started += 1;
      } else if (doc.routedTable === null) {
        // A "not sure what this is" upload: sort it now (a no-op unless it is still waiting to be sorted). One already sorted into
        // ECG or imaging but not yet copied to its reader is picked up by retryStuckClassifications in the same cron run.
        await runDocumentClassification(service, doc.documentId);
        started += 1;
      }
    } catch (err) {
      console.error("upload-scan: could not start the reader for a cleared document", err);
    }
  }
  return started;
}
