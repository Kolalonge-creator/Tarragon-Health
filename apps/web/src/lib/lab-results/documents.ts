import "server-only";
import { signStoragePaths } from "@/lib/supabase/sign-storage-paths";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export const RESULT_DOC_BUCKET = "lab-result-documents";

export interface ResultDocumentView {
  id: string;
  source: Database["public"]["Enums"]["lab_result_document_source"];
  originalFilename: string | null;
  mimeType: string | null;
  note: string | null;
  /** The test type the patient (or the per-test checklist) named at upload —
   * e.g. "hba1c", "kft" — or null when it wasn't known/asked. See
   * apps/web/src/lib/labs/test-code-labels.ts for turning this into a
   * patient-readable label. */
  testCode: string | null;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  /** Doctor-authored, patient-facing explanation — null until a clinician
   * sends one via markResultDocumentReviewed. */
  patientInterpretation: string | null;
  /** Optional doctor-authored next steps, populated only when the result
   * needs the patient to do something. */
  nextSteps: string | null;
  /** Set once, alongside patientInterpretation — gates patient visibility. */
  interpretationSentAt: string | null;
  /** Care Team / Provider Workspace §5.7 — New/Opened/Reviewed/Action
   * required/Action completed. See 20260827204355_result_acknowledgement_status.sql
   * for how each state is reached; enforce_lab_result_document_update is the
   * only place that may actually move it. */
  acknowledgementStatus: Database["public"]["Enums"]["result_document_acknowledgement_status"];
  actionCompletedAt: string | null;
  /** Deterministic, patient-visible summary status — never a doctor opinion,
   * never freeform text. Distinct from patientInterpretation/acknowledgementStatus
   * above, which are both doctor-authored. See extraction-actions.ts. */
  aiSummaryStatus: Database["public"]["Enums"]["ai_document_summary_status"];
  aiSummaryGeneratedAt: string | null;
  /** Which test(s) `aiSummaryStatus = 'flagged'` refers to — label and the
   * lab's own printed range, both copied verbatim off the document. Empty
   * unless aiSummaryStatus is 'flagged'. See
   * lib/lab-reports/ai-summary.ts#FlaggedAnalyte. */
  aiFlaggedAnalytes: { label: string; reportedRange: string | null }[];
  /** Short-lived signed URL for the file, or null if it could not be signed. */
  signedUrl: string | null;
  isPdf: boolean;
  /** Module 57.14 — set when THIS document is a correction of an earlier one. */
  supersedesDocumentId: string | null;
  /** Module 57.14 — set (server-derived) when a LATER document corrected this one. The original stays fully visible; this is a pointer, not a delete. */
  supersededByDocumentId: string | null;
  supersededAt: string | null;
}

const RESULT_DOC_COLUMNS =
  "id, source, original_filename, mime_type, note, test_code, created_at, file_path, reviewed_by, reviewed_at, review_note, patient_interpretation, next_steps, interpretation_sent_at, acknowledgement_status, action_completed_at, supersedes_document_id, superseded_by_document_id, superseded_at, ai_summary_status, ai_summary_generated_at, ai_flagged_analytes" as const;

type ResultDocRow = {
  id: string;
  source: ResultDocumentView["source"];
  original_filename: string | null;
  mime_type: string | null;
  note: string | null;
  test_code: string | null;
  created_at: string;
  file_path: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  patient_interpretation: string | null;
  next_steps: string | null;
  interpretation_sent_at: string | null;
  acknowledgement_status: ResultDocumentView["acknowledgementStatus"];
  action_completed_at: string | null;
  supersedes_document_id: string | null;
  superseded_by_document_id: string | null;
  superseded_at: string | null;
  ai_summary_status: ResultDocumentView["aiSummaryStatus"];
  ai_summary_generated_at: string | null;
  ai_flagged_analytes: unknown;
};

