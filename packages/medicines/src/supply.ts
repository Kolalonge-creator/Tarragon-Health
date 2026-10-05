import { addDays, daysBetween, lagosLocalDate, lagosTimeToUtcMs, type LocalDate } from "./lagos";
import { slotsBetween } from "./schedule";
import type { ScheduleSpec } from "./types";

/**
 * Pill count and refill countdown.
 *
 * The patient (or the pharmacy hand-over) sets a count at a moment in time.
 * What is left now is that count minus what the dose log says was taken since;
 * how many days it lasts is found by walking the schedule forward until a dose
 * can no longer be covered. The patient can correct the count at any time, and
 * the estimate starts again from the corrected number, so a wrong guess never
 * compounds.
 */
export const MAX_SUPPLY_HORIZON_DAYS = 366;

export interface SupplyInput {
  /** Pills counted at `countedAtMs`. Halves are allowed (a split tablet). */
  pillsOnHand: number;
  countedAtMs: number;
  /** Pills per dose. A taper step's own dose text does not change this: a taper medicine needs a manual count. */
  pillsPerDose: number;
  spec: ScheduleSpec;
  /** Doses marked taken (on time or late) at or after the count, each worth one dose of pills. */
  dosesTakenSinceCount: number;
  nowMs: number;
  /** Slot keys (`${date}|${time}`) already answered, so today's logged doses are not counted twice. */
  answeredSlots?: ReadonlySet<string>;
}

export interface SupplyEstimate {
  pillsLeft: number;
  /** Whole days of doses still covered from today, or null when the schedule has no future doses to count against. */
  daysLeft: number | null;
  /** The date the first uncovered dose falls on, or null. */
  runOutDate: LocalDate | null;
  /** True when the supply lasts to the schedule's end date. */
  coversCourse: boolean;
}

export type CountRefusal = "not_a_number" | "negative" | "not_half_units" | "too_large";

export function validatePillCount(value: unknown): { ok: true; value: number } | { ok: false; reason: CountRefusal } {
  if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, reason: "not_a_number" };
  if (value < 0) return { ok: false, reason: "negative" };
  if (value > 10000) return { ok: false, reason: "too_large" };
  if (value * 2 !== Math.floor(value * 2)) return { ok: false, reason: "not_half_units" };
  return { ok: true, value };
}

export function estimateSupply(input: SupplyInput): SupplyEstimate {
  const perDose = input.pillsPerDose > 0 ? input.pillsPerDose : 1;
  const pillsLeft = Math.max(0, input.pillsOnHand - input.dosesTakenSinceCount * perDose);
  const today = lagosLocalDate(input.nowMs);
  const horizonEnd = addDays(today, MAX_SUPPLY_HORIZON_DAYS);
  const slots = slotsBetween(input.spec, today, horizonEnd);

  let remaining = pillsLeft;
  let counted = 0;
  for (const slot of slots) {
    const dueAt = lagosTimeToUtcMs(slot.date, slot.time);
    // Past slots: only an unanswered one that is still ahead of the clock needs pills.
    if (dueAt <= input.nowMs) continue;
    if (input.answeredSlots?.has(`${slot.date}|${slot.time}`)) continue;
    if (remaining < perDose) {
      return { pillsLeft, daysLeft: Math.max(0, daysBetween(today, slot.date)), runOutDate: slot.date, coversCourse: false };
    }
    remaining -= perDose;
    counted += 1;
  }
  if (counted === 0) return { pillsLeft, daysLeft: null, runOutDate: null, coversCourse: false };
  const bounded = input.spec.endDate !== null && input.spec.endDate < horizonEnd;
  return { pillsLeft, daysLeft: null, runOutDate: null, coversCourse: bounded };
}

/**
 * Running low means a known run-out date inside `lowSupplyDays`. A schedule that
 * never runs out inside the horizon, or a course the supply covers, is not low.
 */
export function isRunningLow(estimate: SupplyEstimate, lowSupplyDays: number): boolean {
  return estimate.daysLeft !== null && estimate.daysLeft <= lowSupplyDays;
}
