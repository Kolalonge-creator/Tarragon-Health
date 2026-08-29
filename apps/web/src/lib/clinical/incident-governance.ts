import type { Tables } from "@tarragon/shared";

/**
 * Clinical Governance & Patient Safety — the app-layer half of
 * `clinical_incident_reports` (20260826225518_clinical_incident_near_miss_log.sql).
 *
 * The table, its RLS and its attribution trigger shipped in August with no
 * application code at all: nothing could file a report, and nothing could
 * review or close one. This module carries the pure, testable half of that
 * layer — labels, severity ordering, and the lifecycle rules — so the same
 * rules can be asserted in a unit test rather than only discovered by a
 * Postgres error at the point a doctor clicks Close.
 *
 * Everything here MIRRORS the database; none of it enforces anything. The
 * real boundary stays `private.enforce_clinical_incident_report_attribution`
 * plus the table's own CHECK constraints — same discipline as
 * lib/clinical/doctor-tier.ts, which mirrors the tier-authority functions
 * without claiming to be them.
 */

export type ClinicalIncident = Tables<"clinical_incident_reports">;

/**
 * category / severity / status are CHECK constraints rather than Postgres
 * enums, so `supabase gen types` renders all three as bare `string` — which
 * would make every Record below a lookup that cannot be checked and
 * `nextStatusesFor`'s switch non-exhaustive. The literal unions therefore
 * live here, and lib/validation/clinical-incidents.ts builds its Zod enums
 * from these same tuples so the form and the UI can never drift apart.
 *
 * They still have to be kept in step with the table's CHECK constraints by
 * hand. `AssertAssignableToColumn` below is the cheap half of that: it stops
 * compiling if a column's generated type ever narrows to something these
 * unions no longer fit inside (e.g. if the CHECKs are converted to real
 * enums and a value here was misspelled).
 */
