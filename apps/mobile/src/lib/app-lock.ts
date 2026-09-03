import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

/**
 * App Lock: the SecureStore preference the Settings screen writes and the
 * biometric gate App.tsx reads. Both sides must share this module — the
 * original bug behind it was a toggle that wrote a key nothing ever read,
 * leaving "Require Face ID / fingerprint to open the app" a false promise.
 */

/** Key shared with the Settings screen's App Lock toggle. */
export const APP_LOCK_KEY = "settings-app-lock-v1";

export async function readAppLockEnabled(): Promise<boolean> {
  try {
    // Only a literal, readable "true" turns the gate on: a missing, corrupt,
    // or unreadable value must fail open, never lock a patient out.
    return (await SecureStore.getItemAsync(APP_LOCK_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function writeAppLockEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(APP_LOCK_KEY, String(enabled));
}

export type AppLockAuthResult = "success" | "failed" | "unavailable";

/**
 * One biometric round-trip. Device-credential (passcode/PIN) fallback stays
 * enabled, matching the Settings toggle's own confirmation prompt, so a
 * patient whose face/fingerprint stops matching can still get in the way the
 * OS itself allows. "unavailable" means the device has no biometrics AND no
 * device credential left to check against (e.g. lock screen security removed
 * after App Lock was enabled) — callers must treat that as unlocked, because
 * there is nothing left to authenticate with and blocking would brick the app.
 */
export async function authenticate(
  promptMessage = "Unlock TarragonHealth"
): Promise<AppLockAuthResult> {
  let level: LocalAuthentication.SecurityLevel;
  try {
    level = await LocalAuthentication.getEnrolledLevelAsync();
  } catch {
    // Can't even query the authenticator (stripped-down emulator, missing
    // native module): same fail-open contract as an unenrolled device.
    return "unavailable";
  }
  if (level === LocalAuthentication.SecurityLevel.NONE) return "unavailable";
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage });
    return result.success ? "success" : "failed";
  } catch {
    return "failed";
  }
}
