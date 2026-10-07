/**
 * Shared clinical work queues under the care tie (S39e). A clinician is not tied to every patient in a queue, so the queue is read through
 * `clinical_worklist()`: patient name and number, the kind of item and its date only. The content stays behind the tie and the access log:
 * opening the chart (the link on each row) writes the S39c log. A refusal comes back as an error, never as an empty queue.
 */
interface Rpc {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type WorklistKind =
  | "lab_results"
  | "abnormal_screening"
  | "lifestyle_flags"
  | "lifestyle_reviews"
  | "annual_check_reviews"
  | "therapy_approvals"
  | "vaccination_verification";

export interface WorklistItem {
  kind: WorklistKind;
  item_id: string;
  patient_id: string;
  patient_name: string | null;
  patient_number: string | null;
  item_label: string;
  item_date: string | null;
}

export const WORKLIST_TITLES: Record<WorklistKind, string> = {
  lab_results: "Lab results to action",
  abnormal_screening: "Abnormal screening results without follow-up",
  lifestyle_flags: "Lifestyle red flags",
  lifestyle_reviews: "Lifestyle reviews due",
  annual_check_reviews: "Annual health check reviews",
  therapy_approvals: "Therapy sessions awaiting approval",
  vaccination_verification: "Vaccination records to verify",
};
export const WORKLIST_ORDER = Object.keys(WORKLIST_TITLES) as WorklistKind[];

export type WorklistResult = { ok: true; groups: { kind: WorklistKind; items: WorklistItem[] }[] } | { ok: false; message: string };

export async function loadWorklist(client: unknown): Promise<WorklistResult> {
  const { data, error } = await (client as Rpc).rpc("clinical_worklist");
  if (error) return { ok: false, message: error.message };
  const rows = Array.isArray(data) ? (data as WorklistItem[]) : [];
  return { ok: true, groups: WORKLIST_ORDER.map((kind) => ({ kind, items: rows.filter((r) => r.kind === kind) })) };
}

/** Organisation totals for one queue (counts only), for admin pages that have no care tie. */
export async function loadOrgOpenWorkCount(client: unknown, kind: WorklistKind | "async_consults"): Promise<{ count: number | null; error: { message: string } | null }> {
  const { data, error } = await (client as Rpc).rpc("org_open_work_counts");
  if (error) return { count: null, error };
  const row = Array.isArray(data) ? (data as { kind: string; n: number | string }[]).find((r) => r.kind === kind) : undefined;
  return row ? { count: Number(row.n), error: null } : { count: null, error: { message: "queue not in the totals" } };
}
