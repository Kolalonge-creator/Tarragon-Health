/**
 * In-memory stand-in for @react-native-async-storage/async-storage, backing
 * offline-queue.ts's two persisted queues. `failNextSet` exists so a test
 * can exercise the "could not be sent AND could not be queued" path
 * sync-screen.tsx is honest with the patient about.
 */
const store = new Map<string, string>();
let failNextSet = false;

export async function getItem(key: string): Promise<string | null> {
  return store.has(key) ? (store.get(key) as string) : null;
}

export async function setItem(key: string, value: string): Promise<void> {
  if (failNextSet) {
    failNextSet = false;
    throw new Error("Storage full");
  }
  store.set(key, value);
}

export async function removeItem(key: string): Promise<void> {
  store.delete(key);
}

export function __failNextSet(): void {
  failNextSet = true;
}

/** Write a raw value, to simulate a corrupted or hand-edited queue file. */
export function __seedRaw(key: string, raw: string): void {
  store.set(key, raw);
}

export function __reset(): void {
  store.clear();
  failNextSet = false;
}

export default { getItem, setItem, removeItem };
