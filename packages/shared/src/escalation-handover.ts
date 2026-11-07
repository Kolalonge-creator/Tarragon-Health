/**
 * G10: handing a case to another doctor, with acknowledgement (founder decisions DW-16..DW-19, 2026-11-07).
 *
 * The database is the real gate (public.request_escalation_handover / respond_escalation_handover / cancel_escalation_handover);
 * these helpers only let the form say what is missing before it asks, and let the CMO's oversight view say which handovers have
 * waited too long. The acknowledge-by time is set by the database when the handover is asked for (60 minutes, 15 for an
 * emergency-level case), so nothing here re-derives it.
 */

export const HANDOVER_TEXT_MIN_LENGTH = 10;
export const HANDOVER_TEXT_MAX_LENGTH = 1000;

export type EscalationHandoverStatus = "pending" | "accepted" | "declined" | "cancelled" | "superseded";

export const ESCALATION_HANDOVER_STATUS_LABEL: Record<EscalationHandoverStatus, string> = {
  pending: "Waiting for an answer",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
  superseded: "No longer applies",
};

export function isEscalationHandoverStatus(value: string): value is EscalationHandoverStatus {
  return value in ESCALATION_HANDOVER_STATUS_LABEL;
}

function textProblem(text: string, what: string): string | null {
  const length = text.trim().length;
  if (length < HANDOVER_TEXT_MIN_LENGTH) return `${what} (at least ${HANDOVER_TEXT_MIN_LENGTH} characters).`;
  if (length > HANDOVER_TEXT_MAX_LENGTH) return `Keep this under ${HANDOVER_TEXT_MAX_LENGTH} characters.`;
  return null;
}

/** DW-19: what is missing from a handover request, or null when it can be sent. */
export function handoverRequestProblem(input: { toProfileId: string; reason: string; outstandingAction: string }): string | null {
  if (!input.toProfileId) return "Choose the doctor to hand this case to.";
  return (
    textProblem(input.reason, "Say why you are handing this case over") ??
    textProblem(input.outstandingAction, "Say what still needs doing on this case")
  );
}

/** DW-18: a decline always says why. */
export function handoverDeclineProblem(reason: string): string | null {
  return textProblem(reason, "Say why you are declining");
}

/** DW-18: a waiting handover past its acknowledge-by time is shown to the CMO. */
export function isHandoverOverdue(handover: { acknowledge_by: string }, now: Date): boolean {
  return new Date(handover.acknowledge_by).getTime() <= now.getTime();
}

type OpenHandoverLike = { acknowledge_by: string; is_critical: boolean; patient_is_test: boolean; to_profile_id: string };

const byUrgency = <T extends OpenHandoverLike>(a: T, b: T) =>
  Number(b.is_critical) - Number(a.is_critical) || new Date(a.acknowledge_by).getTime() - new Date(b.acknowledge_by).getTime();

/**
 * DW-18: the CMO's list of handovers nobody has answered in time: past their acknowledge-by, emergency-level first, then the
 * longest overdue. A test patient's handover is never real work (INV-13), the same rule as the worklist.
 */
export function overdueHandoversForOversight<T extends OpenHandoverLike>(rows: readonly T[], now: Date): T[] {
  return rows.filter((h) => !h.patient_is_test && isHandoverOverdue(h, now)).sort(byUrgency);
}

/** G10: cases another doctor wants to hand to this doctor, emergency-level first, then the soonest answer-by. */
export function handoversOfferedTo<T extends OpenHandoverLike>(rows: readonly T[], profileId: string | null): T[] {
  if (!profileId) return [];
  return rows.filter((h) => !h.patient_is_test && h.to_profile_id === profileId).sort(byUrgency);
}
