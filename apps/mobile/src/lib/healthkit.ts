import { Platform } from "react-native";
import Healthkit, {
  BloodGlucoseUnit,
  HKCorrelationTypeIdentifier,
  HKQuantityTypeIdentifier,
  HKStatisticsOptions,
  HKUnits,
  type HealthkitReadAuthorization,
  type HKQuantitySample,
} from "@kingstinct/react-native-healthkit";

/**
 * Apple Health (HealthKit) bridge.
 *
 * Per CLAUDE.md's Device & Wearable Integration section, Apple Health has no
 * cloud OAuth API at all — its data is device-local, so it cannot be reached
 * by the server-side connect/callback flow every other wearable provider
 * uses. The phone is the only thing that can read it, which is why this
 * lives in the Expo app next to the BLE pairing layer rather than in
 * apps/web, and why the samples are uploaded to a bearer-authenticated route
 * (POST /api/mobile/health-samples) instead of arriving as a webhook.
 *
 * Read-only, always: this app never writes back into HealthKit, which is why
 * the config plugin in app.json disables NSHealthUpdateUsageDescription.
 * Nothing is read without the patient granting the specific permission in
 * Apple's own sheet, and iOS deliberately does not tell an app which
 * permissions were denied — a denied type simply returns no samples, which
 * is why a sync that finds nothing is a normal outcome here rather than an
 * error.
 *
 * iOS-only. Every entry point returns a safe empty result elsewhere.
 */

/** Matches the reading_type vocabulary the ingestion route shares with the
 * cloud-sync path (apps/web/src/lib/wearables/normalise.ts), so a HealthKit
 * sample and a Fitbit reading are routed by exactly the same rule. */
export interface HealthSample {
  reading_type:
    | "blood_pressure"
    | "glucose"
    | "resting_heart_rate"
    | "weight"
    | "spo2"
    | "hrv_ms"
    | "steps";
  value: number;
  /** Diastolic, blood_pressure only. */
  secondary_value?: number;
  unit: string;
  recorded_at: string;
  external_reading_id: string;
}

const READ_PERMISSIONS: HealthkitReadAuthorization[] = [
  HKQuantityTypeIdentifier.bloodPressureSystolic,
  HKQuantityTypeIdentifier.bloodPressureDiastolic,
  HKQuantityTypeIdentifier.bloodGlucose,
  HKQuantityTypeIdentifier.restingHeartRate,
  HKQuantityTypeIdentifier.bodyMass,
  HKQuantityTypeIdentifier.oxygenSaturation,
  HKQuantityTypeIdentifier.heartRateVariabilitySDNN,
  HKQuantityTypeIdentifier.stepCount,
  HKCorrelationTypeIdentifier.bloodPressure,
];

/** Per-type ceiling on one read. A patient who has been logging for years
 * would otherwise hand back a decade of samples on first connect. */
const PER_TYPE_LIMIT = 200;

/** How far back a first-ever sync reaches when there is no cursor. Enough to
 * give a clinician real trend context without importing a whole history a
 * patient never agreed to share in that volume. */
export const INITIAL_WINDOW_DAYS = 30;

export function isHealthKitPlatform(): boolean {
  return Platform.OS === "ios";
}

export async function isHealthKitAvailable(): Promise<boolean> {
  if (!isHealthKitPlatform()) return false;
  try {
    return await Healthkit.isHealthDataAvailable();
  } catch {
    return false;
  }
}

/**
 * Shows Apple's permission sheet. The boolean only reports that the sheet
 * was presented and dismissed — iOS deliberately hides which read
 * permissions were granted so an app cannot infer a health condition from a
 * refusal. Treat it as "the patient has been asked", never as "we have the
 * data".
 */
export async function requestHealthKitPermissions(): Promise<boolean> {
  if (!isHealthKitPlatform()) return false;
  try {
    return await Healthkit.requestAuthorization(READ_PERMISSIONS);
  } catch {
    return false;
  }
}

export async function readHealthSamples(since: Date, until: Date): Promise<HealthSample[]> {
  if (!(await isHealthKitAvailable())) return [];

  // Each reader is independent and self-contained: one denied permission or
  // one unavailable type must not cost the sync every other metric.
  const groups = await Promise.all([
    readBloodPressure(since, until),
    readQuantity(
      "glucose",
      HKQuantityTypeIdentifier.bloodGlucose,
      BloodGlucoseUnit.GlucoseMmolPerL,
      "mmol/L",
      since,
      until
    ),
    readQuantity(
      "resting_heart_rate",
      HKQuantityTypeIdentifier.restingHeartRate,
      "count/min",
      "bpm",
      since,
      until
    ),
    readQuantity("weight", HKQuantityTypeIdentifier.bodyMass, "kg", "kg", since, until),
    readOxygenSaturation(since, until),
    readQuantity(
      "hrv_ms",
      HKQuantityTypeIdentifier.heartRateVariabilitySDNN,
      "ms",
      "ms",
      since,
      until
    ),
    readDailySteps(since, until),
  ]);

  return groups.flat();
}

/**
 * Blood pressure is a correlation in HealthKit, not two independent samples,
 * and it has to stay that way here: a systolic and a diastolic split into
 * separate readings would give the hypertension pathway two halves it cannot
 * band. The correlation's own UUID is the dedupe key.
 */
