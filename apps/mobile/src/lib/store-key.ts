import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { bytesToHex } from "./store-rules";

/**
 * The encryption key for the on-device database (S06x, decision D1). 256 random bits, made on first
 * run and kept only in the OS keychain/keystore: WHEN_UNLOCKED_THIS_DEVICE_ONLY on iOS, so the key is
 * neither included in an iCloud backup nor restored onto another phone. On Android the key is wrapped by
 * a hardware-backed Keystore key that a backup restore cannot recreate, so a restored copy of the app
 * data has a database it cannot open: that is the "key lost" path in secure-db.ts, not a leak.
 *
 * The key never goes to the server, never to a log, never to AsyncStorage.
 */
const KEY_NAME = "tarragon.offline.store.key.v1";
const DEVICE_ID_PREFIX = "tarragon.offline.device.id.v1.";

const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

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

export async function getOrCreateDeviceId(userId: string): Promise<string> {
  const name = deviceIdName(userId);
  const existing = await SecureStore.getItemAsync(name, OPTIONS);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await SecureStore.setItemAsync(name, id, OPTIONS);
  return id;
}

export async function resetDeviceId(userId: string): Promise<void> {
  if (!userId) return;
  await SecureStore.deleteItemAsync(deviceIdName(userId), OPTIONS);
}
