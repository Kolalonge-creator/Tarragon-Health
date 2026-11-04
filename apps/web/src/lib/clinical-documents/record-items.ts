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

/** Plain words for the patient (no clinical judgement in any of them). */
export const PATIENT_STATUS: Record<string, string> = {
  uploaded: "Saved",
  classifying: "Working out what it is",
  needs_type_confirmation: "Tell us what it is",
  processing: "Being read",
  processed: "Read, waiting for a doctor",
  awaiting_verification: "Waiting for a doctor to check",
  doctor_review_required: "Waiting for a doctor",
  reviewed: "Reviewed by a doctor",
  processing_failed: "Waiting for a person to read it",
  superseded: "Replaced by a newer upload",
};

export async function loadRecordItems(supabase: SupabaseClient<Database>, patientId: string, limit = 200): Promise<RecordItem[]> {
  const { data } = await supabase
    .from("clinical_record_items")
    .select("*")
    .eq("patient_id", patientId)
    .order("uploaded_at", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as RecordItemRow[];
  const byBucket = new Map<string, string[]>();
  for (const r of rows) {
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

/** Earlier documents of the same kind (same code, else the same group), oldest last: the "previous of the same kind" panel. */
export function previousOfSameKind(items: readonly RecordItemRow[], current: RecordItemRow): RecordItemRow[] {
  return items
    .filter((i) => i.id !== current.id && !i.is_superseded && (i.uploaded_at ?? "") < (current.uploaded_at ?? ""))
    .filter((i) => (current.kind_code && i.kind_code === current.kind_code) || (current.kind_group && i.kind_group === current.kind_group))
    .sort((a, b) => (b.investigation_date ?? b.uploaded_at ?? "").localeCompare(a.investigation_date ?? a.uploaded_at ?? ""));
}

export function groupByPipeline<T extends { pipeline: string | null }>(items: readonly T[]): { pipeline: string; label: string; items: T[] }[] {
  return PIPELINE_ORDER.map((p) => ({ pipeline: p, label: PIPELINE_GROUP[p] ?? p, items: items.filter((i) => (i.pipeline ?? "unsorted") === p) })).filter(
    (g) => g.items.length > 0,
  );
}
