/**
 * Minimal in-memory stand-in for expo-secure-store (OS keychain/keystore).
 * Only the three methods this app actually calls — see supabase.ts,
 * threshold-sync.ts and emergency.ts.
 */
const store = new Map<string, string>();

export async function getItemAsync(key: string): Promise<string | null> {
  return store.has(key) ? (store.get(key) as string) : null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}

export function __reset(): void {
  store.clear();
}
