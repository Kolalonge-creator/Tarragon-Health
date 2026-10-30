/**
 * Display model for the clinician home (docs/design/DASHBOARD-PROGRAMME-CLINICIAN-FIRST.md §3).
 *
 * Pure functions, no I/O, so the ranking and the "unknown is not zero" rule are
 * tested once and reused by web now and mobile later. The page fetches; this
 * decides what to show.
 */

export type HomeEscalationLevel =
  | "emergency"
  | "specialist_review"
  | "urgent_escalation"
  | "clinician_review"
  | "routine";

export type HomeEscalation = {
  id: string;
  reason: string;
  status: "open" | "under_review" | "resolved" | "referred";
  patientName: string | null;
  level: HomeEscalationLevel | null;
  dueAt: string | null;
  /** profiles.id of the doctor the case is routed to; null while unassigned. */
  assignedDoctorId: string | null;
};

/**
 * The cases this doctor can act on: routed to them, or not routed to anyone yet
 * (any qualifying doctor may take an unassigned one). A case routed to a colleague
 * is theirs to start, so it is never the hero here even though the org-wide list shows it.
 */
export function escalationsForDoctor(
  rows: readonly HomeEscalation[],
  doctorId: string | null,
): HomeEscalation[] {
  return rows.filter(
    (r) => r.assignedDoctorId === null || (doctorId !== null && r.assignedDoctorId === doctorId),
  );
}

const LEVEL_RANK: Record<HomeEscalationLevel, number> = {
  emergency: 0,
  specialist_review: 1,
  urgent_escalation: 2,
  clinician_review: 3,
  routine: 4,
};

/** A row with no alert attached is ranked as routine, never dropped: it is still open work. */
function levelRank(level: HomeEscalationLevel | null): number {
  return LEVEL_RANK[level ?? "routine"];
}

function dueMs(dueAt: string | null): number {
  if (!dueAt) return Number.POSITIVE_INFINITY;
  const t = new Date(dueAt).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** Severity first, then the nearest due time; ties keep their input order (oldest first). */
export function rankEscalations(rows: readonly HomeEscalation[]): HomeEscalation[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const byLevel = levelRank(a.row.level) - levelRank(b.row.level);
      if (byLevel !== 0) return byLevel;
      const da = dueMs(a.row.dueAt);
      const db = dueMs(b.row.dueAt);
      if (da !== db) return da < db ? -1 : 1;
      return a.index - b.index;
    })
    .map((x) => x.row);
}

export type Countdown = {
  /** "overdue" and "due_soon" (under an hour) are the states a screen should draw attention to. */
  state: "overdue" | "due_soon" | "on_track" | "no_due_time";
  label: string;
};

function span(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function countdownFor(dueAt: string | null, now: Date): Countdown {
  const due = dueMs(dueAt);
  if (!Number.isFinite(due)) return { state: "no_due_time", label: "No due time set" };
  const diffMin = Math.round((due - now.getTime()) / 60000);
  if (diffMin < 0) return { state: "overdue", label: `Overdue by ${span(-diffMin)}` };
  if (diffMin < 60) return { state: "due_soon", label: `Due in ${span(diffMin)}` };
  return { state: "on_track", label: `Due in ${span(diffMin)}` };
}

export type NextAction = {
  escalation: HomeEscalation;
  countdown: Countdown;
  /** How many other open cases sit behind this one. */
  behind: number;
};

/** The one card at the top of the page. Null means nothing is open, which is only
 * meaningful when the load did not fail: callers decide that, see {@link nextActionView}. */
export function pickNextAction(rows: readonly HomeEscalation[], now: Date): NextAction | null {
  const ranked = rankEscalations(rows);
  const first = ranked[0];
  if (!first) return null;
  return { escalation: first, countdown: countdownFor(first.dueAt, now), behind: ranked.length - 1 };
}

export type NextActionView =
  | { kind: "unknown" }
  | { kind: "clear" }
  | { kind: "action"; action: NextAction };

/** A failed read is "unknown", never "clear": an all-clear drawn from data nobody received is the dangerous case. */
export function nextActionView(
  rows: readonly HomeEscalation[],
  loadFailed: boolean,
  now: Date,
): NextActionView {
  if (loadFailed) return { kind: "unknown" };
  const action = pickNextAction(rows, now);
  return action ? { kind: "action", action } : { kind: "clear" };
}

export type Figure = { state: "known"; value: number } | { state: "unknown" };

/** A count whose query errored is unknown, whatever number came back with it. */
export function figure(value: number | null | undefined, failed: boolean): Figure {
  if (failed || value === null || value === undefined) return { state: "unknown" };
  return { state: "known", value };
}

/** Sum several counts: unknown if any part is unknown (a partial sum would understate the work). */
export function sumFigures(parts: readonly Figure[]): Figure {
  let total = 0;
  for (const p of parts) {
    if (p.state === "unknown") return p;
    total += p.value;
  }
  return { state: "known", value: total };
}

/** Lagos is a fixed UTC+1 with no daylight saving. Returns the UTC instants bounding the Lagos calendar day containing `now`. */
export function lagosDayBounds(now: Date): { startIso: string; endIso: string } {
  const OFFSET_MS = 60 * 60 * 1000;
  const lagos = new Date(now.getTime() + OFFSET_MS);
  const startUtc =
    Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate()) - OFFSET_MS;
  return {
    startIso: new Date(startUtc).toISOString(),
    endIso: new Date(startUtc + 24 * 60 * 60 * 1000).toISOString(),
  };
}
