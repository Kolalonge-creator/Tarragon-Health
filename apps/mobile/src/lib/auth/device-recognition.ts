import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

/**
 * Mobile half of new-device sign-in recognition (web: record-login-device.ts).
 * The fingerprint is a SHA-256 of a random per-install id kept in SecureStore,
 * never a hardware id. Best effort: a failure here must never block sign-in.
 */
export const DEVICE_ID_KEY = "device-install-id-v1";

export interface RpcApi {
  rpc(
    fn: "record_login_device",
    args: { p_device_fingerprint: string; p_user_agent: string; p_ip: string },
  ): PromiseLike<{ error: { message: string } | null }>;
}

async function getInstallId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const fresh = Crypto.randomUUID();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, fresh);
  return fresh;
}

export async function deviceFingerprint(): Promise<string> {
  const id = await getInstallId();
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `tarragon-device-v1:${id}`);
}

export function mobileUserAgent(): string {
  return `TarragonHealth-mobile/${Platform.OS}`;
}

/** Returns true when recorded, false when it failed (never throws). */
export async function recordLoginDevice(client: RpcApi): Promise<boolean> {
  try {
    const { error } = await client.rpc("record_login_device", {
      p_device_fingerprint: await deviceFingerprint(),
      p_user_agent: mobileUserAgent(),
      // The app cannot see its own public IP; web uses the same "unknown".
      p_ip: "unknown",
    });
    return !error;
  } catch {
    return false;
  }
}
