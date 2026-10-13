import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { bytesToHex } from "./store-rules";

/**
 * The encryption key for the on-device database (S06x, decision D1). 256 random bits, made on first
 * run and kept only in the OS keychain/keystore: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY on iOS (not WHEN_UNLOCKED: the
 * background sync task runs while the phone is locked and must be able to open the store), so the key is
 * neither included in an iCloud backup nor restored onto another phone. On Android the key is wrapped by
 * a hardware-backed Keystore key that a backup restore cannot recreate, so a restored copy of the app
 * data has a database it cannot open: that is the "key lost" path in secure-db.ts, not a leak.
 *
 * The key never goes to the server, never to a log, never to AsyncStorage.
 */
const KEY_NAME = "tarragon.offline.store.key.v1";
const DEVICE_ID_PREFIX = "tarragon.offline.device.id.v1.";

const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export class StoreKeyUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`The device keystore could not be used: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "StoreKeyUnavailableError";
  }
}

export interface StoreKey {
  hex: string;
  /** True when this call made the key (first run, or the key had been lost). */
  created: boolean;
}

export async function getOrCreateStoreKey(): Promise<StoreKey> {
  try {
    const existing = await SecureStore.getItemAsync(KEY_NAME, OPTIONS);
    if (existing && /^[0-9a-f]{64}$/.test(existing)) return { hex: existing, created: false };
    const hex = bytesToHex(Crypto.getRandomBytes(32));
    await SecureStore.setItemAsync(KEY_NAME, hex, OPTIONS);
    // Read back: a keystore that accepts a write and then returns nothing would encrypt data nobody can open.
    const check = await SecureStore.getItemAsync(KEY_NAME, OPTIONS);
    if (check !== hex) throw new Error("the key could not be read back after saving");
    return { hex, created: true };
  } catch (error) {
    throw new StoreKeyUnavailableError(error);
  }
}

export async function deleteStoreKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_NAME, OPTIONS);
}

/**
 * Stable per-install, per-account id the server uses to find this phone for a lost-phone wipe. Not a
 * hardware id. One per account so a second account on a shared phone gets its own lease row instead of
 * colliding with the first (the server refuses a device id that belongs to another account).
 */
function deviceIdName(userId: string): string {
  return `${DEVICE_ID_PREFIX}${userId.replace(/[^A-Za-z0-9._-]/g, "")}`;
}

/**
 * The keystore cannot list its keys, so the accounts that have a device id on this phone are listed here (ids and
 * account ids only, no health value). It is what lets a wipe find and reset EVERY account's id, signed in or not.
 */
const DEVICE_REGISTRY_KEY = "@tarragon/device-accounts/v1";

async function readRegistry(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(DEVICE_REGISTRY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function getOrCreateDeviceId(userId: string): Promise<string> {
  const name = deviceIdName(userId);
  const existing = await SecureStore.getItemAsync(name, OPTIONS);
  const id = existing ?? Crypto.randomUUID();
  if (!existing) await SecureStore.setItemAsync(name, id, OPTIONS);
  const registry = await readRegistry();
  if (registry[userId] !== id) await AsyncStorage.setItem(DEVICE_REGISTRY_KEY, JSON.stringify({ ...registry, [userId]: id })).catch(() => {});
  return id;
}

/**
 * Removes the device id of EVERY account known on this phone and returns what was removed, so the wipe can still
 * tell the server about each one. Works with nobody signed in.
 */
export async function forgetAllDeviceIds(): Promise<{ userId: string; deviceId: string }[]> {
  const registry = await readRegistry();
  const removed: { userId: string; deviceId: string }[] = [];
  for (const [userId, deviceId] of Object.entries(registry)) {
    await SecureStore.deleteItemAsync(deviceIdName(userId), OPTIONS).catch(() => {});
    removed.push({ userId, deviceId });
  }
  await AsyncStorage.removeItem(DEVICE_REGISTRY_KEY).catch(() => {});
  return removed;
}

/** Test and tooling hook: the account ids that have a device id on this phone. */
export async function listDeviceAccounts(): Promise<Record<string, string>> {
  return readRegistry();
}
