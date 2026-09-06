import type { Tables } from "@tarragon/shared";

type DoctorTier = NonNullable<Tables<"clinical_staff">["doctor_tier"]>;

export type StaffLoadInput = {
  profileId: string;
  fullName: string;
  doctorTier: DoctorTier | null;
  isClinicalDirector: boolean;
  /** Standing patients (care_team_assignment.clinician_id). */
  panelSize: number;
  /** Escalations this person has claimed and is actively working (status = under_review). */
  activeEscalations: number;
  /** Outreach tasks this person has claimed (status in in_progress/contacted). */
  activeOutreach: number;
};

export type StaffLoadRow = StaffLoadInput & {
  loadScore: number;
  isHighLoad: boolean;
};

export type CaseloadReport = {
  rows: StaffLoadRow[];
  averageLoadScore: number;
};

// A claimed escalation demands far more attention right now than one more
// name on a standing panel; a claimed outreach task sits in between. These
// weights are a rough heuristic for sort order, not a validated formula —
// the raw component counts are shown alongside the score for exactly that
// reason (see the caseload page).
const ESCALATION_WEIGHT = 5;
const OUTREACH_WEIGHT = 2;

// There is deliberately no fixed doctor:patient ratio to flag against (see
// CLAUDE.md's Non-Negotiable Business Rules — under review, "no set
// number, just be efficient"). Instead, flag relative to the team's own
// average load today, so this adapts as headcount and panel sizes change
// rather than encoding a number nobody has actually decided on yet.
const HIGH_LOAD_MULTIPLE = 1.5;

export function scoreLoad(
  input: Pick<StaffLoadInput, "panelSize" | "activeEscalations" | "activeOutreach">
): number {
  return input.panelSize + input.activeEscalations * ESCALATION_WEIGHT + input.activeOutreach * OUTREACH_WEIGHT;
}

/** Ranks staff by load score, flagging anyone carrying HIGH_LOAD_MULTIPLE-x the team's own average. */
export function buildCaseloadReport(staff: StaffLoadInput[]): CaseloadReport {
  const scored = staff.map((s) => ({ ...s, loadScore: scoreLoad(s) }));
  const averageLoadScore =
    scored.length === 0 ? 0 : scored.reduce((sum, s) => sum + s.loadScore, 0) / scored.length;
  const threshold = averageLoadScore * HIGH_LOAD_MULTIPLE;

  const rows = scored
    .map((s) => ({ ...s, isHighLoad: averageLoadScore > 0 && s.loadScore > threshold }))
    .sort((a, b) => b.loadScore - a.loadScore);

  return { rows, averageLoadScore };
}

/** Groups a list of rows by a (possibly null) key, counting occurrences per non-null key. */
export function countBy<T>(rows: T[], key: (row: T) => string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const k = key(row);
    if (k === null) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

// --- Availability + utilisation (§96.13/96.15) -----------------------------

/** One `provider_availability_rules` row's weekly window (Postgres `time`, e.g. "09:00:00"). */
export type AvailabilityWindow = {
  startTime: string;
  endTime: string;
};

/** One `provider_time_off` row of kind 'leave' — starts_at/ends_at as ISO timestamps. */
export type LeaveWindow = {
  startsAt: string;
  endsAt: string;
};

export type UtilisationInput = {
  clinicianId: string;
  fullName: string;
  /** This clinician's active availability rules — may be several (different days/methods). */
  availabilityWindows: AvailabilityWindow[];
  /** This clinician's current-or-upcoming leave rows (already filtered to kind='leave', ends_at >= now). */
  leaveWindows: LeaveWindow[];
  /** Trailing 30 days, from `appointments`. */
  completedConsultations: number;
  cancelledConsultations: number;
  noShowConsultations: number;
};

export type UtilisationRow = UtilisationInput & {
  availableHoursPerWeek: number;
  /** True only while a leave window is actually in progress right now, not merely upcoming. */
  onLeave: boolean;
  /** The soonest leave window (in progress or next scheduled), if any. */
  currentOrNextLeave: LeaveWindow | null;
  /** Fraction 0-1, not a target/pass-fail metric — see comment below. */
  utilisationPct: number;
};

/** Minutes since midnight from a Postgres `time` string ("09:00" or "09:00:00"). */
function parseTimeOfDay(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Sums each active rule's own (end_time - start_time) span. A rule already
 * represents one weekly recurrence on its day_of_week, so a plain sum across
 * however many rules a clinician holds — even several on the same day —
 * gives total available hours per week with no further de-duplication.
 */
function sumAvailableHours(windows: AvailabilityWindow[]): number {
  return windows.reduce((total, w) => total + (parseTimeOfDay(w.endTime) - parseTimeOfDay(w.startTime)) / 60, 0);
}

/** The soonest leave window by start time — whichever is in progress or comes up next. */
function pickCurrentOrNextLeave(windows: LeaveWindow[]): LeaveWindow | null {
  if (windows.length === 0) return null;
  return [...windows].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null;
}

/**
 * Per-clinician availability + utilisation, trailing 30 days. Visibility
 * only — deliberately no target ratio or automated flagging (see
 * CLAUDE.md's Non-Negotiable Business Rules: no fixed doctor:patient ratio
 * has been settled on yet).
 */
export function buildUtilisationReport(input: UtilisationInput[]): UtilisationRow[] {
  const now = Date.now();
  return input.map((row) => {
    const currentOrNextLeave = pickCurrentOrNextLeave(row.leaveWindows);
    const onLeave =
      currentOrNextLeave !== null &&
      Date.parse(currentOrNextLeave.startsAt) <= now &&
      now < Date.parse(currentOrNextLeave.endsAt);
    const attempted = row.completedConsultations + row.cancelledConsultations + row.noShowConsultations;
    // Available hours and a 30-day consultation count are different units —
    // converting hours into a comparable slot count would also need each
    // rule's own slot_duration_minutes, which can vary rule-to-rule — so
    // this reads as "completed share of attempted consultations" instead of
    // a bookable-capacity ratio.
    const utilisationPct = row.completedConsultations / Math.max(1, attempted);
    return {
      ...row,
      availableHoursPerWeek: sumAvailableHours(row.availabilityWindows),
      onLeave,
      currentOrNextLeave,
      utilisationPct,
    };
  });
}
