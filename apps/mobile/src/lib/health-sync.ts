import { getHealthSyncCursor, postHealthSamples } from "./api";
import {
  INITIAL_WINDOW_DAYS as HEALTHKIT_INITIAL_WINDOW_DAYS,
  isHealthKitAvailable,
  readHealthSamples,
  requestHealthKitPermissions,
  type HealthReadResult,
  type HealthSample,
} from "./healthkit";
import {
  INITIAL_WINDOW_DAYS as HEALTH_CONNECT_INITIAL_WINDOW_DAYS,
  isHealthConnectAvailable,
  readHealthConnectSamples,
  requestHealthConnectPermissions,
} from "./health-connect";
import { countSyncErrorsSince, recordSyncError } from "./sync-diagnostics";
import { enqueueHealthSamplesPage, flushHealthSamplesQueue } from "./offline-queue";

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
  | { status: "no_new_data"; partial?: boolean; recovered?: number }
  | { status: "error"; message: string }
  | {
      status: "synced";
      vitals: number;
      wearable: number;
      total: number;
      partial?: boolean;
      /** Samples recovered this call from a previous failed upload attempt
       * (see the offline queue flush below) — already counted in
       * `vitals`/`wearable`, called out separately so the UI can say "we
       * also caught up on N readings from earlier" rather than silently
       * folding them into today's total. */
      recovered?: number;
      /** Samples that could not be uploaded this attempt and were queued
       * instead of lost — see the upload loop below. Not counted in
       * `vitals`/`wearable`, since they have not reached the server yet. */
      queued?: number;
    };

export async function syncAppleHealth(): Promise<HealthSyncResult> {
  // Flushed unconditionally, before the availability check: a page queued on
  // a previous sync attempt deserves a retry even if HealthKit itself has
  // since become unavailable (e.g. permission revoked) — those bytes are
  // already captured and only need a network path, not HealthKit itself.
  const { flushedSamples } = await flushHealthSamplesQueue("apple_health");
  if (!(await isHealthKitAvailable())) return { status: "unavailable" };
  // Safe to call on every sync: iOS shows the sheet only for types the
  // patient has not already answered for.
  await requestHealthKitPermissions();
  return withRecovered(
    await syncHealthReadings("apple_health", HEALTHKIT_INITIAL_WINDOW_DAYS, readHealthSamples),
    flushedSamples
  );
}

export async function syncHealthConnect(): Promise<HealthSyncResult> {
  const { flushedSamples } = await flushHealthSamplesQueue("android_health_connect");
  if (!(await isHealthConnectAvailable())) return { status: "unavailable" };
  // Safe to call on every sync: Health Connect's own permission screen only
  // prompts for types not already answered.
  await requestHealthConnectPermissions();
  return withRecovered(
    await syncHealthReadings(
      "android_health_connect",
      HEALTH_CONNECT_INITIAL_WINDOW_DAYS,
      readHealthConnectSamples
    ),
    flushedSamples
  );
}

/** Merges a successful offline-queue flush into whatever this sync attempt's
 * own result was. Kept as a thin wrapper rather than threading the count
 * through syncHealthReadings itself, since the flush happens in the two
 * provider-specific entry points above (see their own comments) rather than
 * in the shared function. */
function withRecovered(result: HealthSyncResult, recovered: number): HealthSyncResult {
  if (recovered <= 0) return result;
  if (result.status === "synced" || result.status === "no_new_data") {
    return { ...result, recovered };
  }
  return result;
}

async function syncHealthReadings(
  provider: HealthProvider,
  initialWindowDays: number,
  readSamples: (since: Date, until: Date) => Promise<HealthReadResult>
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
  const { samples, truncatedTypes } = await readSamples(since, until);
  const readerErrors = countSyncErrorsSince(provider, startedAt);

  if (samples.length === 0) {
    return readerErrors > 0 ? { status: "no_new_data", partial: true } : { status: "no_new_data" };
  }

  let vitals = 0;
  let wearable = 0;
  let queued = 0;
  const pages = paginate(samples, UPLOAD_PAGE_SIZE);
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    // truncatedTypes goes on EVERY page of this read, not just the last:
    // the server clamps its shared sync cursor per request, so any page
    // missing the declaration would advance the cursor past a truncated
    // type's unsent backlog before the next page could hold it back.
    const result = await postHealthSamples(page, provider, truncatedTypes);
    if (!result.ok) {
      // This page, and every page after it, would fail the same way against
      // a connection that just dropped — no point spending a ~20s timeout
      // (api.ts's REQUEST_TIMEOUT_MS) discovering that one page at a time.
      // Queue all of them now rather than abandon them: this is the fix for
      // the gap this module used to have (see the file's own former
      // "abandons all remaining pages" behaviour, spec 55.13-55.15) — every
      // sample here is picked up by the offline queue's own flush on the
      // next sync attempt or background run, not lost.
      recordSyncError(provider, "postHealthSamples", result.error);
      for (const remaining of pages.slice(index)) {
        // The queued page keeps its truncated_types so the eventual replay
        // (offline-queue.ts's flush) makes the same cursor declaration this
        // live upload would have — see the comment on postHealthSamples above.
        await enqueueHealthSamplesPage({
          provider,
          samples: remaining,
          ...(truncatedTypes.length > 0 ? { truncated_types: truncatedTypes } : {}),
        });
        queued += remaining.length;
      }
      break;
    }
    vitals += result.data.vitals_inserted;
    wearable += result.data.wearable_inserted;
  }

  return {
    status: "synced",
    vitals,
    wearable,
    total: samples.length,
    ...(readerErrors > 0 ? { partial: true } : {}),
    ...(queued > 0 ? { queued } : {}),
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