async function readBloodPressure(since: Date, until: Date): Promise<HealthSample[]> {
  try {
    const correlations = await Healthkit.queryCorrelationSamples(
      HKCorrelationTypeIdentifier.bloodPressure,
      { from: since, to: until }
    );

    const samples: HealthSample[] = [];
    for (const correlation of correlations.slice(0, PER_TYPE_LIMIT)) {
      let systolic: number | null = null;
      let diastolic: number | null = null;
      // A correlation has no UUID of its own, so the systolic sample's UUID
      // is the stable dedupe key for the pair.
      let systolicUuid: string | null = null;

      for (const object of correlation.objects) {
        if (!isQuantitySample(object)) continue;
        // HealthKit reports pressure in mmHg; anything else means the
        // preferred unit changed underneath us and the number would be
        // wrong, so it is skipped rather than stored.
        if (typeof object.unit === "string" && !object.unit.includes("mmHg")) continue;
        if (object.quantityType === HKQuantityTypeIdentifier.bloodPressureSystolic) {
          systolic = object.quantity;
          systolicUuid = object.uuid;
        }
        if (object.quantityType === HKQuantityTypeIdentifier.bloodPressureDiastolic) {
          diastolic = object.quantity;
        }
      }

      if (systolic === null || diastolic === null || systolicUuid === null) continue;
      samples.push({
        reading_type: "blood_pressure",
        value: Math.round(systolic),
        secondary_value: Math.round(diastolic),
        unit: "mmHg",
        recorded_at: correlation.startDate.toISOString(),
        external_reading_id: systolicUuid,
      });
    }
    return samples;
  } catch {
    return [];
  }
}

/**
 * SpO2 needs its own reader because HealthKit's percent unit is a 0.0–1.0
 * fraction, not a 0–100 figure. Uploading it raw would put every reading at
 * "1%" and, once it reached vitals_readings, look like a patient in
 * catastrophic hypoxia.
 */
async function readOxygenSaturation(since: Date, until: Date): Promise<HealthSample[]> {
  const fractions = await readQuantity(
    "spo2",
    HKQuantityTypeIdentifier.oxygenSaturation,
    HKUnits.Percent,
    "%",
    since,
    until
  );
  return fractions.map((sample) => ({
    ...sample,
    // Guard rather than assume: if a future iOS version starts returning a
    // real percentage, doubling it would be the same class of error.
    value: Math.round(sample.value <= 1.5 ? sample.value * 100 : sample.value),
  }));
}

async function readQuantity(
  readingType: HealthSample["reading_type"],
  identifier: HKQuantityTypeIdentifier,
  healthKitUnit: string,
  reportedUnit: string,
  since: Date,
  until: Date
): Promise<HealthSample[]> {
  try {
    const samples = await Healthkit.queryQuantitySamples(identifier, {
      from: since,
      to: until,
      limit: PER_TYPE_LIMIT,
      ascending: true,
      // The library's unit type is narrowed per identifier; every call site
      // above passes the unit that identifier actually accepts.
      unit: healthKitUnit,
    } as Parameters<typeof Healthkit.queryQuantitySamples>[1]);

    return samples.map((sample) => ({
      reading_type: readingType,
      value: sample.quantity,
      unit: reportedUnit,
      recorded_at: sample.startDate.toISOString(),
      external_reading_id: sample.uuid,
    }));
  } catch {
    return [];
  }
}

/**
 * Steps are read as a daily statistics collection rather than as raw
 * samples. HealthKit stores a step sample per source, so an iPhone and a
 * Watch worn on the same walk both record it — summing raw samples would
 * roughly double every step count. The statistics query is the API that
 * deduplicates across sources, which is the whole reason to use it here.
 */
async function readDailySteps(since: Date, until: Date): Promise<HealthSample[]> {
  try {
    const anchor = startOfDay(since);
    const buckets = await Healthkit.queryStatisticsCollectionForQuantity(
      HKQuantityTypeIdentifier.stepCount,
      [HKStatisticsOptions.cumulativeSum, HKStatisticsOptions.mostRecent],
      anchor,
      { day: 1 },
      since,
      until,
      HKUnits.Count
    );

    const samples: HealthSample[] = [];
    buckets.forEach((bucket, index) => {
      const total = bucket.sumQuantity?.quantity;
      if (typeof total !== "number" || total <= 0) return;

      // Buckets come back in order from the anchor at one-day intervals, but
      // deriving the date from the index alone breaks silently if that ever
      // changes — so a real timestamp inside the bucket is preferred and the
      // index is only the fallback.
      const interval = bucket.mostRecentQuantityDateInterval?.from;
      const bucketDate = interval
        ? new Date(interval)
        : new Date(anchor.getTime() + index * 24 * 3600_000);
      if (Number.isNaN(bucketDate.getTime())) return;

      samples.push({
        reading_type: "steps",
        value: Math.round(total),
        unit: "steps",
        recorded_at: bucketDate.toISOString(),
        // One step total per calendar day, so the dedupe key is the day —
        // a later re-sync of the same day legitimately replaces nothing and
        // is simply ignored as a duplicate.
        external_reading_id: `steps:${bucketDate.toISOString().slice(0, 10)}`,
      });
    });
    return samples;
  } catch {
    return [];
  }
}

function isQuantitySample(value: unknown): value is HKQuantitySample {
  return (
    typeof value === "object" &&
    value !== null &&
    "quantityType" in value &&
    "quantity" in value
  );
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
