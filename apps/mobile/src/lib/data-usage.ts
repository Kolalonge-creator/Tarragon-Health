import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * A small meter of how much mobile data the app's own syncing used this month (S06x), so a patient on
 * a metered plan can see the cost of staying in sync. It counts what the sync code sends and receives
 * (payload sizes it already measures, plus a small fixed estimate per connectivity check); it is an
 * estimate, not the operating system's figure, and is labelled that way where shown.
 */
const PREFIX = "@tarragon/data-usage/";

export function monthKey(now: Date): string {
  return `${PREFIX}${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

let chain: Promise<void> = Promise.resolve();

/** Adds bytes to this month's total. Serialised so concurrent syncs do not lose counts. Never throws. */
export function addDataUsage(bytes: number, now: Date = new Date()): Promise<void> {
  if (!Number.isFinite(bytes) || bytes <= 0) return Promise.resolve();
  chain = chain.then(async () => {
    try {
      const key = monthKey(now);
      const raw = await AsyncStorage.getItem(key);
      const total = (raw ? Number(raw) : 0) || 0;
      await AsyncStorage.setItem(key, String(Math.round(total + bytes)));
    } catch {
      // a meter that cannot count must never get in the way of syncing
    }
  });
  return chain;
}

export async function getMonthlyDataUsage(now: Date = new Date()): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(monthKey(now));
    return (raw ? Number(raw) : 0) || 0;
  } catch {
    return 0;
  }
}

/** "1.2 MB", "340 KB", "0 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(bytes / 1000)} KB`;
}
