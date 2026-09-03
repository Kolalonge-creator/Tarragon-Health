/**
 * Medication safety pathway 64.6 — a non-diagnostic adherence "signal",
 * exactly the shape the spec illustrates: expected refill 30 days, actual
 * refill 37 days -> "potential gap". PURE, unit-testable, and — like every
 * other advisory engine in this directory (drug-safety.ts,
 * diabetes-drug-safety.ts) — never framed as proof. A gap here means "the
 * patient collected this medicine later than its own day-supply would
 * suggest," which is consistent with a missed dose, a stockpiled reserve
 * from an earlier early pickup, a dose change, or simply this being an
 * incomplete slice of a longer real-world pattern. It is a prompt to ask,
 * not a finding to act on unilaterally.
 */

export interface RefillGapSignal {
  medicationId: string;
  /** From medications.duration_days — the prescribed day-supply this refill interval is judged against. */
  expectedIntervalDays: number;
  /** Days between the two most recent collections on file. */
  actualIntervalDays: number;
  /** actualIntervalDays - expectedIntervalDays. Always positive when a signal exists. */
  gapDays: number;
  fromDate: string;
  toDate: string;
}

/**
 * A gap below this is ordinary pharmacy-visit timing noise (picking up a
 * day or three early/late), not a coverage gap worth surfacing — flagging
 * it would make the signal noisy enough that a real gap stops standing out.
 */
const GAP_THRESHOLD_DAYS = 5;

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return Math.round((to - from) / 86_400_000);
}

/**
 * Computes a potential-gap signal from a medication's own day-supply and its
 * two most recent collection dates. Returns null whenever there isn't enough
 * to say anything: no known day-supply, fewer than two collections, or the
 * gap is within ordinary pharmacy-visit timing noise.
 */
export function computeRefillGapSignal(
  medicationId: string,
  expectedIntervalDays: number | null | undefined,
  dispenseDates: string[]
): RefillGapSignal | null {
  if (expectedIntervalDays == null || expectedIntervalDays <= 0) return null;
  if (dispenseDates.length < 2) return null;

  const sorted = [...dispenseDates].sort((a, b) => a.localeCompare(b));
  const fromDate = sorted[sorted.length - 2];
  const toDate = sorted[sorted.length - 1];
  const actualIntervalDays = daysBetween(fromDate, toDate);
  const gapDays = actualIntervalDays - expectedIntervalDays;

  if (gapDays < GAP_THRESHOLD_DAYS) return null;

  return { medicationId, expectedIntervalDays, actualIntervalDays, gapDays, fromDate, toDate };
}

/** The exact non-diagnostic caveat 64.6 requires alongside any gap signal shown. */
export const REFILL_GAP_DISCLAIMER =
  "This compares how long this medicine is meant to last against how long it was between pickups — it is not proof the medicine wasn't taken. It can also mean an earlier pickup left extra on hand, or the dose changed.";
