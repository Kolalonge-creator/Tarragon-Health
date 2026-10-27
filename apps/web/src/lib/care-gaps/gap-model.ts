import { careGapText, type CareGapCopyKey } from "@tarragon/i18n";
import type { Tables } from "@tarragon/shared";

/**
 * S90: the care gap record as staff see it. Pure functions only (no Supabase, no React), so the ranking, the "why this gap is open" text and the closure
 * labels are tested without a screen.
 */
export type CareGapRow = Tables<"care_gaps">;

export const CARE_GAP_TYPES = [
  "missed_reading",
  "no_hba1c_12_months",
  "no_lipids_12_months",
  "rising_bp_trend",
  "medication_refill_lapse",
  "adherence_lapse",
] as const;
export type CareGapType = (typeof CARE_GAP_TYPES)[number];

/** closed: a recorded outcome. declined / unreachable / wrong: a person closed it. superseded: the system closed it because the premise went or the rule changed. */
export const CLOSURE_REASONS = ["closed", "declined", "unreachable", "wrong", "superseded"] as const;
export type ClosureReason = (typeof CLOSURE_REASONS)[number];

/** The reasons a person may choose by hand. `closed` is never one of them: it needs a recorded outcome signal. */
export const MANUAL_CLOSURE_REASONS = ["declined", "unreachable", "wrong"] as const;
export type ManualClosureReason = (typeof MANUAL_CLOSURE_REASONS)[number];

export const ATTEMPT_RESULTS = ["call_reached", "call_no_answer", "message_left"] as const;
export type AttemptResult = (typeof ATTEMPT_RESULTS)[number];

export function isCareGapType(value: string): value is CareGapType {
  return (CARE_GAP_TYPES as readonly string[]).includes(value);
}

export function gapTypeLabel(type: string): string {
  return isCareGapType(type) ? careGapText(`staff.type.${type}` as CareGapCopyKey) : type;
}

export function closureReasonLabel(reason: string | null): string {
  if (reason === "closed" || reason === "declined" || reason === "unreachable" || reason === "wrong" || reason === "superseded") {
    return careGapText(`staff.reason.${reason}` as CareGapCopyKey);
  }
  return "";
}

/**
 * Ranking: the highest risk first, then the longest overdue, then a rising trend ahead of none. Ties fall back to the earlier due date and then the id,
 * so the order is stable between two loads. Open gaps only; a closed gap is not ranked.
 */
export function rankCareGaps<T extends Pick<CareGapRow, "risk_rank" | "days_overdue" | "trend_flag" | "due_date" | "id">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (b.risk_rank !== a.risk_rank) return b.risk_rank - a.risk_rank;
    if (b.days_overdue !== a.days_overdue) return b.days_overdue - a.days_overdue;
    if (a.trend_flag !== b.trend_flag) return a.trend_flag ? -1 : 1;
    if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** A calendar date (YYYY-MM-DD) shifted by whole days; UTC arithmetic on a date-only value, so no timezone or daylight saving can move it. */
export function shiftDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** A date in the platform timezone (Africa/Lagos), as "18 Sep". The month name is ours, so a newer ICU cannot turn "Sep" into "Sept". */
export function lagosShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", timeZone: "Africa/Lagos" }).formatToParts(d);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  if (!day || !month) return iso;
  return `${day} ${MONTHS[month - 1]}`;
}

/**
 * "Why this gap is open", for a staff screen only (never a notification): the failed criterion and the last signal, in a sentence or two.
 * Built only from what the rule recorded in `why` (a criterion code, its line, a count of days, a date): the gap holds no reading value.
 * An unknown or malformed `why` gives the plain "no detail" line rather than a guess.
 */
