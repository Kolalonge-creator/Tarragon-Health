/**
 * Escalation working states (DW-03, DW-10..DW-13, 2026-11-06).
 *
 * One place that says which escalation statuses are still open work, so a list, a count or an access check can never forget a
 * state. The database applies the same rule ("not resolved and not referred") in private.clinician_has_patient_access,
 * private.auto_assign_escalation, private.allergy_request_recipients and public.ops_today_summary.
 */
import type { Enums } from "./database.types";

type Status = Enums<"escalation_status">;

/** Closed: nothing more happens on the case. */
export const CLOSED_ESCALATION_STATUSES = ["resolved", "referred"] as const satisfies readonly Status[];

/** States a doctor moves a case into after starting review. Each needs a new note; monitoring also needs a review-by date. */
export const WORKING_ESCALATION_STATUSES = [
  "awaiting_information",
  "patient_contact_required",
  "monitoring",
] as const satisfies readonly Status[];

/** Everything still open: what a worklist, a count or a "does this doctor still hold the case" check must include. */
export const ACTIVE_ESCALATION_STATUSES = [
  "open",
  "under_review",
  ...WORKING_ESCALATION_STATUSES,
] as const satisfies readonly Status[];

/** Claimed and being worked (everything active except a case nobody has started). */
export const IN_PROGRESS_ESCALATION_STATUSES = [
  "under_review",
  ...WORKING_ESCALATION_STATUSES,
] as const satisfies readonly Status[];

export type WorkingEscalationStatus = (typeof WORKING_ESCALATION_STATUSES)[number];

export function isActiveEscalationStatus(status: Status): boolean {
  return (ACTIVE_ESCALATION_STATUSES as readonly Status[]).includes(status);
}

export function isWorkingEscalationStatus(status: Status): status is WorkingEscalationStatus {
  return (WORKING_ESCALATION_STATUSES as readonly Status[]).includes(status);
}

/** Staff wording, shared by the worklists, the case page and badges. */
export const ESCALATION_STATUS_LABEL: Record<Status, string> = {
  open: "Unclaimed",
  under_review: "Under review",
  awaiting_information: "Awaiting information",
  patient_contact_required: "Patient contact needed",
  monitoring: "Monitoring",
  resolved: "Resolved",
  referred: "Referred",
};

/** Patient wording: plain, calm, no clinical jargon and no promise of a named doctor (CLAUDE.md brand voice). */
export const ESCALATION_STATUS_PATIENT_COPY: Record<Status, string> = {
  open: "We're looking into this",
  under_review: "Being reviewed by your care team",
  awaiting_information: "Your care team is waiting for some information",
  patient_contact_required: "Your care team will be in touch",
  monitoring: "Your care team is keeping an eye on this",
  resolved: "Reviewed",
  referred: "Referred for further care",
};

/** The database rules, mirrored for the form so a doctor sees the problem before saving (the database still decides). */
export const ESCALATION_NOTE_MIN_LENGTH = 10;
export const ESCALATION_MONITORING_MAX_DAYS = 14;

export type WorkingStateInput = {
  status: WorkingEscalationStatus;
  note: string;
  previousNote: string | null;
  /** Required for monitoring: ISO date-time. */
  monitorUntil: string | null;
  now: Date;
};

/** Returns the first problem with a working-state move, or null when the database should accept it. */
export function workingStateProblem(input: WorkingStateInput): string | null {
  const note = input.note.trim();
  if (note.length < ESCALATION_NOTE_MIN_LENGTH) {
    return `Write a note of at least ${ESCALATION_NOTE_MIN_LENGTH} characters.`;
  }
  if (input.previousNote !== null && note === input.previousNote.trim()) {
    return "Write a new note for this move.";
  }
  if (input.status === "monitoring") {
    if (!input.monitorUntil) return "Choose a review-by date.";
    const until = new Date(input.monitorUntil).getTime();
    if (Number.isNaN(until)) return "Choose a review-by date.";
    const now = input.now.getTime();
    if (until <= now) return "The review-by date must be in the future.";
    if (until > now + ESCALATION_MONITORING_MAX_DAYS * 24 * 60 * 60 * 1000) {
      return `The review-by date can be at most ${ESCALATION_MONITORING_MAX_DAYS} days away.`;
    }
  }
  return null;
}

export function resolutionNoteProblem(note: string): string | null {
  return note.trim().length < ESCALATION_NOTE_MIN_LENGTH
    ? `Write a resolution note of at least ${ESCALATION_NOTE_MIN_LENGTH} characters.`
    : null;
}
