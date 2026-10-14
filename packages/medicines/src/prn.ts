import { lagosLocalDate } from "./lagos";

/**
 * As-needed (PRN) limits (S08x, decision C7).
 *
 * A clinician may set, per medicine, a shortest gap between doses and a most doses in a Lagos day. There
 * are no defaults: a medicine without limits is never checked. A dose outside the limits is STILL LOGGED
 * (the check only decides whether to show the patient a notice) and nothing here ever suggests a double dose.
 *
 * One rule, two implementations. This is the phone's; `private.prn_exceedances` in the database is the
 * server's, and both run the cases in `prn.fixtures.ts`. The rule is order independent, so a dose logged
 * offline and synced late is judged the same as one logged in order: counting only doses taken before it
 * (an earlier time), a dose is "over" when another dose lies within the gap, or when it is more than
 * `dailyMax` for its Lagos day.
 */
export interface PrnLimits {
  /** Shortest gap between two doses, in minutes. Null: not limited. */
  minGapMinutes: number | null;
  /** Most doses in one Lagos day. Null: not limited. */
  dailyMax: number | null;
}

export type PrnBreach = "min_gap" | "daily_max";

/** Bounds a clinician may set (PROPOSED, `medicines.prn_limits`). */
export interface PrnBounds {
  minGapMinutes: readonly [number, number];
  dailyMax: readonly [number, number];
}

/**
 * Which limits this dose breaks. `priorDosesMs` are the times of the other doses of the same medicine
 * that count as taken, in any order, not including this one.
 */
export function checkPrnDose(limits: PrnLimits, priorDosesMs: readonly number[], doseAtMs: number): PrnBreach[] {
  const out: PrnBreach[] = [];
  const earlier = priorDosesMs.filter((t) => t <= doseAtMs);
  if (limits.minGapMinutes !== null) {
    const gapMs = limits.minGapMinutes * 60_000;
    if (earlier.some((t) => doseAtMs - t < gapMs)) out.push("min_gap");
  }
  if (limits.dailyMax !== null) {
    const day = lagosLocalDate(doseAtMs);
    const sameDay = earlier.filter((t) => lagosLocalDate(t) === day).length;
    if (sameDay + 1 > limits.dailyMax) out.push("daily_max");
  }
  return out;
}

export type PrnLimitsInput = { minGapMinutes?: unknown; dailyMax?: unknown };
export type PrnLimitsCheck =
  | { ok: true; limits: PrnLimits }
  | { ok: false; errors: ("minGapMinutes" | "dailyMax" | "empty")[] };

function inBounds(v: unknown, b: readonly [number, number]): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= b[0] && v <= b[1];
}

/** A clinician's input against the signed bounds. At least one limit must be set. */
export function validatePrnLimits(input: PrnLimitsInput, bounds: PrnBounds): PrnLimitsCheck {
  const errors: ("minGapMinutes" | "dailyMax" | "empty")[] = [];
  const gap = input.minGapMinutes ?? null;
  const max = input.dailyMax ?? null;
  if (gap !== null && !inBounds(gap, bounds.minGapMinutes)) errors.push("minGapMinutes");
  if (max !== null && !inBounds(max, bounds.dailyMax)) errors.push("dailyMax");
  if (gap === null && max === null) errors.push("empty");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, limits: { minGapMinutes: gap as number | null, dailyMax: max as number | null } };
}
