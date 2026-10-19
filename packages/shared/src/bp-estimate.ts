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