function toView(row: ResultDocRow, signedUrl: string | null): ResultDocumentView {
  return {
    id: row.id,
    source: row.source,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    note: row.note,
    testCode: row.test_code,
    createdAt: row.created_at,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    patientInterpretation: row.patient_interpretation,
    nextSteps: row.next_steps,
    interpretationSentAt: row.interpretation_sent_at,
    acknowledgementStatus: row.acknowledgement_status,
    actionCompletedAt: row.action_completed_at,
    aiSummaryStatus: row.ai_summary_status,
    aiSummaryGeneratedAt: row.ai_summary_generated_at,
    aiFlaggedAnalytes:
      (row.ai_flagged_analytes as { label: string; reportedRange: string | null }[] | null) ?? [],
    signedUrl,
    isPdf: row.mime_type === "application/pdf",
    supersedesDocumentId: row.supersedes_document_id,
    supersededByDocumentId: row.superseded_by_document_id,
    supersededAt: row.superseded_at,
  };
}

/**
 * Load a patient's result documents (RLS-scoped to the passed caller client —
 * a patient sees their own, org staff see org patients') and attach a signed
 * URL to each. Newest first.
 */
export async function loadResultDocuments(
  supabase: SupabaseClient<Database>,
  patientId: string,
): Promise<ResultDocumentView[]> {
  const { data: rows } = await supabase
    .from("lab_result_documents")
    .select(RESULT_DOC_COLUMNS)
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (!rows || rows.length === 0) return [];

  // One batched Storage call for every document's signed URL instead of one
  // request per row (see signStoragePaths).
  const signedUrlByPath = await signStoragePaths(
    RESULT_DOC_BUCKET,
    rows.map((row) => row.file_path),
    300,
  );

  return rows.map((row) => toView(row, signedUrlByPath.get(row.file_path) ?? null));
}

/**
 * One result document for the result page (patient dashboard 2.0, spec 9.4, P10), with a signed link to the original file.
 * `{ ok: false }` when the read failed, so the page can say so rather than "not found"; `doc: null` when no such document is
 * visible to this caller (RLS) for this patient.
 */
export async function loadResultDocument(
  supabase: SupabaseClient<Database>,
  patientId: string,
  documentId: string,
): Promise<{ ok: true; doc: ResultDocumentView | null } | { ok: false }> {
  const { data: row, error } = await supabase
    .from("lab_result_documents")
    .select(RESULT_DOC_COLUMNS)
    .eq("patient_id", patientId)
    .eq("id", documentId)
    .maybeSingle();
  if (error) return { ok: false };
  if (!row) return { ok: true, doc: null };
  const signed = await signStoragePaths(RESULT_DOC_BUCKET, [row.file_path], 300);
  return { ok: true, doc: toView(row, signed.get(row.file_path) ?? null) };
}

/** A previous result of the same test type, for the "earlier results" list. No file link: each opens its own page. */
export interface EarlierResultDocument {
  id: string;
  createdAt: string;
  interpreted: boolean;
}

/** Pages of one result sent together arrive minutes apart; anything inside this window is the same result, not an earlier one. */
export const SAME_RESULT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Up to `limit` earlier results of the same test type, newest first: uploaded more than an hour before `before` (so the other
 * pages of a multi-page send are not listed as earlier tests) and not superseded by a correction (the corrected copy stands
 * for it). `null` when the read failed, so the page can say it could not check rather than "no earlier results".
 */
export async function loadEarlierResultDocuments(
  supabase: SupabaseClient<Database>,
  patientId: string,
  testCode: string,
  before: string,
  limit = 10,
): Promise<EarlierResultDocument[] | null> {
  const beforeMs = new Date(before).getTime();
  const cutoff = Number.isNaN(beforeMs) ? before : new Date(beforeMs - SAME_RESULT_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from("lab_result_documents")
    .select("id, created_at, interpretation_sent_at, patient_interpretation")
    .eq("patient_id", patientId)
    .eq("test_code", testCode)
    .is("superseded_by_document_id", null)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return null;
  return (data ?? []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    interpreted: Boolean(row.interpretation_sent_at && row.patient_interpretation),
  }));
}
