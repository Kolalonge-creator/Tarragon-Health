import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import type * as HealthkitPackage from "@kingstinct/react-native-healthkit";
import type { QuantitySample } from "@kingstinct/react-native-healthkit";

/**
 * Loaded lazily via require(), never as a static top-level import. The
 * package (v14, Nitro-based) eagerly binds its native module the moment it
 * is imported — src/modules.ts calls NitroModules.createHybridObject() at
 * module scope, which throws immediately when the native binary isn't
 * linked. Expo Go never has this third-party module compiled in, so a
 * static `import ... from "@kingstinct/react-native-healthkit"` at the top
 * of this file crashed the entire JS bundle before AppRegistry ever
 * registered the app — surfaced natively as "main has not been registered",
 * not as a HealthKit-specific error, because devices-screen.tsx (and this
 * module transitively) is imported unconditionally by App.tsx. Deferring
 * the require() to first use, inside try/catch, contains the failure to
 * "HealthKit unavailable" the way every function below already assumed it
 * would, instead of taking down app boot. Revisit once a real EAS
 * development build (with the native module actually compiled in) replaces
 * Expo Go for testing this feature.
 */
let cachedModule: typeof HealthkitPackage | null | undefined;

/**
 * Expo Go never has this third-party native module compiled in, and — the
 * part that matters — the resulting Nitro failure is NOT catchable from JS.
 * Wrapping the require() in try/catch was tried and demonstrably does not
 * contain it: the error still reached LogBox as a full-screen "Uncaught
 * Error: NitroModules are not supported in Expo Go", re-appearing as fast as
 * it could be dismissed, the moment a patient signed in. It has to not be
 * required at all.
 *
 * `storeClient` is the Expo Go execution environment; a real EAS development
 * build or a store build reports `standalone`/`bare` and loads the module
 * normally, so this costs production nothing. expo-constants is JS-level
 * config already present inside the Expo Go runtime and autolinked in EAS
 * builds, so depending on it needs no native rebuild.
 */
const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

