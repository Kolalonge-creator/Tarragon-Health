/**
 * Minimal in-memory stand-in for expo-secure-store (OS keychain/keystore).
 * Only the three methods this app actually calls — see supabase.ts,
 * threshold-sync.ts and emergency.ts.
 */
const store = new Map<string, string>();

export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 6;
let failing = false;
/** Test hook: the keystore is unavailable (locked, corrupted). */
export function __setFailing(value: boolean): void {
  failing = value;
}

export async function getItemAsync(key: string): Promise<string | null> {
  if (failing) throw new Error("keystore unavailable");
  return store.has(key) ? (store.get(key) as string) : null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (failing) throw new Error("keystore unavailable");
  store.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}

export function __reset(): void {
  failing = false;
  store.clear();
}
