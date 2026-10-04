import * as SecureStore from "expo-secure-store";

const mockEnrolled = jest.fn();
const mockAuthenticate = jest.fn();
jest.mock("expo-local-authentication", () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: (...a: unknown[]) => mockEnrolled(...a),
  authenticateAsync: (...a: unknown[]) => mockAuthenticate(...a),
}));

import {
  BIOMETRIC_OFFER_SHOWN_KEY,
  acceptBiometricOffer,
  checkBiometricOfferEligible,
  declineBiometricOffer,
  shouldOfferBiometric,
} from "./biometric-offer";
import { APP_LOCK_KEY, readAppLockEnabled } from "@/lib/app-lock";

beforeEach(() => {
  mockEnrolled.mockReset();
  mockAuthenticate.mockReset();
});

describe("shouldOfferBiometric", () => {
  it("offers only when not shown, not already on, and something is enrolled", () => {
    expect(shouldOfferBiometric({ alreadyShown: false, lockAlreadyEnabled: false, enrolledLevel: 3 })).toBe(true);
    expect(shouldOfferBiometric({ alreadyShown: false, lockAlreadyEnabled: false, enrolledLevel: 1 })).toBe(true);
    expect(shouldOfferBiometric({ alreadyShown: true, lockAlreadyEnabled: false, enrolledLevel: 3 })).toBe(false);
    expect(shouldOfferBiometric({ alreadyShown: false, lockAlreadyEnabled: true, enrolledLevel: 3 })).toBe(false);
    expect(shouldOfferBiometric({ alreadyShown: false, lockAlreadyEnabled: false, enrolledLevel: 0 })).toBe(false);
  });
});

describe("checkBiometricOfferEligible", () => {
  it("shows nothing on a device with no biometrics or device credential", async () => {
    mockEnrolled.mockResolvedValue(0);
    expect(await checkBiometricOfferEligible()).toBe(false);
  });

  it("shows nothing if the authenticator cannot be queried", async () => {
    mockEnrolled.mockRejectedValue(new Error("no native module"));
    expect(await checkBiometricOfferEligible()).toBe(false);
  });

  it("is eligible once, then never again after 'Not now'", async () => {
    mockEnrolled.mockResolvedValue(3);
    expect(await checkBiometricOfferEligible()).toBe(true);
    await declineBiometricOffer();
    expect(await SecureStore.getItemAsync(BIOMETRIC_OFFER_SHOWN_KEY)).toBe("true");
    expect(await checkBiometricOfferEligible()).toBe(false);
    expect(await readAppLockEnabled()).toBe(false);
  });
});

describe("acceptBiometricOffer", () => {
  it("turns App Lock on only after a successful authenticate, and records the offer as shown", async () => {
    mockEnrolled.mockResolvedValue(3);
    mockAuthenticate.mockResolvedValue({ success: true });
    expect(await acceptBiometricOffer("Unlock")).toBe("enabled");
    expect(await SecureStore.getItemAsync(APP_LOCK_KEY)).toBe("true");
    expect(await checkBiometricOfferEligible()).toBe(false);
  });

  it("a failed scan leaves App Lock off and the offer still open", async () => {
    mockEnrolled.mockResolvedValue(3);
    mockAuthenticate.mockResolvedValue({ success: false });
    expect(await acceptBiometricOffer("Unlock")).toBe("failed");
    expect(await readAppLockEnabled()).toBe(false);
    expect(await SecureStore.getItemAsync(BIOMETRIC_OFFER_SHOWN_KEY)).toBeNull();
  });

  it("fails open when nothing is enrolled: no lock is enabled", async () => {
    mockEnrolled.mockResolvedValue(0);
    expect(await acceptBiometricOffer("Unlock")).toBe("unavailable");
    expect(await readAppLockEnabled()).toBe(false);
  });
});
