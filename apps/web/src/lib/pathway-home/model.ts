// S61/S62 (13.15, spec screen "Pathway home"): the pure model behind the patient's pathway page.
// Everything the page says comes from facts the patient can already read (their enrolment, milestones and baseline). Nothing is
// scored, nothing is a streak, and a late milestone is shown as "due", never as a failure: a milestone must not nudge a person away
// from reporting a dangerous reading (spec 13.15, the milestone table comment).
import type { MessageKey } from "@tarragon/i18n";

export interface MilestoneRow {
  code: string;
  due_at: string;
  met_at: string | null;
}

export interface DescribedMilestone {
  key: MessageKey;
  /** Only set for a scheduled test, where the check type is part of the sentence. */
  params?: { check: MessageKey };
}

const FIXED: Record<string, MessageKey> = {
  baseline: "pathway.milestone.baseline",
  first_review: "pathway.milestone.first_review",
  three_month_review: "pathway.milestone.three_month_review",
  six_month_review: "pathway.milestone.six_month_review",
};

const CHECK_LABEL: Record<string, MessageKey> = {
  eye: "pathway.check.eye",
  foot: "pathway.check.foot",
  kidney: "pathway.check.kidney",
};

/** Milestone codes are written by the database (baseline, first_review, ..., clinician_review_*, test_<type>_<YYYYMMDD>). */
export function describeMilestone(code: string): DescribedMilestone {
  const fixed = FIXED[code];
  if (fixed) return { key: fixed };
  if (code.startsWith("clinician_review_")) return { key: "pathway.milestone.clinician_review" };
  const test = /^test_([a-z]+)_\d{8}$/.exec(code);
  if (test) {
    const check = CHECK_LABEL[test[1]];
    if (check) return { key: "pathway.milestone.test", params: { check } };
  }
  return { key: "pathway.milestone.other" };
}

export interface MilestoneSummary {
  /** The soonest milestone not yet met, or null when there is none. */
  next: MilestoneRow | null;
  /** The rest of the milestones not yet met, soonest first. */
  later: MilestoneRow[];
  /** Milestones already met, most recent first. */
  met: MilestoneRow[];
  /** True when the next milestone's date has passed. The page says "due", not "late". */
  nextIsDue: boolean;
}

export function summariseMilestones(rows: readonly MilestoneRow[], now: Date): MilestoneSummary {
  const open = rows.filter((r) => r.met_at === null).sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  const met = rows.filter((r) => r.met_at !== null).sort((a, b) => Date.parse(b.met_at ?? "") - Date.parse(a.met_at ?? ""));
  const next = open[0] ?? null;
  return { next, later: open.slice(1), met, nextIsDue: next !== null && Date.parse(next.due_at) <= now.getTime() };
}

export interface GoalRow {
  description: string;
  target_value: number;
  target_unit: string;
}

/** The programme's default goals are stored as json. Anything that is not the expected shape is dropped, never guessed at. */
export function parseGoals(value: unknown): GoalRow[] {
  if (!Array.isArray(value)) return [];
  const out: GoalRow[] = [];
  for (const g of value) {
    if (typeof g !== "object" || g === null) continue;
    const r = g as Record<string, unknown>;
    if (typeof r.description === "string" && typeof r.target_value === "number" && typeof r.target_unit === "string") {
      out.push({ description: r.description, target_value: r.target_value, target_unit: r.target_unit });
    }
  }
  return out;
}

export interface BaselineLine {
  key: MessageKey;
  params: Record<string, string | number>;
}

/** Where the person started, from the snapshot taken at enrolment. A missing reading is left out, not shown as zero. */
export function baselineLines(snapshot: unknown): BaselineLine[] {
  if (typeof snapshot !== "object" || snapshot === null) return [];
  const s = snapshot as Record<string, unknown>;
  const lines: BaselineLine[] = [];
  const bp = s.blood_pressure as Record<string, unknown> | null | undefined;
  if (bp && typeof bp.systolic === "number" && typeof bp.diastolic === "number") {
    lines.push({ key: "pathway.baseline.bp", params: { systolic: bp.systolic, diastolic: bp.diastolic } });
  }
  const glucose = s.glucose as Record<string, unknown> | null | undefined;
  if (glucose && typeof glucose.mmol_l === "number") {
    lines.push({ key: "pathway.baseline.glucose", params: { value: glucose.mmol_l } });
  }
  return lines;
}

export type CareTeamNote = "paused" | "review_planned" | "review_due" | "readings_checked";

/**
 * What the care team is doing, stated only from facts on the page. "readings_checked" is always true and is always first: every
 * reading is graded as it arrives, including while check-ins are paused (a pause never stops grading or paging).
 */
export function careTeamNotes(args: { paused: boolean; nextReview: MilestoneRow | null; now: Date }): CareTeamNote[] {
  const notes: CareTeamNote[] = ["readings_checked"];
  if (args.paused) notes.push("paused");
  if (args.nextReview) notes.push(Date.parse(args.nextReview.due_at) <= args.now.getTime() ? "review_due" : "review_planned");
  return notes;
}

export function isClinicianReview(code: string): boolean {
  return code === "first_review" || code === "three_month_review" || code === "six_month_review" || code.startsWith("clinician_review_");
}
