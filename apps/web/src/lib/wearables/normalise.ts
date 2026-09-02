/**
 * The one shape every provider's data is flattened into before it touches
 * the database, plus the rule for which table each metric belongs in.
 *
 * CLAUDE.md's Device & Wearable Integration contract: a wearable metric that
 * HAS a vitals_readings equivalent (heart rate -> pulse, weight, SpO2,
 * glucose) is written to vitals_readings with source='wearable' — same table
 * the patient's manual entries and BLE cuff readings land in, so the
 * downstream escalation/risk pipelines see it. Only metrics with no
 * vital_type at all (steps, sleep, HRV, recovery/strain scores) go to
 * wearable_readings. No parallel table for anything that already has a home.
 */

export const WEARABLE_READING_TYPES = [
  // Vitals-equivalent — routed to vitals_readings.
  "resting_heart_rate",
  "weight",
  "spo2",
  "glucose",
  "blood_pressure",
  // Wearable-only — routed to wearable_readings.
  "steps",
  "sleep_minutes",
  "sleep_efficiency",
  "hrv_ms",
  "recovery_score",
  "readiness_score",
  "strain",
  "calories",
  "respiratory_rate",
] as const;

export type WearableReadingType = (typeof WEARABLE_READING_TYPES)[number];

export interface NormalisedReading {
  readingType: WearableReadingType;
  value: number;
  /**
   * Only meaningful for `blood_pressure`, where it carries the diastolic
   * value. BP is the one metric here that is a single clinical fact made of
   * two numbers — splitting it into two rows would give the hypertension
   * pathway two half-readings it could not band, so it stays one reading
   * with a second value rather than becoming a second reading type.
   */
  secondaryValue?: number;
  unit: string;
  /** ISO-8601. The instant the metric describes, not when we fetched it. */
  recordedAt: string;
  /**
   * Stable per (connection, reading) so a provider redelivering the same
   * notification dedupes instead of double-writing. Must include the metric
   * name — one provider document routinely yields several metrics, and
   * keying on the document id alone would let the second metric collide with
   * the first.
   */
  externalReadingId: string;
}

type VitalsColumn = "pulse_bpm" | "weight_kg" | "spo2_pct" | "glucose_mmol_l" | "systolic";

interface VitalsEquivalent {
  vitalType: "pulse" | "weight" | "spo2" | "glucose" | "blood_pressure";
  column: VitalsColumn;
  /** Set only for blood_pressure, where NormalisedReading.secondaryValue
   * holds the diastolic figure. */
  secondaryColumn?: "diastolic";
  secondaryMin?: number;
  secondaryMax?: number;
  /** Mirrors the accepted range in lib/validation/vitals.ts. A wearable must
   * not be able to write a value a human would be blocked from typing —
   * out-of-range values are dropped rather than failing the whole batch,
   * since one glitched sample should not cost a patient the rest of a sync. */
  min: number;
  max: number;
  integer: boolean;
}

/**
 * NOTE for the clinical review this will need: SpO2 from a consumer wrist
 * wearable is not a clinical-grade pulse oximeter, and once it lands in
 * vitals_readings it is visible to the same red-flag surface as a real
 * fingertip oximeter reading. `source='wearable'` is the discriminator to
 * gate on if the clinical team decides consumer SpO2 must not raise an
 * escalation on its own — this module deliberately does not make that call.
 */
const VITALS_EQUIVALENT: Partial<Record<WearableReadingType, VitalsEquivalent>> = {
  resting_heart_rate: { vitalType: "pulse", column: "pulse_bpm", min: 40, max: 200, integer: true },
  weight: { vitalType: "weight", column: "weight_kg", min: 20, max: 300, integer: false },
  spo2: { vitalType: "spo2", column: "spo2_pct", min: 70, max: 100, integer: true },
  glucose: { vitalType: "glucose", column: "glucose_mmol_l", min: 1, max: 40, integer: false },
  // Ranges mirror bloodPressureSchema exactly, including its deliberately
  // wide upper bounds — a genuine hypertensive-crisis reading is the single
  // most important value to let through, not clamp away.
  blood_pressure: {
    vitalType: "blood_pressure",
    column: "systolic",
    secondaryColumn: "diastolic",
    min: 60,
    max: 260,
    secondaryMin: 30,
    secondaryMax: 160,
    integer: true,
  },
};

export function vitalsEquivalentFor(readingType: WearableReadingType): VitalsEquivalent | null {
  return VITALS_EQUIVALENT[readingType] ?? null;
}

