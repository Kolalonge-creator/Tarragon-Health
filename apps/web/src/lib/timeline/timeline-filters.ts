import type { TimelineEventType } from "@/lib/queries/patient-timeline";

/**
 * Timeline filters on the full-history page (patient dashboard 2.0, spec 5.2, gap P18).
 *
 * Every event type belongs to exactly one filter. The map is a Record over the database enum, so a new event type does not
 * compile until someone decides where it goes: it can never silently drop out of every filter. The filter is applied in the
 * query (`.in("event_type", ...)`), not by hiding rows after a page has loaded, so "Load more" keeps working.
 */
export type TimelineFilterId = "results" | "medicines" | "consultations" | "care" | "prevention" | "readings" | "record";

export const TIMELINE_FILTERS: readonly { id: TimelineFilterId; label: string }[] = [
  { id: "results", label: "Results and documents" },
  { id: "medicines", label: "Medicines" },
  { id: "consultations", label: "Consultations and messages" },
  { id: "care", label: "Care and referrals" },
  { id: "prevention", label: "Screening and vaccines" },
  { id: "readings", label: "Readings and symptoms" },
  { id: "record", label: "Your record" },
];

export const TIMELINE_FILTER_OF: Record<TimelineEventType, TimelineFilterId> = {
  lab_abnormal: "results",
  lab_completed: "results",
  document_uploaded: "results",
  imaging_report_uploaded: "results",
  medication_missed: "medicines",
  medication_started: "medicines",
  medication_stopped: "medicines",
  medication_dispensed: "medicines",
  medication_received: "medicines",
  prescription_signed: "medicines",
  encounter_documented: "consultations",
  message_posted: "consultations",
  referral_created: "care",
  referral_status_changed: "care",
  referral_outcome_recorded: "care",
  escalation_raised: "care",
  escalation_resolved: "care",
  care_plan_updated: "care",
  admission_recorded: "care",
  discharge_recorded: "care",
  procedure_recorded: "care",
  condition_recorded: "care",
  condition_status_changed: "care",
  screening_due: "prevention",
  screening_completed: "prevention",
  vaccination_recorded: "prevention",
  vitals_recorded: "readings",
  symptom_logged: "readings",
  record_conflict_flagged: "record",
  record_conflict_resolved: "record",
  clinical_summary_validated: "record",
  dependent_account_transitioned: "record",
};

/** The event types a filter covers; `null` (no filter) means every type. */
export function eventTypesFor(filter: TimelineFilterId | null): TimelineEventType[] | null {
  if (filter === null) return null;
  return (Object.keys(TIMELINE_FILTER_OF) as TimelineEventType[]).filter((type) => TIMELINE_FILTER_OF[type] === filter);
}
