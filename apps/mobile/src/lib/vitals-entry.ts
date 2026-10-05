/**
 * Entry-time checks for the manual vitals forms, extracted from the screen so they
 * are unit tested. These are typo gates, NOT clinical logic: deliberately far wider
 * than any classification threshold (bp-classification.ts, glucose-red-flags.ts), so
 * a genuinely dangerous reading always submits and still raises the emergency
 * guidance; only values no live human could produce are stopped.
 *
 * They must never be WIDER than the server's own bands (apps/web/src/lib/validation/
 * vitals.ts, which POST /api/mobile/vitals validates against). A phone bound wider
 * than the server's turns a typo into a poison queue entry: the screen accepts it,
 * the outbox stores it, the API answers 400, and the row is rejected. A test
 * (vitals-entry.test.ts) checks the server accepts every bound below, so the
 * direction to fix a mismatch stays: widen the server first, then follow it here.
 */
export type OtherVitalType = "glucose" | "weight" | "temperature" | "spo2" | "pulse";
export type GlucoseUnit = "mmol_l" | "mg_dl";

/** Strict Number() parse: trims, accepts a comma decimal separator (some Android
 * decimal pads emit one), rejects empty input and trailing garbage ("12abc" is null
 * here, not 12 as with parseInt), rejects NaN and Infinity. */
export function parseStrictNumber(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (normalized === "") return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export const BP_BOUNDS = {
  systolic: { min: 60, max: 260 },
  diastolic: { min: 30, max: 160 },
} as const;

export const OTHER_VITAL_BOUNDS: Record<Exclude<OtherVitalType, "glucose">, { min: number; max: number }> = {
  weight: { min: 20, max: 300 },
  temperature: { min: 30, max: 45 },
  spo2: { min: 50, max: 100 },
  pulse: { min: 20, max: 300 },
};

/** A glucose value out of range for one unit is very often a correct value in the
 * other (mg/dL is 18 times mmol/L), so the range error points at the unit toggle. */
export const GLUCOSE_BOUNDS: Record<GlucoseUnit, { min: number; max: number }> = {
  mmol_l: { min: 1, max: 40 },
  mg_dl: { min: 18, max: 720 },
};

export type BpEntryError = "numbers" | "range" | "order";

export type BpEntryResult = { ok: true; systolic: number; diastolic: number } | { ok: false; error: BpEntryError };

export function validateBpEntry(systolicRaw: string, diastolicRaw: string): BpEntryResult {
  const systolic = parseStrictNumber(systolicRaw);
  const diastolic = parseStrictNumber(diastolicRaw);
  if (systolic === null || diastolic === null) return { ok: false, error: "numbers" };
  if (
    systolic < BP_BOUNDS.systolic.min ||
    systolic > BP_BOUNDS.systolic.max ||
    diastolic < BP_BOUNDS.diastolic.min ||
    diastolic > BP_BOUNDS.diastolic.max
  ) {
    return { ok: false, error: "range" };
  }
  if (systolic <= diastolic) return { ok: false, error: "order" };
  return { ok: true, systolic, diastolic };
}

export type OtherEntryError = "number" | "range_glucose_mmol" | "range_glucose_mgdl" | "range_weight" | "range_temperature" | "range_spo2" | "range_pulse";

export type OtherEntryResult = { ok: true; value: number } | { ok: false; error: OtherEntryError };

export function validateOtherEntry(type: OtherVitalType, raw: string, glucoseUnit: GlucoseUnit): OtherEntryResult {
  const value = parseStrictNumber(raw);
  if (value === null) return { ok: false, error: "number" };
  const bounds = type === "glucose" ? GLUCOSE_BOUNDS[glucoseUnit] : OTHER_VITAL_BOUNDS[type];
  if (value < bounds.min || value > bounds.max) {
    return {
      ok: false,
      error: type === "glucose" ? (glucoseUnit === "mmol_l" ? "range_glucose_mmol" : "range_glucose_mgdl") : (`range_${type}` as OtherEntryError),
    };
  }
  return { ok: true, value };
}
