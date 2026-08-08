import { getHealthSyncCursor, postHealthSamples } from "./api";
import {
  INITIAL_WINDOW_DAYS,
  isHealthKitAvailable,
  readHealthSamples,
  requestHealthKitPermissions,
  type HealthSample,
} from "./healthkit";

/**
 * One Apple Health sync: ask where we got to, read that delta from HealthKit,
 * upload it. Deliberately patient-initiated rather than a background job —
 * the app requests no background-delivery entitlement (see app.json), so a
 * sync only ever happens because someone tapped the button and can see the
 * result.
 */

/** The upload route accepts 500 samples per request; a smaller page keeps a
 * poor connection from losing a large batch wholesale, and every page is
 * independently deduped server-side so a retry is free. */
const UPLOAD_PAGE_SIZE = 200;

export type HealthSyncResult =
  | { status: "unavailable" }
  | { status: "no_new_data" }
  | { status: "error"; message: string }
  | { status: "synced"; vitals: number; wearable: number; total: number };

export async function syncAppleHealth(): Promise<HealthSyncResult> {
  if (!(await isHealthKitAvailable())) return { status: "unavailable" };

  // Safe to call on every sync: iOS shows the sheet only for types the
  // patient has not already answered for.
  await requestHealthKitPermissions();

  const cursor = await getHealthSyncCursor();
  if (cursor === null) {
    return { status: "error", message: "Couldn't reach the server. Check your connection." };
  }

  const until = new Date();
  const since = cursor.cursor
    ? new Date(cursor.cursor)
    : new Date(until.getTime() - INITIAL_WINDOW_DAYS * 24 * 3600_000);
  if (Number.isNaN(since.getTime())) {
    return { status: "error", message: "Couldn't work out where the last sync finished." };
  }

  const samples = await readHealthSamples(since, until);
  if (samples.length === 0) return { status: "no_new_data" };

  let vitals = 0;
  let wearable = 0;
  for (const page of paginate(samples, UPLOAD_PAGE_SIZE)) {
    const result = await postHealthSamples(page);
    if (!result.ok) return { status: "error", message: result.error };
    vitals += result.data.vitals_inserted;
    wearable += result.data.wearable_inserted;
  }

  return { status: "synced", vitals, wearable, total: samples.length };
}

function paginate<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages;
}

export type { HealthSample };
