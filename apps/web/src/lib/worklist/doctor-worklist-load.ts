import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  priorityFromAlertLevel,
  type Database,
  type DoctorWorklistRow,
  type WorklistAlertLevel,
  type WorklistSource,
} from "@tarragon/shared";
import { formatPatientDateTime } from "@/lib/format-date";
import { excludeTestPatients } from "@/lib/queries/real-patients";
import { loadWorklist, worklistItemHref, type WorklistKind } from "@/lib/security/worklists";

/**
 * Loads the doctor's unified, named worklist (DW-01) from the stores that already hold open work. Nothing new is
 * stored. Each source is read on its own so one failure cannot blank the others, and every failed source is
 * reported: the page must never say "nothing waiting" over a read that did not come back.
 *
 * Reads go through the caller's session, so RLS decides what is visible (escalations and alerts: org staff;
 * shared queues: `clinical_worklist()`, name, number, kind and date only).
 */

export type DoctorWorklistLoad = {
  rows: DoctorWorklistRow[];
  failedSources: WorklistSource[];
  /** Shared queues hold more than the 100 oldest items returned per kind; the rest are on /clinician/worklists. */
  queueOverflow: { kind: WorklistKind; shown: number; total: number }[];
};

/** Shorter, action-shaped words for each shared queue, used as the row's "clinical issue" and "next action". */
export const QUEUE_ROW_TEXT: Record<WorklistKind, { issue: string; next: string }> = {
  lab_results: { issue: "Lab result to action", next: "Review the result" },
  abnormal_screening: { issue: "Abnormal screening result without follow-up", next: "Arrange follow-up" },
  lifestyle_flags: { issue: "Lifestyle red flag", next: "Review the flag" },
  lifestyle_reviews: { issue: "Lifestyle review due", next: "Complete the review" },
  annual_check_reviews: { issue: "Annual health check to review", next: "Review and write the plan" },
  therapy_approvals: { issue: "Therapy session awaiting approval", next: "Approve or decline" },
  vaccination_verification: { issue: "Vaccination record to verify", next: "Verify the record" },
  outside_records: { issue: "Record from another hospital to check", next: "Check the record" },
  uploaded_documents: { issue: "Uploaded report waiting for a doctor", next: "Read the report" },
  deteriorating_trends: { issue: "Lab trend getting worse", next: "Review the trend" },
};

type EscalationRow = {
  id: string;
  reason: string;
  status: "open" | "under_review" | "resolved" | "referred";
  created_at: string;
  assigned_doctor_id: string | null;
  clinician_alert_id: string | null;
  patient_id: string;
  patient: { full_name: string | null; patient_number: string | null } | null;
  assigned_doctor: { full_name: string | null } | null;
  clinician_alert: { level: WorklistAlertLevel | null; override_level: WorklistAlertLevel | null; sla_due_at: string | null } | null;
};

type AlertRow = {
  id: string;
  title: string;
  status: "open" | "acknowledged" | "snoozed";
  snoozed_until: string | null;
  level: WorklistAlertLevel | null;
  override_level: WorklistAlertLevel | null;
  sla_due_at: string | null;
  created_at: string;
  patient_id: string;
  responsible_clinician_id: string | null;
  patient: { full_name: string | null; patient_number: string | null } | null;
  responsible_clinician: { full_name: string | null } | null;
};

const shorten = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export function escalationToRow(e: EscalationRow, profileId: string | null): DoctorWorklistRow {
  const level = e.clinician_alert?.override_level ?? e.clinician_alert?.level ?? null;
  return {
    key: `escalation:${e.id}`,
    escalationId: e.id,
    assignedProfileId: e.assigned_doctor_id,
    source: "escalation",
    patientId: e.patient_id,
    patientName: e.patient?.full_name ?? null,
    patientNumber: e.patient?.patient_number ?? null,
    issue: shorten(e.reason),
    priority: priorityFromAlertLevel(level),
    receivedAt: e.created_at,
    dueAt: e.clinician_alert?.sla_due_at ?? null,
    assignedName: e.assigned_doctor?.full_name ?? null,
    assignedToMe: profileId !== null && e.assigned_doctor_id === profileId,
    unassigned: e.assigned_doctor_id === null,
    status: e.status === "under_review" ? "Under review" : "New",
    nextAction: e.status === "under_review" ? "Finish the review and record the outcome" : "Start the review",
    href: `/clinician/escalations/${e.id}`,
  };
}

