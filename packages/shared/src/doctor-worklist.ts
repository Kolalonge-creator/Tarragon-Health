/**
 * The doctor's unified worklist (doctor workspace spec 8.4 and 9, founder decision DW-01 of 2026-11-06): one named list
 * over the open work that already lives in separate stores (escalations, clinician alerts, the S39e shared queues).
 * This module only orders and labels rows; it never invents a priority. A row whose source has no governed
 * severity is "Not graded", not "Routine".
 */

export type WorklistPriority = "critical" | "urgent" | "priority" | "routine" | "not_graded";

export const WORKLIST_PRIORITY_LABEL: Record<WorklistPriority, string> = {
  critical: "Critical",
  urgent: "Urgent",
  priority: "Priority",
  routine: "Routine",
  not_graded: "Not graded",
};

const PRIORITY_RANK: Record<WorklistPriority, number> = { critical: 0, urgent: 1, priority: 2, not_graded: 3, routine: 4 };

/** The governed alert level (clinician_alerts.level / override_level) mapped onto the spec's four priority words. */
export type WorklistAlertLevel = "emergency" | "specialist_review" | "urgent_escalation" | "clinician_review" | "routine";

export function priorityFromAlertLevel(level: WorklistAlertLevel | null | undefined): WorklistPriority {
  switch (level) {
    case "emergency":
      return "critical";
    case "urgent_escalation":
    case "specialist_review":
      return "urgent";
    case "clinician_review":
      return "priority";
    case "routine":
      return "routine";
    default:
      return "not_graded";
  }
}

export type WorklistSource = "escalation" | "alert" | "queue";

export const WORKLIST_SOURCE_LABEL: Record<WorklistSource, string> = {
  escalation: "Escalation",
  alert: "Clinical alert",
  queue: "Review queue",
};

export type DoctorWorklistRow = {
  /** Unique across sources, e.g. "escalation:<id>". */
  key: string;
  source: WorklistSource;
  patientId: string;
  patientName: string | null;
  patientNumber: string | null;
  issue: string;
  priority: WorklistPriority;
  receivedAt: string | null;
  dueAt: string | null;
  assignedName: string | null;
  assignedToMe: boolean;
  unassigned: boolean;
  status: string;
  nextAction: string;
  href: string;
  /** Escalation rows only: the case id and the assigned doctor's profile id, so the CMO's row can offer reassignment (DW-15). */
  escalationId?: string;
  assignedProfileId?: string | null;
};

const time = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

export function isOverdue(row: Pick<DoctorWorklistRow, "dueAt">, now: Date): boolean {
  const due = time(row.dueAt);
  return due !== null && due < now.getTime();
}

/** Default order: priority, then overdue before on-time, then nearest due time, then longest waiting. Stable on ties. */
export function sortWorklist(rows: readonly DoctorWorklistRow[], now: Date): DoctorWorklistRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const p = PRIORITY_RANK[a.row.priority] - PRIORITY_RANK[b.row.priority];
      if (p !== 0) return p;
      const o = Number(isOverdue(b.row, now)) - Number(isOverdue(a.row, now));
      if (o !== 0) return o;
      const da = time(a.row.dueAt);
      const db = time(b.row.dueAt);
      if (da !== null && db !== null && da !== db) return da - db;
      if (da !== null && db === null) return -1;
      if (da === null && db !== null) return 1;
      const ra = time(a.row.receivedAt) ?? Number.POSITIVE_INFINITY;
      const rb = time(b.row.receivedAt) ?? Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

export type DoctorWorklistFilter = {
  priority?: WorklistPriority | "all";
  source?: WorklistSource | "all";
  assigned?: "me" | "unassigned" | "all";
  /** Matched against patient name and Tarragon number, case-insensitive. */
  q?: string;
};

export function filterWorklist(rows: readonly DoctorWorklistRow[], f: DoctorWorklistFilter): DoctorWorklistRow[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (f.priority && f.priority !== "all" && r.priority !== f.priority) return false;
    if (f.source && f.source !== "all" && r.source !== f.source) return false;
    if (f.assigned === "me" && !r.assignedToMe) return false;
    if (f.assigned === "unassigned" && !r.unassigned) return false;
    if (q && !`${r.patientName ?? ""} ${r.patientNumber ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Parse untrusted URL search params into a filter; anything unknown falls back to "all". */
export function parseWorklistFilter(params: Record<string, string | string[] | undefined>): Required<DoctorWorklistFilter> {
  const one = (k: string) => {
    const v = params[k];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] ?? "" : "";
  };
  const priority = one("priority");
  const source = one("source");
  const assigned = one("assigned");
  return {
    priority: Object.hasOwn(WORKLIST_PRIORITY_LABEL, priority) ? (priority as WorklistPriority) : "all",
    source: Object.hasOwn(WORKLIST_SOURCE_LABEL, source) ? (source as WorklistSource) : "all",
    assigned: assigned === "me" || assigned === "unassigned" ? assigned : "all",
    q: one("q").slice(0, 100),
  };
}

/** Counts by priority over the unfiltered list, for the filter chips. */
export function countByPriority(rows: readonly DoctorWorklistRow[]): Record<WorklistPriority, number> {
  const out: Record<WorklistPriority, number> = { critical: 0, urgent: 0, priority: 0, routine: 0, not_graded: 0 };
  for (const r of rows) out[r.priority] += 1;
  return out;
}