export const INCIDENT_CATEGORIES = [
  "medication_error",
  "misdiagnosis_risk",
  "escalation_delay",
  "communication_breakdown",
  "ai_recommendation_error",
  "protocol_deviation",
  "documentation_error",
  "other",
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export const INCIDENT_SEVERITIES = ["near_miss", "low", "medium", "high", "critical"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATUSES = ["open", "under_review", "action_planned", "closed"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

type AssertAssignableToColumn = [
  IncidentCategory extends ClinicalIncident["category"] ? true : never,
  IncidentSeverity extends ClinicalIncident["severity"] ? true : never,
  IncidentStatus extends ClinicalIncident["status"] ? true : never,
];
// Referenced so the assertion is not stripped as an unused type.
export type IncidentTypesMatchColumns = AssertAssignableToColumn;

/** The subset of a report the log's own helpers need — narrowly typed, since
 * the generated row type widens these three columns to `string`. */
export interface IncidentSortable {
  status: IncidentStatus;
  severity: IncidentSeverity;
  reported_at: string;
}

/**
 * Spec §31.7's reportable incident types, mapped onto the categories the
 * table's CHECK constraint actually allows. Several spec types collapse onto
 * one category deliberately — "delayed result", "missed alert" and
 * "emergency escalation failure" are all `escalation_delay`, because what a
 * governance reviewer does about them is identical. "privacy breach" is
 * absent on purpose: that is `data_breach_incidents`' job (the NDPA
 * 72-hour notification log), and duplicating it here would split the
 * regulatory clock across two tables.
 */
export const INCIDENT_CATEGORY_LABEL: Record<IncidentCategory, string> = {
  medication_error: "Medication error",
  misdiagnosis_risk: "Wrong or missed diagnosis",
  escalation_delay: "Delayed result, missed alert or escalation failure",
  communication_breakdown: "Clinical communication failure",
  ai_recommendation_error: "Inappropriate AI output",
  protocol_deviation: "Protocol deviation",
  documentation_error: "Wrong patient or wrong record",
  other: "Something else",
};

export const INCIDENT_CATEGORY_ORDER: IncidentCategory[] = [
  "medication_error",
  "escalation_delay",
  "misdiagnosis_risk",
  "communication_breakdown",
  "documentation_error",
  "ai_recommendation_error",
  "protocol_deviation",
  "other",
];

/**
 * §31.10 — a near miss is its own severity, not a quieter incident. The
 * migration's own comment is the reason: collapsing it into `low` erases
 * exactly the signal a safety-management system exists to collect.
 */
export const INCIDENT_SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  near_miss: "Near miss — no harm reached the patient",
  low: "Low — harm reached the patient, no lasting effect",
  medium: "Medium — treatment or monitoring changed as a result",
  high: "High — lasting or significant harm",
  critical: "Critical — severe harm or death",
};

/** Short form for badges and table cells, where the full sentence will not fit. */
export const INCIDENT_SEVERITY_SHORT: Record<IncidentSeverity, string> = {
  near_miss: "Near miss",
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

/** Most serious first — the order the log and the dashboard both sort by. */
export const INCIDENT_SEVERITY_ORDER: IncidentSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "near_miss",
];

export const INCIDENT_SEVERITY_VARIANT: Record<
  IncidentSeverity,
  "red" | "amber" | "blue" | "grey"
> = {
  critical: "red",
  high: "red",
  medium: "amber",
  low: "blue",
  // Deliberately not amber: a near miss is a *good* thing to have caught and
  // recorded, and colouring it like a live problem discourages reporting.
  near_miss: "grey",
};

/**
 * §31.9 — "serious incident" is what triggers immediate notification and
 * senior clinical review. One definition, used by both the log's filters and
 * the safety dashboard's count, so the two can never disagree about what
 * "serious" means.
 */
const SERIOUS_SEVERITIES: IncidentSeverity[] = ["high", "critical"];

export function isSeriousIncident(severity: IncidentSeverity): boolean {
  return SERIOUS_SEVERITIES.includes(severity);
}

export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  open: "Open — needs review",
  under_review: "Under review",
  action_planned: "Corrective action planned",
  closed: "Closed",
};

export const INCIDENT_STATUS_VARIANT: Record<IncidentStatus, "red" | "amber" | "blue" | "green"> = {
  open: "red",
  under_review: "amber",
  action_planned: "blue",
  closed: "green",
};

/** A report still on somebody's desk — the §31.12 "open incidents" count. */
export const UNRESOLVED_INCIDENT_STATUSES: IncidentStatus[] = [
  "open",
  "under_review",
  "action_planned",
];

export function isUnresolved(status: IncidentStatus): boolean {
  return status !== "closed";
}

/**
 * §31.8's lifecycle, as the database will actually accept it.
 *
 * Two rules are load-bearing and both come from the migration rather than
 * from the spec diagram:
 *
 * 1. `closed` is terminal. The trigger raises 42501 on any update to a closed
 *    report — it is the permanent record that a near miss was looked at, not
 *    a draft.
 * 2. `open` is unreachable once a report has moved on. Nothing forbids it
 *    explicitly, but the trigger stamps reviewed_by_staff/reviewed_at on
 *    every status change, and the `clinical_incident_reports_open_is_clean`
 *    CHECK requires those to be null when status is 'open' — so an attempted
 *    move back to 'open' fails as a constraint violation. Offering it in the
 *    UI would be offering a button that always errors.
 */
export function nextStatusesFor(current: IncidentStatus): IncidentStatus[] {
  switch (current) {
    case "open":
      return ["under_review", "action_planned", "closed"];
    case "under_review":
      return ["action_planned", "closed"];
    case "action_planned":
      return ["closed"];
    case "closed":
      return [];
  }
}

export function isTerminal(status: IncidentStatus): boolean {
  return nextStatusesFor(status).length === 0;
}

/**
 * Mirrors `clinical_incident_reports_closed_requires_outcome` plus the
 * trigger's own re-check: a closed report always says what was found and what
 * changed. Returns a message to show the reviewer, or null when the close is
 * well-formed.
 *
 * "No action needed" is an acceptable corrective action — the constraint asks
 * for a stated decision, not for a change — so this only rejects blank text,
 * exactly as the database does.
 */
export function validateIncidentClosure(input: {
  reviewOutcome: string;
  correctiveAction: string;
}): string | null {
  if (input.reviewOutcome.trim().length === 0) {
    return "Say what the review found before closing this report.";
  }
  if (input.correctiveAction.trim().length === 0) {
    return "Record the corrective action — or state explicitly that no action was needed.";
  }
  return null;
}

/**
 * Sort key for the incident log: unresolved before closed, then most serious,
 * then most recently reported. A closed critical incident should not sit
 * above an open one just because it was worse.
 */
export function incidentSortKey(incident: IncidentSortable): [number, number, number] {
  return [
    isUnresolved(incident.status) ? 0 : 1,
    INCIDENT_SEVERITY_ORDER.indexOf(incident.severity),
    -new Date(incident.reported_at).getTime(),
  ];
}

export function sortIncidents<T extends IncidentSortable>(incidents: T[]): T[] {
  return [...incidents].sort((a, b) => {
    const ka = incidentSortKey(a);
    const kb = incidentSortKey(b);
    for (let i = 0; i < ka.length; i += 1) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    return 0;
  });
}
