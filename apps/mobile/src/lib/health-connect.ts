import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import type * as HealthConnectPackage from "react-native-health-connect";
import type { HealthReadingType, HealthReadResult, HealthSample } from "./healthkit";
import { recordSyncError } from "./sync-diagnostics";

/**
 * Loaded lazily via require(), never as a static top-level import — same
 * reasoning as healthkit.ts's own `loadHealthkit()`. react-native-health-
 * connect's native module is fetched via
 * `TurboModuleRegistry.getEnforcing('HealthConnect')` (its
 * src/NativeHealthConnect.ts), which throws synchronously at import time
 * when the native module isn't linked — true in Expo Go and before a real
 * EAS/prebuild native binary exists, the identical failure mode
 * healthkit.ts already hit and fixed for Nitro Modules (see that file's own
 * comment). Deferring the require() to first use, inside try/catch,
 * contains the failure the same way.
 */
let cachedModule: typeof HealthConnectPackage | null | undefined;

/**
 * Skipped outright in Expo Go, same as healthkit.ts. TurboModuleRegistry's
 * `getEnforcing` does throw synchronously and so is genuinely caught by the
 * try/catch below — unlike Nitro's, which is not — but not requiring the
 * module at all is both cheaper and immune to that distinction changing
 * under a library upgrade.
 */
const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