export function whyOpenLines(gap: Pick<CareGapRow, "why" | "gap_type" | "due_date">): string[] {
  const why = isObj(gap.why) ? gap.why : {};
  const criterion = str(why.criterion);
  const lines: string[] = [];
  const lastAt = str(why.last_signal_at);
  const anchor = str(why.anchor);
  // the date a no-signal gap is counted from: a missed reading is due plan start + line, a lab gap is due plan start + lookback
  let anchorDate = gap.due_date;

  if (criterion === "no_reading_in_days") {
    const days = num(why.days_since);
    const line = num(why.threshold_days);
    if (days === null || line === null) return [careGapText("staff.why.unknown")];
    anchorDate = shiftDate(gap.due_date, -line);
    lines.push(careGapText(why.signal === "glucose" ? "staff.why.reading_glucose" : "staff.why.reading_bp", { days, line }));
  } else if (criterion === "no_lab_in_days") {
    const lookback = num(why.lookback_days);
    const grace = num(why.grace_days);
    if (lookback === null || grace === null) return [careGapText("staff.why.unknown")];
    anchorDate = shiftDate(gap.due_date, -lookback);
    lines.push(careGapText("staff.why.lab", { lookback, grace }));
  } else if (criterion === "bp_average_rose_between_windows") {
    const window = num(why.window_days);
    if (window === null) return [careGapText("staff.why.unknown")];
    lines.push(careGapText("staff.why.trend", { window }));
  } else if (criterion === "refill_past_due_days") {
    const days = num(why.days_since);
    const line = num(why.threshold_days);
    if (days === null || line === null) return [careGapText("staff.why.unknown")];
    lines.push(careGapText("staff.why.refill", { days, line }));
  } else if (criterion === "adherence_below_line_signal") {
    lines.push(careGapText("staff.why.adherence", { date: lastAt ? lagosShortDate(lastAt) : lagosShortDate(gap.due_date) }));
    return lines;
  } else {
    return [careGapText("staff.why.unknown")];
  }

  if (criterion === "bp_average_rose_between_windows") return lines;
  if (lastAt) lines.push(careGapText("staff.why.last_seen", { date: lagosShortDate(lastAt) }));
  else if (anchor === "plan_start") lines.push(careGapText("staff.why.never", { date: lagosShortDate(anchorDate) }));
  return lines;
}

export type NextAttempt =
  | { kind: "none" }
  | { kind: "scheduled"; at: string }
  | { kind: "overdue"; at: string };

/** Where the contact log stands: nothing scheduled, a next attempt coming, or one that is overdue. */
export function nextAttempt(gap: Pick<CareGapRow, "next_attempt_due_at" | "status">, now: Date = new Date()): NextAttempt {
  if (gap.status !== "open" || !gap.next_attempt_due_at) return { kind: "none" };
  const at = new Date(gap.next_attempt_due_at);
  if (Number.isNaN(at.getTime())) return { kind: "none" };
  return at.getTime() <= now.getTime() ? { kind: "overdue", at: gap.next_attempt_due_at } : { kind: "scheduled", at: gap.next_attempt_due_at };
}

export function nextAttemptText(next: NextAttempt): string {
  if (next.kind === "none") return careGapText("staff.next.none");
  const date = lagosShortDate(next.at);
  return careGapText(next.kind === "overdue" ? "staff.next.overdue" : "staff.next.due", { date });
}

export type ReviewClock = { kind: "none" } | { kind: "due"; at: string } | { kind: "overdue"; at: string };

/** The review clock of a doctor-owned gap: nothing for a coordinator's gap, a date, or a date that has passed. */
export function reviewClock(gap: Pick<CareGapRow, "review_due_at" | "status" | "owner_role">, now: Date = new Date()): ReviewClock {
  if (gap.status !== "open" || gap.owner_role !== "clinician" || !gap.review_due_at) return { kind: "none" };
  const at = new Date(gap.review_due_at);
  if (Number.isNaN(at.getTime())) return { kind: "none" };
  return at.getTime() <= now.getTime() ? { kind: "overdue", at: gap.review_due_at } : { kind: "due", at: gap.review_due_at };
}

export function reviewClockText(clock: ReviewClock): string {
  if (clock.kind === "none") return "";
  return careGapText(clock.kind === "overdue" ? "staff.review.overdue" : "staff.review.due", { date: lagosShortDate(clock.at) });
}

/** True when a gap belongs on a doctor's list rather than a coordinator's (a judgement item). */
export function isDoctorGap(gap: Pick<CareGapRow, "owner_role">): boolean {
  return gap.owner_role === "clinician";
}
