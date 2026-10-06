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
}

/** Call once at start-up so the first sync already honours the saved choice. */
export async function loadLowDataPreference(): Promise<void> {
  setLowDataActive(await readLowDataEnabled());
}
