import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { runLabReportExtraction } from "@/lib/lab-reports/extraction-actions";
import { testCodeLabel } from "@/lib/labs/test-code-labels";

/**
 * The automatic retry of a lab report the reader could not read (clinical document engine step 1, design §3.1 and §8.3).
 *
 * The first read runs straight after a patient uploads. If it fails, the document is `processing_failed` and is on the ops
 * exception queue at once (public.ops_exception_queue, domain 'documents'), so a person can read it without waiting for this
 * sweep. This sweep only tries the reader again, a limited number of times, for a failure that may have been transient (a
 * timeout, the model being down). After the last attempt it stops; the document stays on the ops queue until a person deals
 * with it. A failed read never becomes "normal": the database derives the status, and a failure can only move it toward a person.
 *
 * A clinician can always re-run the reader by hand from the review panel (extractLabReportAction), whatever this sweep does.
 */

/** Total automatic attempts, counting the first one at upload. Operational, not clinical. */
export const MAX_AUTOMATIC_READ_ATTEMPTS = 3;

/** A document still marked as being read after this long was interrupted (for example the server stopped mid-read). */
export const STUCK_AFTER_MINUTES = 30;

export type RetryCandidate = {
  status: string;
  failed_attempts: number;
  extraction_attempts: number;
  status_changed_at: string;
};

export function isRetryable(doc: RetryCandidate, now: Date): boolean {
  if (doc.status === "processing_failed") return doc.failed_attempts < MAX_AUTOMATIC_READ_ATTEMPTS;
  if (doc.status === "processing") {
    const ageMs = now.getTime() - new Date(doc.status_changed_at).getTime();
    return ageMs >= STUCK_AFTER_MINUTES * 60_000 && doc.extraction_attempts < MAX_AUTOMATIC_READ_ATTEMPTS;
  }
  return false;
}

export type RetrySummary = { considered: number; retried: number; read: number; failedAgain: number; skipped: number };

export async function retryUnreadLabReports(
  service: SupabaseClient<Database>,
  now: Date = new Date(),
  limit = 50,
): Promise<RetrySummary | { error: string }> {
  const { data: docs, error } = await service
    .from("clinical_documents")
    .select("id, routed_id, status, failed_attempts, extraction_attempts, status_changed_at")
    .eq("routed_table", "lab_result_documents")
    .in("status", ["processing_failed", "processing"])
    // In the query, not after it: documents past the limit stay processing_failed until a person acts, and must not crowd
    // newer failures out of the window.
    .lt("failed_attempts", MAX_AUTOMATIC_READ_ATTEMPTS)
    .order("status_changed_at", { ascending: true })
    .limit(200);
  if (error) return { error: error.message };

  const summary: RetrySummary = { considered: docs?.length ?? 0, retried: 0, read: 0, failedAgain: 0, skipped: 0 };
  const due = (docs ?? []).filter((d) => isRetryable(d, now)).slice(0, limit);

  for (const doc of due) {
    const { data: source } = await service
      .from("lab_result_documents")
      .select("id, organisation_id, patient_id, file_path, mime_type, test_code, source")
      .eq("id", doc.routed_id)
      .maybeSingle();
    // The automatic reader runs on a patient's own upload only; anything else is read by a person, as before.
    if (!source || source.source !== "patient") {
      summary.skipped += 1;
      continue;
    }
    summary.retried += 1;
    const outcome = await runLabReportExtraction(service, {
      documentId: source.id,
      organisationId: source.organisation_id,
      patientId: source.patient_id,
      filePath: source.file_path,
      mimeType: source.mime_type,
      contextHint: source.test_code ? testCodeLabel(source.test_code) : null,
    });
    if (outcome.status === "failed") summary.failedAgain += 1;
    else summary.read += 1;
  }
  return summary;
}
