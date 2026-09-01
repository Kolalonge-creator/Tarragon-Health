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

// Ladder order for display, mirroring DOCTOR_TIER_LABEL in
// lib/clinical/doctor-tier.ts. care_coordinator is deliberately absent —
// see buildTierLoadSummary below.
const CLINICAL_TIER_ORDER: DoctorTier[] = [
  "tier_1",
  "tier_2",
  "tier_3",
  "tier_4_senior_registrar",
  "tier_5_partner_specialist",
];

export type TierLoadSummaryRow = {
  tier: DoctorTier;
  doctorCount: number;
  averageLoadScore: number;
  averagePanelSize: number;
  averageActiveEscalations: number;
  averageActiveOutreach: number;
};

/**
 * Rolls scored rows up by doctor_tier — the number the founder actually wants
 * to move on Japa/burnout is case-load *per Tier 1 doctor* (first-line review
 * absorbs the bulk of routine volume before anything reaches Tier 2+), not any
 * one clinician's individual score. `care_coordinator` is excluded: it carries
 * no clinical caseload by design (logistics only, see CLAUDE.md's Clinical
 * Tier Ladder). A null tier is excluded too — never infer/default a tier
 * (CLAUDE.md, "What Claude Must Never Do"), so an unassigned doctor is left
 * out of every tier's average rather than silently folded into one.
 */
export function buildTierLoadSummary(rows: StaffLoadRow[]): TierLoadSummaryRow[] {
  const byTier = new Map<DoctorTier, StaffLoadRow[]>();
  for (const row of rows) {
    if (row.doctorTier === null || row.doctorTier === "care_coordinator") continue;
    const list = byTier.get(row.doctorTier) ?? [];
    list.push(row);
    byTier.set(row.doctorTier, list);
  }

  const average = (list: StaffLoadRow[], value: (r: StaffLoadRow) => number) =>
    list.length === 0 ? 0 : list.reduce((sum, r) => sum + value(r), 0) / list.length;

  return CLINICAL_TIER_ORDER.filter((tier) => byTier.has(tier)).map((tier) => {
    const tierRows = byTier.get(tier)!;
    return {
      tier,
      doctorCount: tierRows.length,
      averageLoadScore: average(tierRows, (r) => r.loadScore),
      averagePanelSize: average(tierRows, (r) => r.panelSize),
      averageActiveEscalations: average(tierRows, (r) => r.activeEscalations),
      averageActiveOutreach: average(tierRows, (r) => r.activeOutreach),
    };
  });
}
