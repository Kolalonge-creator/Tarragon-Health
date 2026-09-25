import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables, Enums } from "@tarragon/shared";

export type TimelineEventType = Enums<"timeline_event_type">;

/**
 * Mirrors apps/web/src/lib/queries/patient-timeline.ts's usePatientTimeline
 * -- same select, same RLS-scoped `patient_timeline` read, same growing-limit
 * pagination strategy for the full-history screen. `actor` carries doctor_tier
 * so the UI can gate "Dr. X" attribution through isClinicalTier (from
 * @tarragon/shared) rather than showing it for a Care Coordinator's row too.
 *
 * No credential_type/credential_number here -- per docs/CLINICAL_TRUST_MODEL_SPEC.md's
 * 2026-09-25/2026-09-26 correction, patients never see a doctor's MDCN/NMCN
 * registration number (or an inline specialty/years-of-experience either),
 * only "Dr. First Last".
 */
export type TimelineEvent = Tables<"patient_timeline"> & {
  actor: {
    full_name: string | null;
    doctor_tier: Enums<"doctor_tier"> | null;
  } | null;
};

const TIMELINE_SELECT =
  "*, actor:clinical_staff!patient_timeline_actor_clinical_staff_id_fkey(full_name, doctor_tier)";

export async function loadPatientTimeline(patientId: string, limit = 20): Promise<QueryResult<TimelineEvent[]>> {
  try {
    const { data, error } = await supabase
      .from("patient_timeline")
      .select(TIMELINE_SELECT)
      .eq("patient_id", patientId)
      .order("occurred_at", { ascending: false })
      .range(0, limit - 1);
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: data as unknown as TimelineEvent[] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Same clinical-status-colour system as apps/web/src/components/patient-timeline.tsx's
// EVENT_STYLE -- deliberately separate from the brand palette (docs/BRAND_GUIDE.md §5).
export const TIMELINE_EVENT_STYLE: Record<TimelineEventType, { dot: string; label: string }> = {
  lab_abnormal: { dot: "#DC2626", label: "Abnormal result" },
  medication_missed: { dot: "#DC2626", label: "Missed doses" },
  escalation_raised: { dot: "#DC2626", label: "Escalation" },
  screening_due: { dot: "#D97706", label: "Screening" },
  referral_status_changed: { dot: "#D97706", label: "Referral" },
  lab_completed: { dot: "#16A34A", label: "Lab result" },
  screening_completed: { dot: "#16A34A", label: "Screening" },
  escalation_resolved: { dot: "#16A34A", label: "Escalation" },
  vaccination_recorded: { dot: "#16A34A", label: "Vaccination" },
  discharge_recorded: { dot: "#16A34A", label: "Discharge" },
  medication_started: { dot: "#12324B", label: "Medication" },
  medication_stopped: { dot: "#12324B", label: "Medication" },
  referral_created: { dot: "#12324B", label: "Referral" },
  care_plan_updated: { dot: "#12324B", label: "Care plan" },
  admission_recorded: { dot: "#12324B", label: "Admission" },
  message_posted: { dot: "#12324B", label: "Message" },
  medication_dispensed: { dot: "#12324B", label: "Medication" },
  medication_received: { dot: "#12324B", label: "Medication" },
  encounter_documented: { dot: "#12324B", label: "Clinical note" },
  condition_recorded: { dot: "#12324B", label: "Condition" },
  condition_status_changed: { dot: "#D97706", label: "Condition" },
  referral_outcome_recorded: { dot: "#12324B", label: "Referral" },
  document_uploaded: { dot: "#12324B", label: "Document" },
  imaging_report_uploaded: { dot: "#12324B", label: "Imaging" },
  record_conflict_flagged: { dot: "#D97706", label: "Record conflict" },
  record_conflict_resolved: { dot: "#16A34A", label: "Record conflict" },
  clinical_summary_validated: { dot: "#16A34A", label: "Clinical summary" },
  dependent_account_transitioned: { dot: "#12324B", label: "Account access" },
};

// Belt-and-braces only, same reasoning as the web component's humaniseSummary:
// private.record_timeline_event() strips underscores at write time, this just
// covers a row written before that guarantee existed.
export function humaniseSummary(summary: string): string {
  return summary.replace(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g, (token) => token.replace(/_/g, " "));
}