function loadHealthkit(): typeof HealthkitPackage | null {
  if (cachedModule !== undefined) return cachedModule;
  if (IS_EXPO_GO) {
    cachedModule = null;
    return cachedModule;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require("@kingstinct/react-native-healthkit") as typeof HealthkitPackage;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

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

// v14's identifiers are plain string literals (no more HK*Identifier enums) —
// see the package's src/generated/healthkit.generated.ts.
const READ_PERMISSIONS = [
  "HKQuantityTypeIdentifierBloodPressureSystolic",
  "HKQuantityTypeIdentifierBloodPressureDiastolic",
  "HKQuantityTypeIdentifierBloodGlucose",
  "HKQuantityTypeIdentifierRestingHeartRate",
  "HKQuantityTypeIdentifierBodyMass",
  "HKQuantityTypeIdentifierOxygenSaturation",
  "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  "HKQuantityTypeIdentifierStepCount",
  "HKCorrelationTypeIdentifierBloodPressure",
] as const;

/** Same list as READ_PERMISSIONS, typed for the background-delivery/observer
 * APIs (SampleTypeIdentifier), which is everything above except it excludes
 * nothing here — all seven quantity types plus the BP correlation are valid
 * observer-query targets. Kept as its own constant rather than re-deriving
 * it, since the two APIs want slightly different TypeScript shapes. */
const BACKGROUND_TYPES = READ_PERMISSIONS;

/** HealthKit's molar-mass unit string for blood glucose in mmol/L — the
 * package dropped the BloodGlucoseUnit enum in v14, this literal is the
 * direct replacement for what was BloodGlucoseUnit.GlucoseMmolPerL. */
const GLUCOSE_MMOL_PER_L_UNIT = "mmol<180.15588000005408>/l";

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
  const healthkit = loadHealthkit();
  if (!healthkit) return false;
  try {
    return await healthkit.isHealthDataAvailable();
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
  const healthkit = loadHealthkit();
  if (!healthkit) return false;
  try {
    return await healthkit.requestAuthorization({ toRead: READ_PERMISSIONS });
  } catch {
    return false;
  }
}

/**
 * Registers this app's HealthKit background observers natively
 * (`BackgroundDeliveryManager`, via the `background: true` config plugin
 * option in app.json) and calls Apple's own `enableBackgroundDelivery` for
 * every type read here. This is real — it genuinely wakes the app process
 * when HealthKit data changes, per Apple's documented behaviour.
 *
 * What it does NOT do, as of @kingstinct/react-native-healthkit 14.0.2: wire
 * that native wake to a JS callback. The library's own
 * BackgroundDeliveryManager.swift defines `setCallback`/`drainPendingEvents`
 * for exactly that purpose, but nothing in the package's exposed Nitro spec
 * ever calls them — confirmed by reading the vendored ios/CoreModule.swift,
 * whose `subscribeToObserverQuery` (what `subscribeToChanges` below calls)
 * creates its own independent, JS-runtime-only HKObserverQuery rather than
 * draining BackgroundDeliveryManager's queue. So this call is a real,
 * worthwhile signal to iOS (background delivery only fires while the mode
 * is registered, and it's a general precondition for iOS granting the app
 * background execution at all) but it is not, on its own, a way to run
 * `syncAppleHealth()` on a cold background launch — `background-sync.ts`'s
 * periodic expo-background-task is what actually does that on both
 * platforms. See `subscribeToIOSHealthChanges` below for the mechanism that
 * genuinely does call back into JS, and its own narrower scope.
 */
export async function configureIOSBackgroundDelivery(): Promise<void> {
  if (!isHealthKitPlatform()) return;
  // loadHealthkit() is inside the try as well: binding the native module is
  // itself the throwing step in Expo Go, and leaving it outside is what let
  // that error escape as an unhandled rejection.
  try {
    const healthkit = loadHealthkit();
    if (!healthkit) return;
    await healthkit.configureBackgroundTypes([...BACKGROUND_TYPES], healthkit.UpdateFrequency.immediate);
  } catch {
    // Best-effort: a patient who never finishes the permission sheet, or an
    // iOS version quirk, should not block the rest of the app.
  }
}

/**
 * The one genuinely-wired live-callback path in this library version:
 * `subscribeToChanges` creates a per-type HKObserverQuery scoped to the
 * current JS runtime and fires `onChange` whenever a value of that type is
 * written, for as long as the app's JS is alive (foreground, or the brief
 * window iOS gives an app after backgrounding before suspending it). It
 * does not survive a cold background launch — see the caveat on
 * `configureIOSBackgroundDelivery` above. Call once at app startup after
 * permissions are granted; the returned function tears every subscription
 * down.
 */
export function subscribeToIOSHealthChanges(onChange: () => void): () => void {
  if (!isHealthKitPlatform()) return () => {};
  // Same reasoning as configureIOSBackgroundDelivery: the module load is the
  // step that throws when the native binary is absent, so it belongs inside
  // the guard rather than in front of it.
  let healthkit: ReturnType<typeof loadHealthkit>;
  try {
    healthkit = loadHealthkit();
  } catch {
    return () => {};
  }
  if (!healthkit) return () => {};
  const hk = healthkit;

  const subscriptions = BACKGROUND_TYPES.map((identifier) => {
    try {
      return hk.subscribeToChanges(identifier, () => onChange());
    } catch {
      return null;
    }
  });

  return () => {
    for (const subscription of subscriptions) {
      subscription?.remove();
    }
  };
}

export async function readHealthSamples(since: Date, until: Date): Promise<HealthSample[]> {
  if (!(await isHealthKitAvailable())) return [];

  // Each reader is independent and self-contained: one denied permission or
  // one unavailable type must not cost the sync every other metric.
  const groups = await Promise.all([
    readBloodPressure(since, until),
    readQuantity(
      "glucose",
      "HKQuantityTypeIdentifierBloodGlucose",
      GLUCOSE_MMOL_PER_L_UNIT,
      "mmol/L",
      since,
      until
    ),
    readQuantity(
      "resting_heart_rate",
      "HKQuantityTypeIdentifierRestingHeartRate",
      "count/min",
      "bpm",
      since,
      until
    ),
    readQuantity("weight", "HKQuantityTypeIdentifierBodyMass", "kg", "kg", since, until),
    readOxygenSaturation(since, until),
    readQuantity(
      "hrv_ms",
      "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
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
  const healthkit = loadHealthkit();
  if (!healthkit) return [];
  try {
    const correlations = await healthkit.queryCorrelationSamples(
      "HKCorrelationTypeIdentifierBloodPressure",
      {
        filter: { date: { startDate: since, endDate: until } },
        limit: PER_TYPE_LIMIT,
      }
    );

    const samples: HealthSample[] = [];
    for (const correlation of correlations) {
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
        if (object.quantityType === "HKQuantityTypeIdentifierBloodPressureSystolic") {
          systolic = object.quantity;
          systolicUuid = object.uuid;
        }
        if (object.quantityType === "HKQuantityTypeIdentifierBloodPressureDiastolic") {
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
    "HKQuantityTypeIdentifierOxygenSaturation",
    "%",
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
  identifier: string,
  healthKitUnit: string,
  reportedUnit: string,
  since: Date,
  until: Date
): Promise<HealthSample[]> {
  const healthkit = loadHealthkit();
  if (!healthkit) return [];
  try {
    const samples = await healthkit.queryQuantitySamples(
      // The library's identifier/unit types are narrowed per call; every
      // site above passes the unit that identifier actually accepts.
      identifier as Parameters<typeof healthkit.queryQuantitySamples>[0],
      {
        filter: { date: { startDate: since, endDate: until } },
        limit: PER_TYPE_LIMIT,
        ascending: true,
        unit: healthKitUnit,
      } as Parameters<typeof healthkit.queryQuantitySamples>[1]
    );

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
  const healthkit = loadHealthkit();
  if (!healthkit) return [];
  try {
    const anchor = startOfDay(since);
    const buckets = await healthkit.queryStatisticsCollectionForQuantity(
      "HKQuantityTypeIdentifierStepCount",
      ["cumulativeSum", "mostRecent"],
      anchor,
      { day: 1 },
      { filter: { date: { startDate: since, endDate: until } }, unit: "count" }
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

function isQuantitySample(value: unknown): value is QuantitySample {
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
