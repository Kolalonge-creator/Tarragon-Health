import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { signStoragePaths } from "@/lib/supabase/sign-storage-paths";

/**
 * Every uploaded document on a record, of any kind, read through public.clinical_record_items (clinical document engine step 6).
 * The view is security_invoker: a patient gets exactly the documents RLS shows them and a clinician exactly what the care tie
 * allows. Only rows the caller could read are then given a five-minute signed link, per bucket.
 */

export type RecordItemRow = Database["public"]["Views"]["clinical_record_items"]["Row"];
export type RecordItem = RecordItemRow & { signedUrl: string | null };

export const PIPELINE_GROUP: Record<string, string> = {
  lab: "Lab results",
  ecg: "Heart tests (ECG)",
  imaging: "Scans and X-rays",
  mammography: "Breast imaging",
  pathology: "Pathology and biopsy",
  cervical: "Cervical screening",
  narrative: "Letters and reports",
  unsorted: "Not yet sorted",
};
export const PIPELINE_ORDER = ["lab", "imaging", "mammography", "ecg", "pathology", "cervical", "narrative", "unsorted"] as const;

/**
 * Plain words for the patient (no clinical judgement in any of them). Only doctor_review_required means a doctor has been asked to
 * look: 'processed' and 'awaiting_verification' are what a document becomes when no review was opened (for example on a plan without
 * a doctor's review), so they must not promise one.
 */
export const PATIENT_STATUS: Record<string, string> = {
  uploaded: "Saved",
  classifying: "Working out what it is",
  needs_type_confirmation: "Tell us what it is",
  processing: "Being read",
  processed: "Read",
  awaiting_verification: "Read, some parts were unclear",
  doctor_review_required: "Waiting for a doctor",
  reviewed: "Reviewed by a doctor",
  processing_failed: "Waiting for a person to read it",
  superseded: "Replaced by a newer upload",
};

/**
 * sign: which rows get a signed link. "all" for a page that offers each file (the patient hub), a document id for the viewer (only the
 * one it shows), "none" for a list that only links onward. A link is only ever made for a row the caller could read.
 */
export async function loadRecordItems(
  supabase: SupabaseClient<Database>,
  patientId: string,
  options: { sign?: "all" | "none" | { only: string }; limit?: number } = {},
): Promise<RecordItem[]> {
  const sign = options.sign ?? "all";
  const limit = options.limit ?? 200;
  const { data } = await supabase
    .from("clinical_record_items")
    .select("*")
    .eq("patient_id", patientId)
    .order("uploaded_at", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as RecordItemRow[];
  const byBucket = new Map<string, string[]>();
  for (const r of rows) {
    if (sign === "none" || (typeof sign === "object" && r.id !== sign.only)) continue;
    if (r.file_bucket && r.file_path) byBucket.set(r.file_bucket, [...(byBucket.get(r.file_bucket) ?? []), r.file_path]);
  }
  const signed = new Map<string, string | null>();
  await Promise.all(
    [...byBucket.entries()].map(async ([bucket, paths]) => {
      const m = await signStoragePaths(bucket, paths, 300);
      for (const [p, u] of m) signed.set(`${bucket}/${p}`, u);
    }),
  );
  return rows.map((r) => ({ ...r, signedUrl: r.file_bucket && r.file_path ? signed.get(`${r.file_bucket}/${r.file_path}`) ?? null : null }));
}

/** When the test was done if the report says so, else when it was added: what "earlier" means when comparing studies. */
function studyDate(i: RecordItemRow): string {
  return (i.investigation_date ?? i.uploaded_at ?? "").slice(0, 10);
}

/**
 * Earlier documents of the same kind (same code, else the same group), newest first: the "previous of the same kind" panel. Earlier
 * by test date, not by upload: a 2023 mammogram uploaded after the 2026 one is still the earlier study.
 */
export function previousOfSameKind(items: readonly RecordItemRow[], current: RecordItemRow): RecordItemRow[] {
  const at = studyDate(current);
  return items
    .filter((i) => i.id !== current.id && !i.is_superseded && studyDate(i) < at)
    .filter((i) => (current.kind_code && i.kind_code === current.kind_code) || (current.kind_group && i.kind_group === current.kind_group))
    .sort((a, b) => studyDate(b).localeCompare(studyDate(a)));
}

export function groupByPipeline<T extends { pipeline: string | null }>(items: readonly T[]): { pipeline: string; label: string; items: T[] }[] {
  return PIPELINE_ORDER.map((p) => ({ pipeline: p, label: PIPELINE_GROUP[p] ?? p, items: items.filter((i) => (i.pipeline ?? "unsorted") === p) })).filter(
    (g) => g.items.length > 0,
  );
}
