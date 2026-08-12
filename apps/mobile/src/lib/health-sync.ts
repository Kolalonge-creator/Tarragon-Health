import { getHealthSyncCursor, postHealthSamples } from "./api";
import { countSyncErrorsSince } from "./sync-diagnostics";
import {
  INITIAL_WINDOW_DAYS as HEALTHKIT_INITIAL_WINDOW_DAYS,
  isHealthKitAvailable,
  readHealthSamples,
  requestHealthKitPermissions,
  type HealthSample,
} from "./healthkit";
import {
  INITIAL_WINDOW_DAYS as HEALTH_CONNECT_INITIAL_WINDOW_DAYS,
  isHealthConnectAvailable,
  readHealthConnectSamples,
  requestHealthConnectPermissions,
} from "./health-connect";

/**
 * One health-store sync, shared by both platforms: ask the server where
 * this provider's connection got to, read that delta from the platform's
 * own health store, upload it. `syncAppleHealth`/`syncHealthConnect` are
 * thin platform-specific entry points over one shared implementation, so
 * the cursor-fetch -> read-delta -> paginate-upload logic can't drift
 * between the two.
 *
 * Called from three places: the manual "Sync" button on each Devices-tab
 * card (apple-health-card.tsx / android-health-connect-card.tsx), the live
 * HealthKit change listener while the app is running
 * (background-sync.ts's use of healthkit.ts's subscribeToIOSHealthChanges),
 * and the periodic background task both platforms register
 * (background-sync.ts) — that last one is the only mechanism that runs
 * when the app isn't already open; see its own file for why.
 */

export type HealthProvider = "apple_health" | "android_health_connect";

/** The upload route accepts 500 samples per request; a smaller page keeps a
 * poor connection from losing a large batch wholesale, and every page is
 * independently deduped server-side so a retry is free. */
const UPLOAD_PAGE_SIZE = 200;

export type HealthSyncResult =
  | { status: "unavailable" }
  | { status: "no_new_data"; partial?: boolean }
  | { status: "error"; message: string }
  | { status: "synced"; vitals: number; wearable: number; total: number; partial?: boolean };

export async function syncAppleHealth(): Promise<HealthSyncResult> {
  if (!(await isHealthKitAvailable())) return { status: "unavailable" };
  // Safe to call on every sync: iOS shows the sheet only for types the
  // patient has not already answered for.
  await requestHealthKitPermissions();
  return syncHealthReadings("apple_health", HEALTHKIT_INITIAL_WINDOW_DAYS, readHealthSamples);
}

export async function syncHealthConnect(): Promise<HealthSyncResult> {
  if (!(await isHealthConnectAvailable())) return { status: "unavailable" };
  // Safe to call on every sync: Health Connect's own permission screen only
  // prompts for types not already answered.
  await requestHealthConnectPermissions();
  return syncHealthReadings(
    "android_health_connect",
    HEALTH_CONNECT_INITIAL_WINDOW_DAYS,
    readHealthConnectSamples
  );
}

async function syncHealthReadings(
  provider: HealthProvider,
  initialWindowDays: number,
  readSamples: (since: Date, until: Date) => Promise<HealthSample[]>
): Promise<HealthSyncResult> {
  const cursor = await getHealthSyncCursor(provider);
  if (cursor === null) {
    return { status: "error", message: "Couldn't reach the server. Check your connection." };
  }

  const until = new Date();
  const since = cursor.cursor
    ? new Date(cursor.cursor)
    : new Date(until.getTime() - initialWindowDays * 24 * 3600_000);
  if (Number.isNaN(since.getTime())) {
    return { status: "error", message: "Couldn't work out where the last sync finished." };
  }

  // Captured before the read so countSyncErrorsSince can tell "a reader
  // failed during this attempt" apart from stale entries left over from an
  // earlier sync — readHealthSamples/readHealthConnectSamples already log
  // into sync-diagnostics per reader rather than throwing, so this is the
  // only way this function learns a read was incomplete.
  const startedAt = new Date().toISOString();
  const samples = await readSamples(since, until);
  const readerErrors = countSyncErrorsSince(provider, startedAt);

  if (samples.length === 0) {
    return readerErrors > 0 ? { status: "no_new_data", partial: true } : { status: "no_new_data" };
  }

  let vitals = 0;
  let wearable = 0;
  for (const page of paginate(samples, UPLOAD_PAGE_SIZE)) {
    const result = await postHealthSamples(page, provider);
    if (!result.ok) return { status: "error", message: result.error };
    vitals += result.data.vitals_inserted;
    wearable += result.data.wearable_inserted;
  }

  return {
    status: "synced",
    vitals,
    wearable,
    total: samples.length,
    ...(readerErrors > 0 ? { partial: true } : {}),
  };
}

function paginate<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages;
}

export type { HealthSample };
