import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * "Sync on Wi-Fi only" (S06z): a choice the patient makes on this phone. Saved per phone, not per account
 * and never sent anywhere. Only a literal "true" turns it on, so a missing, corrupt or unreadable value
 * leaves normal syncing in place rather than silently holding a patient's entries.
 *
 * It holds back only ordinary readings, dose logs and the background read. Urgent and danger-flagged
 * entries are never affected (data-cost-rules.ts).
 */
export const WIFI_ONLY_KEY = "@tarragon/wifi-only/v1";

let cached: boolean | null = null;

export async function readWifiOnly(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    cached = (await AsyncStorage.getItem(WIFI_ONLY_KEY)) === "true";
    return cached;
  } catch {
    // Not cached: a later read may succeed. Meanwhile the safe answer is "send".
    return false;
  }
}

export async function writeWifiOnly(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(WIFI_ONLY_KEY, String(enabled));
  cached = enabled;
}

/** Test seam. */
export function __resetWifiOnlyForTests(): void {
  cached = null;
}