/**
 * The four patient-facing consent categories a wearable connection can be
 * narrowed to (53.3/53.4's "separate permission where practical" — steps,
 * heart rate, sleep, weight are the categories actually named). Glucose,
 * blood pressure and SpO2 deliberately have no category here: they already
 * flow through vitals_readings' own plan-gated red-flag pipeline, which is
 * the more load-bearing consent surface for those, and reading()'s
 * per-metric routing already keeps clinically-significant readings out of
 * an all-or-nothing "give us everything" connect step regardless.
 */
export type WearableConsentCategory = "activity" | "heart_rate" | "sleep" | "weight";

const CONSENT_CATEGORY: Partial<Record<WearableReadingType, WearableConsentCategory>> = {
  steps: "activity",
  calories: "activity",
  resting_heart_rate: "heart_rate",
  hrv_ms: "heart_rate",
  respiratory_rate: "heart_rate",
  sleep_minutes: "sleep",
  sleep_efficiency: "sleep",
  weight: "weight",
};

/** Null for a reading type with no gated category (glucose, blood pressure,
 * SpO2, recovery/readiness/strain) — those are never filtered by consent. */
export function consentCategoryFor(readingType: WearableReadingType): WearableConsentCategory | null {
  return CONSENT_CATEGORY[readingType] ?? null;
}

/** One connection's per-category grants. Keyed to match the
 * wearable_connections consent_* columns directly. */
export interface WearableConsent {
  activity: boolean;
  heart_rate: boolean;
  sleep: boolean;
  weight: boolean;
}

export const FULL_WEARABLE_CONSENT: WearableConsent = {
  activity: true,
  heart_rate: true,
  sleep: true,
  weight: true,
};

/** True unless the reading's category is explicitly denied. A reading with
 * no gated category (see consentCategoryFor) is always permitted. */
export function isConsentedTo(reading: NormalisedReading, consent: WearableConsent): boolean {
  const category = consentCategoryFor(reading.readingType);
  if (!category) return true;
  return consent[category];
}

export function isVitalsEquivalent(readingType: WearableReadingType): boolean {
  return readingType in VITALS_EQUIVALENT;
}

/** True when the value is inside the range the platform would accept from a
 * human for the same vital. Non-vitals metrics have no clamp — a step count
 * or a sleep score has no physiological band to fall outside of. */
export function isPlausible(reading: NormalisedReading): boolean {
  if (!Number.isFinite(reading.value)) return false;
  const equivalent = vitalsEquivalentFor(reading.readingType);
  if (!equivalent) return reading.value >= 0;
  if (reading.value < equivalent.min || reading.value > equivalent.max) return false;

  if (equivalent.secondaryColumn) {
    const secondary = reading.secondaryValue;
    if (secondary === undefined || !Number.isFinite(secondary)) return false;
    if (secondary < (equivalent.secondaryMin ?? -Infinity)) return false;
    if (secondary > (equivalent.secondaryMax ?? Infinity)) return false;
    // Same cross-field check bloodPressureSchema enforces on manual entry:
    // a pair the wrong way round is a mis-recorded reading, not a finding.
    if (reading.value <= secondary) return false;
  }

  return true;
}

export function roundForColumn(readingType: WearableReadingType, value: number): number {
  const equivalent = vitalsEquivalentFor(readingType);
  if (equivalent?.integer) return Math.round(value);
  return value;
}

/** Providers are inconsistent about date vs datetime; anything unparseable is
 * dropped rather than stored as a wrong instant. */
export function toIsoInstant(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  const time = parsed.getTime();
  if (Number.isNaN(time)) return null;
  return parsed.toISOString();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Drops the nulls a list of `reading()` calls leaves behind when a provider
 * omitted a field. */
export function compactReadings(values: (NormalisedReading | null)[]): NormalisedReading[] {
  return values.filter((value): value is NormalisedReading => value !== null);
}

/** Small builder so each provider adapter stays a list of field lookups
 * rather than repeating the same object literal a dozen times. */
export function reading(
  readingType: WearableReadingType,
  value: number | null,
  unit: string,
  recordedAt: string | null,
  externalIdPrefix: string
): NormalisedReading | null {
  if (value === null || recordedAt === null) return null;
  return {
    readingType,
    value: roundForColumn(readingType, value),
    unit,
    recordedAt,
    externalReadingId: `${externalIdPrefix}:${readingType}`,
  };
}