function loadHealthConnect(): typeof HealthConnectPackage | null {
  if (cachedModule !== undefined) return cachedModule;
  if (IS_EXPO_GO) {
    cachedModule = null;
    return cachedModule;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require("react-native-health-connect") as typeof HealthConnectPackage;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

/**
 * Android Health Connect bridge — the Android peer of healthkit.ts.
 *
 * Per CLAUDE.md's Device & Wearable Integration section, this is the same
 * ingestion-boundary shape as HealthKit: the platform's own health store is
 * device-local, so the phone reads it and uploads to the same
 * `/api/mobile/health-samples` route (now provider-aware — see api.ts),
 * rather than a server-side OAuth redirect.
 *
 * Every field mapping below was ground-truthed against the installed
 * react-native-health-connect@3.6.0 source
 * (node_modules/react-native-health-connect/src/types/*.ts) — the exact
 * `Result`-shaped return types (e.g. `BloodPressureRecordResult.systolic:
 * PressureResult` = `{inMillimetersOfMercury: number}`), not assumed from
 * the package's own docs site, which describes an older version. It has
 * never run against a real Health Connect payload on a real device — see
 * the same caveat CLAUDE.md already carries for the cloud wearable
 * adapters ("field mappings are the seam to correct on first real
 * payload").
 *
 * Read-only, always: this app never writes to Health Connect. Unlike
 * HealthKit, Android does not hide which permissions were denied — a
 * denied type simply isn't included in getGrantedPermissions()'s result —
 * but this bridge still treats "no samples for a type" as a normal outcome
 * rather than an error, since a type can also be legitimately empty.
 *
 * HRV caveat: HealthKit reports SDNN; Health Connect's
 * HeartRateVariabilityRmssdRecord reports RMSSD — a different algorithm.
 * Both land in the same `hrv_ms` reading_type with the same "ms" unit
 * label because the schema has no room for a per-algorithm split, but a
 * patient's HRV trend is not directly comparable across an iOS-to-Android
 * device switch. Same class of caveat this codebase already documents for
 * WHOOP/Garmin field mappings.
 */

const RECORD_TYPES = [
  "Steps",
  "BloodPressure",
  "BloodGlucose",
  "Weight",
  "OxygenSaturation",
  "HeartRateVariabilityRmssd",
  "RestingHeartRate",
] as const;

/** Same ceiling as healthkit.ts's PER_TYPE_LIMIT, same reasoning: bounds one
 * sync's read of a single type. */
const PER_TYPE_LIMIT = 200;

/** Mirrors healthkit.ts's own internal ReaderResult — see its doc comment.
 * `truncatedType` is judged on the raw readRecords row count hitting
 * PER_TYPE_LIMIT, and stays null on a failed read. */
interface ReaderResult {
  samples: HealthSample[];
  truncatedType: HealthReadingType | null;
}

/** Mirrors healthkit.ts's INITIAL_WINDOW_DAYS exactly — kept as a separate
 * export rather than importing theirs so the two bridges stay decoupled. */
export const INITIAL_WINDOW_DAYS = 30;

export function isHealthConnectPlatform(): boolean {
  return Platform.OS === "android";
}

export async function isHealthConnectAvailable(): Promise<boolean> {
  if (!isHealthConnectPlatform()) return false;
  const hc = loadHealthConnect();
  if (!hc) return false;
  try {
    const status = await hc.getSdkStatus();
    if (status !== hc.SdkAvailabilityStatus.SDK_AVAILABLE) return false;
    return await hc.initialize();
  } catch (error) {
    recordSyncError("android_health_connect", "getSdkStatus/initialize", error);
    return false;
  }
}

/**
 * Requests every read permission this bridge uses, plus the two special
 * permissions background sync needs: BackgroundAccessPermission (read
 * without the app in the foreground — see background-sync.ts) and
 * ReadHealthDataHistory (Health Connect otherwise restricts a new grant to
 * roughly the last 30 days going forward only, which would silently
 * shrink INITIAL_WINDOW_DAYS's first-sync window). Health Connect shows
 * its own permission screen; unlike HealthKit it does not hide which of
 * these were actually granted — getGrantedPermissions() after this call
 * tells the truth.
 */
export async function requestHealthConnectPermissions(): Promise<boolean> {
  if (!isHealthConnectPlatform()) return false;
  const hc = loadHealthConnect();
  if (!hc) return false;
  try {
    const granted = await hc.requestPermission([
      ...RECORD_TYPES.map((recordType) => ({ accessType: "read" as const, recordType })),
      { accessType: "read", recordType: "ReadHealthDataHistory" },
      { accessType: "read", recordType: "BackgroundAccessPermission" },
    ]);
    return granted.length > 0;
  } catch (error) {
    recordSyncError("android_health_connect", "requestPermission", error);
    return false;
  }
}

export async function readHealthConnectSamples(since: Date, until: Date): Promise<HealthReadResult> {
  if (!(await isHealthConnectAvailable())) return { samples: [], truncatedTypes: [] };
  const hc = loadHealthConnect();
  if (!hc) return { samples: [], truncatedTypes: [] };

  // Each reader is independent and self-contained, same rationale as
  // healthkit.ts's readHealthSamples: one denied permission or one
  // unavailable type must not cost the sync every other metric.
  const groups = await Promise.all([
    readDailySteps(hc, since, until),
    readBloodPressure(hc, since, until),
    readBloodGlucose(hc, since, until),
    readWeight(hc, since, until),
    readOxygenSaturation(hc, since, until),
    readHeartRateVariability(hc, since, until),
    readRestingHeartRate(hc, since, until),
  ]);

  return {
    samples: groups.flatMap((group) => group.samples),
    truncatedTypes: groups
      .map((group) => group.truncatedType)
      .filter((readingType): readingType is HealthReadingType => readingType !== null),
  };
}

function timeRangeFilter(since: Date, until: Date) {
  return {
    operator: "between" as const,
    startTime: since.toISOString(),
    endTime: until.toISOString(),
  };
}

function externalId(recordId: string | undefined, fallback: string): string {
  return recordId ?? fallback;
}

/**
 * Steps, read as a daily aggregate rather than raw records — the direct
 * Health Connect analogue of healthkit.ts's readDailySteps and for the
 * same reason: a raw readRecords('Steps', ...) call returns one StepsRecord
 * per contributing app (phone pedometer, a paired watch app, etc.), and
 * summing those directly would double-count a walk two sources both
 * logged. aggregateGroupByPeriod is Health Connect's own priority-based
 * dedupe across sources — the API built for exactly this.
 */
async function readDailySteps(
  hc: typeof HealthConnectPackage,
  since: Date,
  until: Date
): Promise<ReaderResult> {
  try {
    const buckets = await hc.aggregateGroupByPeriod({
      recordType: "Steps",
      timeRangeFilter: timeRangeFilter(since, until),
      timeRangeSlicer: { period: "DAYS", length: 1 },
    });

    const samples: HealthSample[] = [];
    for (const bucket of buckets) {
      const total = bucket.result.COUNT_TOTAL;
      if (typeof total !== "number" || total <= 0) continue;
      samples.push({
        reading_type: "steps",
        value: Math.round(total),
        unit: "steps",
        recorded_at: bucket.startTime,
        // One step total per calendar day, matching healthkit.ts's own
        // `steps:<date>` dedupe key — a later re-sync of the same day
        // legitimately replaces nothing.
        external_reading_id: `steps:${bucket.startTime.slice(0, 10)}`,
      });
    }
    // One bucket per day of the window, no row cap — same as healthkit.ts's
    // readDailySteps, this reader can never leave data behind.
    return { samples, truncatedType: null };
  } catch (error) {
    recordSyncError("android_health_connect", "steps", error);
    return { samples: [], truncatedType: null };
  }
}

/**
 * Blood pressure. Health Connect models it as one BloodPressureRecord with
 * both systolic and diastolic on it (unlike HealthKit's two-samples-in-a-
 * correlation shape) — no pairing step needed here.
 */
async function readBloodPressure(
  hc: typeof HealthConnectPackage,
  since: Date,
  until: Date
): Promise<ReaderResult> {
  try {
    const { records } = await hc.readRecords("BloodPressure", {
      timeRangeFilter: timeRangeFilter(since, until),
      ascendingOrder: true,
      pageSize: PER_TYPE_LIMIT,
    });

    return {
      samples: records.map((record) => ({
        reading_type: "blood_pressure" as const,
        value: Math.round(record.systolic.inMillimetersOfMercury),
        secondary_value: Math.round(record.diastolic.inMillimetersOfMercury),
        unit: "mmHg",
        recorded_at: record.time,
        external_reading_id: externalId(record.metadata?.id, `bp:${record.time}`),
      })),
      truncatedType: records.length === PER_TYPE_LIMIT ? "blood_pressure" : null,
    };
  } catch (error) {
    recordSyncError("android_health_connect", "blood_pressure", error);
    return { samples: [], truncatedType: null };
  }
}

/** mmol/L, matching HealthKit's own choice (healthkit.ts's
 * GLUCOSE_MMOL_PER_L_UNIT) so the two platforms' glucose readings land in
 * the same unit without a conversion step downstream. */
async function readBloodGlucose(
  hc: typeof HealthConnectPackage,
  since: Date,
  until: Date
): Promise<ReaderResult> {
  try {
    const { records } = await hc.readRecords("BloodGlucose", {
      timeRangeFilter: timeRangeFilter(since, until),
      ascendingOrder: true,
      pageSize: PER_TYPE_LIMIT,
    });

    return {
      samples: records.map((record) => ({
        reading_type: "glucose" as const,
        value: record.level.inMillimolesPerLiter,
        unit: "mmol/L",
        recorded_at: record.time,
        external_reading_id: externalId(record.metadata?.id, `glucose:${record.time}`),
      })),
      truncatedType: records.length === PER_TYPE_LIMIT ? "glucose" : null,
    };
  } catch (error) {
    recordSyncError("android_health_connect", "glucose", error);
    return { samples: [], truncatedType: null };
  }
}

async function readWeight(
  hc: typeof HealthConnectPackage,
  since: Date,
  until: Date
): Promise<ReaderResult> {
  try {
    const { records } = await hc.readRecords("Weight", {
      timeRangeFilter: timeRangeFilter(since, until),
      ascendingOrder: true,
      pageSize: PER_TYPE_LIMIT,
    });

    return {
      samples: records.map((record) => ({
        reading_type: "weight" as const,
        value: record.weight.inKilograms,
        unit: "kg",
        recorded_at: record.time,
        external_reading_id: externalId(record.metadata?.id, `weight:${record.time}`),
      })),
      truncatedType: records.length === PER_TYPE_LIMIT ? "weight" : null,
    };
  } catch (error) {
    recordSyncError("android_health_connect", "weight", error);
    return { samples: [], truncatedType: null };
  }
}

/**
 * Health Connect's OxygenSaturationRecord.percentage is already a 0-100
 * number (confirmed from the installed package's own type source) — unlike
 * HealthKit, which reports a 0.0-1.0 fraction and needs the *100 guard
 * healthkit.ts's readOxygenSaturation applies. No conversion needed here;
 * applying HealthKit's guard to Health Connect's already-0-100 value would
 * be the bug, not the fix.
 */
async function readOxygenSaturation(
  hc: typeof HealthConnectPackage,
  since: Date,
  until: Date
): Promise<ReaderResult> {
  try {
    const { records } = await hc.readRecords("OxygenSaturation", {
      timeRangeFilter: timeRangeFilter(since, until),
      ascendingOrder: true,
      pageSize: PER_TYPE_LIMIT,
    });

    return {
      samples: records.map((record) => ({
        reading_type: "spo2" as const,
        value: Math.round(record.percentage),
        unit: "%",
        recorded_at: record.time,
        external_reading_id: externalId(record.metadata?.id, `spo2:${record.time}`),
      })),
      truncatedType: records.length === PER_TYPE_LIMIT ? "spo2" : null,
    };
  } catch (error) {
    recordSyncError("android_health_connect", "spo2", error);
    return { samples: [], truncatedType: null };
  }
}

async function readHeartRateVariability(
  hc: typeof HealthConnectPackage,
  since: Date,
  until: Date
): Promise<ReaderResult> {
  try {
    const { records } = await hc.readRecords("HeartRateVariabilityRmssd", {
      timeRangeFilter: timeRangeFilter(since, until),
      ascendingOrder: true,
      pageSize: PER_TYPE_LIMIT,
    });

    return {
      samples: records.map((record) => ({
        reading_type: "hrv_ms" as const,
        value: record.heartRateVariabilityMillis,
        unit: "ms",
        recorded_at: record.time,
        external_reading_id: externalId(record.metadata?.id, `hrv:${record.time}`),
      })),
      truncatedType: records.length === PER_TYPE_LIMIT ? "hrv_ms" : null,
    };
  } catch (error) {
    recordSyncError("android_health_connect", "hrv_ms", error);
    return { samples: [], truncatedType: null };
  }
}

async function readRestingHeartRate(
  hc: typeof HealthConnectPackage,
  since: Date,
  until: Date
): Promise<ReaderResult> {
  try {
    const { records } = await hc.readRecords("RestingHeartRate", {
      timeRangeFilter: timeRangeFilter(since, until),
      ascendingOrder: true,
      pageSize: PER_TYPE_LIMIT,
    });

    return {
      samples: records.map((record) => ({
        reading_type: "resting_heart_rate" as const,
        value: record.beatsPerMinute,
        unit: "bpm",
        recorded_at: record.time,
        external_reading_id: externalId(record.metadata?.id, `rhr:${record.time}`),
      })),
      truncatedType: records.length === PER_TYPE_LIMIT ? "resting_heart_rate" : null,
    };
  } catch (error) {
    recordSyncError("android_health_connect", "resting_heart_rate", error);
    return { samples: [], truncatedType: null };
  }
}
