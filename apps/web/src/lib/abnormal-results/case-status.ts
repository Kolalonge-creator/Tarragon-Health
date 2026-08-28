/**
 * §7.9 "Result ownership" ("never allow 'someone should review this' —
 * instead: Assigned to Dr X, or Assigned to Tarragon Clinical Review Team")
 * and §7.18 ("Every result must have: Owner -> status -> action ->
 * outcome"). clinician_alerts, escalations, and lab_result_documents each
 * independently track their own closure state — three genuinely separate
 * tables, no single canonical "is this case closed" column anywhere on the
 * platform. Unifying them at the schema level would be a much bigger,
 * riskier change than this codebase's own migration history favours (every
 * change to a shared, security-critical table here is kept additive and
 * narrowly scoped — see e.g. the escalation_level/override_level
 * migrations). This is the presentation-layer alternative: a pure
 * function, no I/O, that reads whichever of the three signals actually
 * applies to one case and renders one answer, rather than a schema change.
 *
 * Precedence when more than one signal is present: an escalation (a case a
 * clinician handed to senior review) is the most authoritative — it is
 * always raised FROM a clinician_alerts row, never the reverse, so its
 * state supersedes the alert's own. A lab_result_document's own
 * acknowledgement state is next. The alert's own status is the fallback
 * every case has, since not every alert has an escalation or a document.
 */

export type AlertStatus = "open" | "acknowledged" | "resolved";
export type EscalationStatus = "open" | "under_review" | "resolved" | "referred";
export type ResultDocumentAcknowledgementStatus =
  | "new"
  | "opened"
  | "reviewed"
  | "action_required"
  | "action_completed";

export interface CaseStatusInput {
  alert: {
    status: AlertStatus;
    acknowledged_by: string | null;
  };
  escalation?: {
    status: EscalationStatus;
    assigned_doctor_id: string | null;
  } | null;
  resultDocument?: {
    acknowledgement_status: ResultDocumentAcknowledgementStatus;
  } | null;
}

export interface CaseStatus {
  /** One canonical label spanning all three closure signals. */
  label: string;
  /** Whether this case is done — a terminal state on whichever signal decided it. */
  isClosed: boolean;
  /** The profile id actually accountable right now, or null if still unclaimed (owned by the org pool). */
  ownerId: string | null;
}

/** Display fallback for an unclaimed case — never "someone should review this". */
export const UNCLAIMED_OWNER_LABEL = "Tarragon Clinical Review Team";

export function deriveCaseStatus(input: CaseStatusInput): CaseStatus {
  const { alert, escalation, resultDocument } = input;

  if (escalation) {
    switch (escalation.status) {
      case "resolved":
        return { label: "Resolved", isClosed: true, ownerId: escalation.assigned_doctor_id };
      case "referred":
        return { label: "Referred", isClosed: true, ownerId: escalation.assigned_doctor_id };
      case "under_review":
        return {
          label: "Escalated — under senior review",
          isClosed: false,
          ownerId: escalation.assigned_doctor_id,
        };
      case "open":
        return {
          label: "Escalated — awaiting review",
          isClosed: false,
          ownerId: escalation.assigned_doctor_id,
        };
      default:
        return { label: "Escalated", isClosed: false, ownerId: escalation.assigned_doctor_id };
    }
  }

  if (resultDocument) {
    switch (resultDocument.acknowledgement_status) {
      case "action_completed":
        return { label: "Resolved", isClosed: true, ownerId: alert.acknowledged_by };
      case "action_required":
        return { label: "Reviewed — action required", isClosed: false, ownerId: alert.acknowledged_by };
      case "reviewed":
        return { label: "Reviewed", isClosed: false, ownerId: alert.acknowledged_by };
      case "opened":
        return { label: "Opened — under review", isClosed: false, ownerId: alert.acknowledged_by };
      case "new":
        return { label: "Open — unacknowledged", isClosed: false, ownerId: null };
      default:
        return { label: "Open", isClosed: false, ownerId: alert.acknowledged_by };
    }
  }

  switch (alert.status) {
    case "resolved":
      return { label: "Resolved", isClosed: true, ownerId: alert.acknowledged_by };
    case "acknowledged":
      return { label: "Acknowledged — under review", isClosed: false, ownerId: alert.acknowledged_by };
    case "open":
      return { label: "Open — unacknowledged", isClosed: false, ownerId: null };
    default:
      return { label: "Open — unacknowledged", isClosed: false, ownerId: null };
  }
}

/** Renders ownerId against a resolved display name, falling back to the org pool label. */
export function ownerDisplayName(ownerId: string | null, resolvedName: string | null): string {
  if (ownerId === null) return UNCLAIMED_OWNER_LABEL;
  return resolvedName ?? UNCLAIMED_OWNER_LABEL;
}