export function alertToRow(a: AlertRow, staffId: string | null): DoctorWorklistRow {
  return {
    key: `alert:${a.id}`,
    source: "alert",
    patientId: a.patient_id,
    patientName: a.patient?.full_name ?? null,
    patientNumber: a.patient?.patient_number ?? null,
    issue: shorten(a.title),
    priority: priorityFromAlertLevel(a.override_level ?? a.level),
    receivedAt: a.created_at,
    dueAt: a.sla_due_at,
    assignedName: a.responsible_clinician?.full_name ?? null,
    assignedToMe: staffId !== null && a.responsible_clinician_id === staffId,
    unassigned: a.responsible_clinician_id === null,
    status:
      a.status === "snoozed"
        ? a.snoozed_until
          ? `Snoozed until ${formatPatientDateTime(a.snoozed_until)}`
          : "Snoozed"
        : a.status === "acknowledged"
          ? "Acknowledged"
          : "New",
    nextAction:
      a.status === "snoozed" ? "Open the patient's record" : a.status === "acknowledged" ? "Resolve with a documented outcome" : "Acknowledge",
    // Open and acknowledged alerts are acted on in the alert list on the clinician home; a snoozed one is not listed
    // there, so it opens the patient's record.
    href: a.status === "snoozed" ? `/clinician/patients/${a.patient_id}` : "/clinician#clinical-alerts",
  };
}

export async function loadDoctorWorklist(
  supabase: SupabaseClient<Database>,
  ids: { profileId: string | null; staffId: string | null },
  testPatientIds: readonly string[],
): Promise<DoctorWorklistLoad> {
  const [escRes, alertRes, queueRes] = await Promise.all([
    excludeTestPatients(
      supabase
        .from("escalations")
        .select(
          "id, reason, status, created_at, assigned_doctor_id, clinician_alert_id, patient_id, patient:profiles!escalations_patient_id_fkey(full_name, patient_number), assigned_doctor:profiles!escalations_assigned_doctor_id_fkey(full_name), clinician_alert:clinician_alerts!escalations_clinician_alert_id_fkey(level, override_level, sla_due_at)",
        )
        .in("status", ["open", "under_review"]),
      testPatientIds,
    ).returns<EscalationRow[]>(),
    excludeTestPatients(
      supabase
        .from("clinician_alerts")
        .select(
          "id, title, status, snoozed_until, level, override_level, sla_due_at, created_at, patient_id, responsible_clinician_id, patient:profiles!clinician_alerts_patient_id_fkey(full_name, patient_number), responsible_clinician:clinical_staff!clinician_alerts_responsible_clinician_id_fkey(full_name)",
        )
        // Snoozed alerts are listed too (marked, with the time), so a snoozed critical alert never disappears.
        .in("status", ["open", "acknowledged", "snoozed"])
        .eq("suppressed", false),
      testPatientIds,
    ).returns<AlertRow[]>(),
    loadWorklist(supabase),
  ]);

  const failedSources: WorklistSource[] = [];
  const rows: DoctorWorklistRow[] = [];

  // An alert that already has an open escalation is shown once, as the escalation (which carries its level and due time).
  // If escalations failed we cannot tell which alerts are covered, so every alert is shown.
  const escalatedAlertIds = new Set<string>();
  if (escRes.error) failedSources.push("escalation");
  else {
    for (const e of escRes.data ?? []) {
      rows.push(escalationToRow(e, ids.profileId));
      if (e.clinician_alert_id) escalatedAlertIds.add(e.clinician_alert_id);
    }
  }

  if (alertRes.error) failedSources.push("alert");
  else {
    for (const a of alertRes.data ?? []) if (!escalatedAlertIds.has(a.id)) rows.push(alertToRow(a, ids.staffId));
  }

  const queueOverflow: DoctorWorklistLoad["queueOverflow"] = [];
  if (!queueRes.ok) failedSources.push("queue");
  else {
    const testIds = new Set(testPatientIds);
    for (const group of queueRes.groups) {
      if (group.total > group.items.length) queueOverflow.push({ kind: group.kind, shown: group.items.length, total: group.total });
      for (const item of group.items) {
        if (testIds.has(item.patient_id)) continue;
        const text = QUEUE_ROW_TEXT[item.kind];
        rows.push({
          key: `queue:${item.kind}:${item.item_id}`,
          source: "queue",
          patientId: item.patient_id,
          patientName: item.patient_name,
          patientNumber: item.patient_number,
          issue: text.issue,
          priority: "not_graded",
          receivedAt: item.item_date,
          dueAt: null,
          assignedName: null,
          assignedToMe: false,
          unassigned: true,
          status: "Waiting",
          nextAction: text.next,
          href: worklistItemHref(item.kind, item.item_id, item.patient_id),
        });
      }
    }
  }

  return { rows, failedSources, queueOverflow };
}
