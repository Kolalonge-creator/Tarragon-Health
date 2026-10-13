import AsyncStorage from "@react-native-async-storage/async-storage";
import type { WipeReason } from "./store-rules";

/**
 * Things the patient must be told about the on-device store (S06x): a lost key, a wipe, a copy that
 * was held back, a store that could not be encrypted. They live in AsyncStorage on purpose: the
 * notice must still be there after the database it is about has been wiped or cannot be opened, and
 * it holds no health value (only a code, a time, a reason and a count).
 */
export type StoreNotice =
  | { id: string; kind: "key_lost"; code: string; at: string }
  | { id: string; kind: "wiped"; reason: WipeReason; at: string; unsent: number; days?: number }
  | { id: string; kind: "migration_held"; code: string; at: string }
  | { id: string; kind: "not_encrypted"; why: "keystore" | "sqlcipher"; at: string };

export type NewStoreNotice =
  | { kind: "key_lost"; code: string }
  | { kind: "wiped"; reason: WipeReason; unsent: number; days?: number }
  | { kind: "migration_held"; code: string }
  | { kind: "not_encrypted"; why: "keystore" | "sqlcipher" };

const KEY = "@tarragon/store-notices/v1";
const MAX = 6;

function isNotice(v: unknown): v is StoreNotice {
  const n = v as Partial<StoreNotice> | null;
  return !!n && typeof n.id === "string" && typeof n.kind === "string" && typeof n.at === "string";
}

export async function listStoreNotices(): Promise<StoreNotice[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isNotice) : [];
  } catch {
    return [];
  }
}

/** Best effort and idempotent per kind+code: a notice that is already shown is not added again. Never throws. */
export async function addStoreNotice(notice: NewStoreNotice, now: Date = new Date()): Promise<void> {
  try {
    const current = await listStoreNotices();
    const code = "code" in notice ? notice.code : null;
    // A wipe that is retried (a file would not delete) must not stack notices: the same reason within ten minutes is one.
    if (
      notice.kind === "wiped" &&
      current.some((n) => n.kind === "wiped" && n.reason === notice.reason && now.getTime() - new Date(n.at).getTime() < 10 * 60_000)
    ) {
      return;
    }
    if (current.some((n) => n.kind === notice.kind && ("code" in n ? n.code : null) === code && notice.kind !== "wiped")) return;
    const next: StoreNotice = { ...notice, id: `${now.getTime()}-${current.length}`, at: now.toISOString() } as StoreNotice;
    await AsyncStorage.setItem(KEY, JSON.stringify([...current, next].slice(-MAX)));
  } catch {
    // A notice that cannot be saved must not break the store.
  }
}

export async function dismissStoreNotice(id: string): Promise<void> {
  try {
    const current = await listStoreNotices();
    await AsyncStorage.setItem(KEY, JSON.stringify(current.filter((n) => n.id !== id)));
  } catch {
    // keep showing it
  }
}
