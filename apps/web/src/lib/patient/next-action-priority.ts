import type { AppIconName } from "@/lib/icons";
import type { MessageKey } from "@tarragon/i18n";

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
  | "safety_check"
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
  /** True when the emergency-event read FAILED. Unknown is not "no alert": it gets its own card just below a confirmed alert. */
  redAlertUnknown?: boolean;
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
  "safety_check",
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

type CopyKeys = Record<"title" | "body" | "cta", MessageKey>;
/**
 * Literal message keys per kind (typed lookup, no dynamic key cast). Each entry is checked against the i18n catalogue by `MessageKey`
 * and by the copy test, which resolves every key.
 */
export const NEXT_ACTION_COPY: Record<NextActionKind, CopyKeys> = {
  red_alert: { title: "dp.next.red_alert.title", body: "dp.next.red_alert.body", cta: "dp.next.red_alert.cta" },
  safety_check: { title: "dp.next.safety_check.title", body: "dp.next.safety_check.body", cta: "dp.next.safety_check.cta" },
  dose_due: { title: "dp.next.dose.title", body: "dp.next.dose.body", cta: "dp.next.dose.cta" },
  reading_due: { title: "dp.next.reading.title", body: "dp.next.reading.body", cta: "dp.next.reading.cta" },
  refill_low: { title: "dp.next.refill.title", body: "dp.next.refill.body", cta: "dp.next.refill.cta" },
  screening_due: { title: "dp.next.screening.title", body: "dp.next.screening.body", cta: "dp.next.screening.cta" },
  consult_slots: { title: "dp.next.consult.title", body: "dp.next.consult.body", cta: "dp.next.consult.cta" },
  checkin_open: { title: "dp.next.checkin.title", body: "dp.next.checkin.body", cta: "dp.next.checkin.cta" },
  review_due: { title: "dp.next.review.title", body: "dp.next.review.body", cta: "dp.next.review.cta" },
  lesson_ready: { title: "dp.next.lesson.title", body: "dp.next.lesson.body", cta: "dp.next.lesson.cta" },
  caught_up: { title: "dp.next.caught_up.title", body: "dp.next.caught_up.body", cta: "dp.next.caught_up.cta" },
};

export function pickNextAction(f: NextActionFacts): NextAction {
  if (f.hasUnansweredRedAlert) return { kind: "red_alert", icon: "warning", href: "/patient#overview" };
  if (f.redAlertUnknown) return { kind: "safety_check", icon: "warning", href: "/patient#overview" };
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
