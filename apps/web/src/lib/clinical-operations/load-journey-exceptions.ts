import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { loose } from "@/lib/clinician/loose-client";
import { excludeTestPatients } from "@/lib/queries/real-patients";

/**
 * Patient-level journey exceptions the CMO may open (CMO Clinical Operations, 2026-11-07). Read under the CMO's OWN RLS, so the list
 * holds only patients the CMO is tied to (INV-12); the org-wide counts come from the aggregate summary. Patient number only, never a
 * name or clinical content. Each list is null when its read failed. lab_orders is readable by all org staff, so the order list is
 * organisation-wide and links to the orders page, not to a record the CMO may not be allowed to open.
 */
export type JourneyException = {
  key: string;
  kind: "follow_up_overdue" | "doctor_review" | "investigation_result";
  patientId: string;
  patientNumber: string | null;
  label: string;
  /** When the wait started (due date for a follow-up, upload for a result, order for a lab order). */
  since: string;
  href: string;
};

export type JourneyExceptions = {
  followUpsOverdue: JourneyException[] | null;
  awaitingReview: JourneyException[] | null;
  awaitingResult: JourneyException[] | null;
  /** The patient-number lookup failed: rows show no number, and the page says so. */
  numbersFailed: boolean;
};

const LIMIT = 100;
const AWAITING_RESULT = ["payment_confirmed", "ordered", "sample_collected", "sample_rejected", "processing"] as const;

type FollowUpRow = { id: string; patient_id: string; kind: string; due_at: string };
const isFollowUpRow = (r: unknown): r is FollowUpRow => {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.patient_id === "string" && typeof o.kind === "string" && typeof o.due_at === "string";
};

export async function loadJourneyExceptions(
  supabase: SupabaseClient<Database>,
  now: Date,
  testPatientIds: readonly string[]
): Promise<JourneyExceptions> {
  const nowIso = now.toISOString();
  const [fuRes, docRes, orderRes] = await Promise.all([
    // clinical_follow_ups is not in the generated types yet: loose client, parsed below. Not closed = open or acknowledged.
    // Oldest due first, so the bounded read always holds the most overdue; "past due" is applied in code.
    loose(supabase)
      .from("clinical_follow_ups")
      .select("id, patient_id, kind, due_at")
      .in("state", ["open", "acknowledged"])
      .order("due_at", { ascending: true })
      .limit(LIMIT * 5),
    excludeTestPatients(
      supabase
        .from("lab_result_documents")
        .select("id, patient_id, created_at")
        .is("reviewed_at", null)
        .is("superseded_by_document_id", null)
        .order("created_at", { ascending: true })
        .limit(LIMIT),
      testPatientIds
    ),
    excludeTestPatients(
      supabase
        .from("lab_orders")
        .select("id, patient_id, status, ordered_at, payment_confirmed_at, created_at")
        .in("status", [...AWAITING_RESULT])
        .order("created_at", { ascending: true })
        .limit(LIMIT),
      testPatientIds
    ),
  ]);

  const fuOpen = fuRes.error || !Array.isArray(fuRes.data) ? null : fuRes.data.filter(isFollowUpRow);
  const test = new Set(testPatientIds);
  const overdue = fuOpen
    ? fuOpen.filter((f) => f.due_at < nowIso && !test.has(f.patient_id)).sort((a, b) => a.due_at.localeCompare(b.due_at)).slice(0, LIMIT)
    : null;

  const ids = new Set<string>();
  for (const r of overdue ?? []) ids.add(r.patient_id);
  for (const r of docRes.data ?? []) ids.add(r.patient_id);
  for (const r of orderRes.data ?? []) ids.add(r.patient_id);
  const numbers = new Map<string, string | null>();
  let numbersFailed = false;
  if (ids.size > 0) {
    const { data, error } = await supabase.from("profiles").select("id, patient_number").in("id", [...ids]);
    if (error) numbersFailed = true;
    for (const p of data ?? []) numbers.set(p.id, p.patient_number ?? null);
  }
  const href = (patientId: string) => `/clinician/patients/${patientId}`;

  return {
    numbersFailed,
    followUpsOverdue: overdue
      ? overdue.map((f) => ({
          key: `fu:${f.id}`,
          kind: "follow_up_overdue",
          patientId: f.patient_id,
          patientNumber: numbers.get(f.patient_id) ?? null,
          label: `Follow-up (${f.kind.replace(/_/g, " ")}) past its due date`,
          since: f.due_at,
          href: href(f.patient_id),
        }))
      : null,
    awaitingReview: docRes.error
      ? null
      : (docRes.data ?? []).map((d) => ({
          key: `doc:${d.id}`,
          kind: "doctor_review",
          patientId: d.patient_id,
          patientNumber: numbers.get(d.patient_id) ?? null,
          label: "Uploaded result waiting for a doctor's review",
          since: d.created_at,
          href: href(d.patient_id),
        })),
    awaitingResult: orderRes.error
      ? null
      : (orderRes.data ?? []).map((o) => ({
          key: `order:${o.id}`,
          kind: "investigation_result",
          patientId: o.patient_id,
          patientNumber: numbers.get(o.patient_id) ?? null,
          label: `Lab order waiting for a result (${o.status.replace(/_/g, " ")})`,
          since: o.ordered_at ?? o.payment_confirmed_at ?? o.created_at,
          href: "/clinician/orders",
        })),
  };
}
