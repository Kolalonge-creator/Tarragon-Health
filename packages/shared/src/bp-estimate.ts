/**
 * A blood pressure that came from a watch, ring or phone sensor (`vitals_readings.source = 'wearable'`) is an ESTIMATE: it is kept and shown,
 * labelled "Wearable estimate", but it is not a diagnostic number. The database rule is `private.bp_reading_is_estimate(text)` and the
 * database view `private.vitals_readings_diagnostic`; this file is the TypeScript twin for code that computes a blood pressure number
 * itself (an average, a trend, a control percentage, a rule window). Design: docs/design/BP-wearable-estimates.md.
 *
 * A wrist CUFF is not an estimate (source manual or device, cuff_type wrist): every cuff reading is graded, never downgraded for cuff type.
 * Only blood pressure is covered. Pulse and every other vital are unchanged.
 */

/** The one `source` value that marks a blood pressure estimate. Keep in step with `private.bp_reading_is_estimate`. */
export const BP_ESTIMATE_SOURCE = "wearable" as const;

/** True for a source whose blood pressure is an estimate. Unknown, null and undefined are NOT estimates (a missing source must never hide a cuff reading). */
export function isEstimateBpSource(source: string | null | undefined): boolean {
  return source === BP_ESTIMATE_SOURCE;
}

/** Keeps the readings that may feed an average, a trend, a control figure or a rule. Order and the other fields are untouched. */
export function diagnosticBpReadings<T extends { source?: string | null }>(readings: readonly T[]): T[] {
  return readings.filter((r) => !isEstimateBpSource(r.source));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// S70b: "last checked against a cuff". A wearable estimate is only as trustworthy as its most recent comparison with a real cuff. This is a
// LABEL on the estimate, not a correction: no estimate is ever adjusted, graded or averaged because of it, and a stale label never raises an alert.
// The number of days is PROPOSED configuration (`bp.cuffless_calibration`, owner CMO, unsigned), never a literal here.
// ---------------------------------------------------------------------------------------------------------------------------------------------

export interface CufflessCalibrationConfig {
  /** An estimate is "stale" when the newest cuff reading is older than this many days. */
  readonly staleAfterDays: number;
  /** When a wrist or ring blood pressure looks high, the prompt asks for a cuff check within this many days. */
  readonly cuffCheckWithinDays: number;
}

export type CufflessCalibrationState =
  | { readonly kind: "never" }
  | { readonly kind: "checked"; readonly lastCheckedAt: string; readonly daysAgo: number }
  | { readonly kind: "stale"; readonly lastCheckedAt: string; readonly daysAgo: number };

const DAY_MS = 86_400_000;

/**
 * When the estimate itself looks raised (the live amber, red or emergency band) the screen already gives the usual recheck or emergency guidance. The "rough guide"
 * wording and the general cuff-check line are left out then, so a person is never given two different messages about the same reading.
 */
export function cufflessNoteIsQuiet(level: string | null | undefined): boolean {
  return level === "amber" || level === "red" || level === "emergency";
}

/** The newest reading that is NOT an estimate (so a real cuff reading: manual, device, photo-confirmed, pharmacy, clinic). Returns an ISO instant or null. */
export function latestCuffCheckAt(readings: readonly { source?: string | null; takenAt: string }[]): string | null {
  let best: number | null = null;
  for (const r of readings) {
    if (isEstimateBpSource(r.source)) continue;
    const t = Date.parse(r.takenAt);
    if (Number.isNaN(t)) continue;
    if (best === null || t > best) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

/** Never throws. A last check dated in the future (a wrong phone clock) counts as today, never as a negative number of days. */
export function cufflessCalibration(lastCuffCheckAt: string | null | undefined, now: Date, cfg: CufflessCalibrationConfig): CufflessCalibrationState {
  if (!lastCuffCheckAt) return { kind: "never" };
  const t = Date.parse(lastCuffCheckAt);
  if (Number.isNaN(t)) return { kind: "never" };
  const daysAgo = Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
  return daysAgo > cfg.staleAfterDays ? { kind: "stale", lastCheckedAt: lastCuffCheckAt, daysAgo } : { kind: "checked", lastCheckedAt: lastCuffCheckAt, daysAgo };
}
