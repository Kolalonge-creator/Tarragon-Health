import * as SecureStore from "expo-secure-store";
import { setLowDataActive } from "./offline-budget";

/** Key shared by the Settings toggle and the app start-up read. */
export const LOW_DATA_KEY = "settings-low-data-v1";

/**
 * Only a literal "true" turns it on: a missing, corrupt or unreadable value
 * leaves normal sync in place rather than silently thinning a patient's data.
 */
export async function readLowDataEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(LOW_DATA_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function writeLowDataEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(LOW_DATA_KEY, String(enabled));
  setLowDataActive(enabled);
  // A later ensureLowDataLoaded() must not re-read and undo this.
  loaded = Promise.resolve();
}

/** Reads the saved choice into the active budget. */
export async function loadLowDataPreference(): Promise<void> {
  setLowDataActive(await readLowDataEnabled());
}

let loaded: Promise<void> | null = null;

/**
 * Resolves once the saved choice has been applied, reading it only once per
 * process. The pull code awaits this, so a first sync after a cold start can
 * never run with the normal budget just because the read had not finished.
 */
export function ensureLowDataLoaded(): Promise<void> {
  loaded ??= loadLowDataPreference();
  return loaded;
}

/** Test seam: forget that the preference was loaded so the next ensure re-reads it. */
export function resetLowDataLoadedForTests(): void {
  loaded = null;
}
