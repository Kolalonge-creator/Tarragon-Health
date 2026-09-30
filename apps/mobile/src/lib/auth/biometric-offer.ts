import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { authenticate, readAppLockEnabled, writeAppLockEnabled } from "@/lib/app-lock";

/**
 * One-time offer to turn on App Lock (biometric unlock) right after the first
 * successful sign-in. Biometrics only gate the session already stored on this
 * device; they never replace a server check. The fail-open contract in
 * app-lock.ts is untouched, and Settings stays the clear way to turn it off.
 */
export const BIOMETRIC_OFFER_SHOWN_KEY = "biometric-offer-shown-v1";

export async function readOfferShown(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(BIOMETRIC_OFFER_SHOWN_KEY)) === "true";
  } catch {
    // Unreadable: behave as already shown rather than risk nagging.
    return true;
  }
}

export async function markOfferShown(): Promise<void> {
  try {
    await SecureStore.setItemAsync(BIOMETRIC_OFFER_SHOWN_KEY, "true");
  } catch {
    // Best effort.
  }
}

/** Pure: should the offer appear? */
export function shouldOfferBiometric(input: {
  alreadyShown: boolean;
  lockAlreadyEnabled: boolean;
  enrolledLevel: LocalAuthentication.SecurityLevel;
}): boolean {
  if (input.alreadyShown || input.lockAlreadyEnabled) return false;
  return input.enrolledLevel !== LocalAuthentication.SecurityLevel.NONE;
}

export async function checkBiometricOfferEligible(): Promise<boolean> {
  try {
    const [alreadyShown, lockAlreadyEnabled, enrolledLevel] = await Promise.all([
      readOfferShown(),
      readAppLockEnabled(),
      LocalAuthentication.getEnrolledLevelAsync(),
    ]);
    return shouldOfferBiometric({ alreadyShown, lockAlreadyEnabled, enrolledLevel });
  } catch {
    // No authenticator to ask: show nothing.
    return false;
  }
}

export type OfferAnswer = "enabled" | "failed" | "unavailable";

/** "Turn on": prove it works first, then enable. A failed scan keeps the offer open. */
export async function acceptBiometricOffer(promptMessage: string): Promise<OfferAnswer> {
  const result = await authenticate(promptMessage);
  if (result === "success") {
    await writeAppLockEnabled(true);
    await markOfferShown();
    return "enabled";
  }
  if (result === "unavailable") {
    await markOfferShown();
    return "unavailable";
  }
  return "failed";
}

/** "Not now": never ask again. */
export async function declineBiometricOffer(): Promise<void> {
  await markOfferShown();
}
