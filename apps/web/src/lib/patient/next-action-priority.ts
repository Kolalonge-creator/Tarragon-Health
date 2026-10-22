import type { AppIconName } from "@/lib/icons";

/**
 * Design principle 1 (Home shows one next action).
 *
 * The facts are plain yes/no or small records the server already has under RLS. The order below is fixed code, set by the founder, and
 * is NEVER chosen by a language model. Nothing here writes, scores or invents a threshold.
 *
 * Order (first match wins):
 *   1. an unanswered red alert (an active emergency event the patient has not acknowledged)
 *   2. a dose that is due now
 *   3. a reading that is due (none logged in the last 7 days)
 *   4. a refill running low (due within 7 days)
 *   then the existing to-do items that were already on this card before the founder's order was set (kept, slotted after refills so
 *   nothing that used to show is lost): screening due, doctor-offered video times, a medicines check-in, a medication review;
 *   5. this week's lesson
 *   6. all caught up
 */
export type NextActionKind =
  | "red_alert"
  | "dose_due"
  | "reading_due"
  | "refill_low"
  | "screening_due"
  | "consult_slots"
  | "checkin_open"
  | "review_due"
  | "lesson_ready"
  | "caught_up";

export interface NextActionFacts {
  hasUnansweredRedAlert: boolean;
  /** Any dose slot today whose time has passed and which is still pending. */
  hasDoseDue: boolean;
  /** True when NO reading has been logged in the last 7 days. */
  readingDue: boolean;
  refillDrugName: string | null;
  screeningName: string | null;
  hasConsultSlotsOffered: boolean;
  hasCheckinOpen: boolean;
  hasReviewDue: boolean;
  lessonReady: boolean;
  /** True when any query behind these facts failed. A failure must never read as "all caught up" (silent failure). */
  dataUnavailable?: boolean;
}

export interface NextAction {
  kind: NextActionKind;
  icon: AppIconName;
  href: string;
  /** Params for the `dp.next.<kind>.*` strings. */
  params?: Record<string, string>;
}

export const NEXT_ACTION_ORDER: readonly NextActionKind[] = [
  "red_alert",
  "dose_due",
  "reading_due",
  "refill_low",
  "screening_due",
  "consult_slots",
  "checkin_open",
  "review_due",
  "lesson_ready",
  "caught_up",
];

/** The `dp.next.<slug>.title|body|cta` copy slug for each kind. */
export const NEXT_ACTION_COPY_SLUG = {
  red_alert: "red_alert",
  dose_due: "dose",
  reading_due: "reading",
  refill_low: "refill",
  screening_due: "screening",
  consult_slots: "consult",
  checkin_open: "checkin",
  review_due: "review",
  lesson_ready: "lesson",
  caught_up: "caught_up",
} as const satisfies Record<NextActionKind, string>;

export function pickNextAction(f: NextActionFacts): NextAction {
  if (f.hasUnansweredRedAlert) return { kind: "red_alert", icon: "warning", href: "/patient#overview" };
  if (f.hasDoseDue) return { kind: "dose_due", icon: "medication", href: "/patient/medications" };
  if (f.readingDue) return { kind: "reading_due", icon: "bp", href: "/patient/vitals" };
  if (f.refillDrugName) return { kind: "refill_low", icon: "medication", href: "/patient/medications", params: { name: f.refillDrugName } };
  if (f.screeningName) return { kind: "screening_due", icon: "preventive", href: "/patient/prevention", params: { name: f.screeningName } };
  if (f.hasConsultSlotsOffered) return { kind: "consult_slots", icon: "booking", href: "/patient/health-check" };
  if (f.hasCheckinOpen) return { kind: "checkin_open", icon: "medication", href: "/patient/medications" };
  if (f.hasReviewDue) return { kind: "review_due", icon: "medication", href: "/patient/medications" };
  if (f.lessonReady) return { kind: "lesson_ready", icon: "learn", href: "/patient/learn" };
  // A failed read is not evidence that nothing is waiting: fall back to the always-safe reading prompt, never the all-clear.
  if (f.dataUnavailable) return { kind: "reading_due", icon: "bp", href: "/patient/vitals" };
  return { kind: "caught_up", icon: "preventive", href: "/patient/vitals" };
}
