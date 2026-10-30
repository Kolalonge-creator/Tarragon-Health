import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import {
  PrivateLockController,
  getPrivateLockConfig,
  PRIVATE_LOCK_KEY_PREFIX,
  type BiometricAdapter,
  type LockMethod,
  type LockStatus,
  type LockStorage,
  type SetupResult,
  type UnlockResult,
} from "@tarragon/shared";

/**
 * Mobile binding for the private section lock (S66). The rules live in @tarragon/shared (PrivateLockController, tested once for web and
 * mobile). This file supplies the device pieces: SecureStore (the hardware-backed keystore) for the hashed PIN record, expo-crypto for the
 * random salt, and expo-local-authentication for an optional biometric. It is SEPARATE from the whole-app lock in app-lock.ts, which is
 * left exactly as it is: that lock opens the app, this one opens a private section inside it.
 *
 * Not exercised on a real device yet (docs/design/S66.md, "not run").
 */

/** SecureStore keys may only hold letters, digits, dot, dash and underscore. The controller's key has a colon, so it is mapped. */
export function secureStoreKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, ".");
}

export const secureStoreLockStorage: LockStorage = {
  async get(key) {
    try {
      return await SecureStore.getItemAsync(secureStoreKey(key));
    } catch {
      return null;
    }
  },
  async set(key, value) {
    await SecureStore.setItemAsync(secureStoreKey(key), value);
  },
  async remove(key) {
    await SecureStore.deleteItemAsync(secureStoreKey(key));
  },
};

export const deviceBiometric: BiometricAdapter = {
  async isAvailable() {
    try {
      return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
    } catch {
      return false;
    }
  },
  async authenticate(prompt) {
    try {
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: prompt });
      return result.success ? "success" : "failed";
    } catch {
      return "unavailable";
    }
  },
};

/**
 * Which lock. "private" is the S66 section lock (on by default, optional biometric). "app" is the optional PIN that sits on the
 * whole-app lock: the same tested controller, but with its own stored record (a PIN set for one never opens the other), OFF unless the
 * person turns it on, and PIN only. No biometric, on purpose: the device biometric prompt falls back to the phone's passcode, and the
 * point of an app PIN is that knowing the phone's passcode (a partner, a relative, a borrowed phone) is not enough to open the app.
 */
export type LockScope = "private" | "app";
const APP_PIN_KEY_PREFIX = "app-lock-pin-v1:";

/** Storage for the app PIN: the controller's key prefix is swapped so the two locks never share a SecureStore record. */
export const appPinLockStorage: LockStorage = {
  get: (key) => secureStoreLockStorage.get(appPinKey(key)),
  set: (key, value) => secureStoreLockStorage.set(appPinKey(key), value),
  remove: (key) => secureStoreLockStorage.remove(appPinKey(key)),
};
export function appPinKey(key: string): string {
  return key.startsWith(PRIVATE_LOCK_KEY_PREFIX) ? APP_PIN_KEY_PREFIX + key.slice(PRIVATE_LOCK_KEY_PREFIX.length) : APP_PIN_KEY_PREFIX + key;
}

const controllers = new Map<string, PrivateLockController>();

export function controllerFor(accountId: string, scope: LockScope = "private"): PrivateLockController {
  const cacheKey = `${scope}:${accountId}`;
  let c = controllers.get(cacheKey);
  if (!c) {
    const base = getPrivateLockConfig();
    c = new PrivateLockController({
      storage: scope === "app" ? appPinLockStorage : secureStoreLockStorage,
      config: scope === "app" ? { ...base, onByDefault: false } : base,
      now: () => Date.now(),
      randomBytes: (n) => Crypto.getRandomBytes(n),
      ...(scope === "app" ? {} : { biometric: deviceBiometric }),
      accountId,
    });
    controllers.set(cacheKey, c);
  }
  return c;
}

/**
 * Called by the lock screen BEFORE it reads the PIN state. The controller is cached for the life of the process and only re-locks through
 * the hook's background listener, which exists only while a component using the hook is mounted. After the PIN is entered the lock screen
 * unmounts, so nothing listens and the controller would stay unlocked: the next time the app locks (returning from background) the screen
 * would read "unlocked", skip the PIN card, and fall back to the device prompt, which accepts the phone's passcode. The lock screen being
 * shown at all means the app asked for proof again, so the PIN is locked first. Synchronous on purpose.
 */
export function lockAppPinForGate(accountId: string): void {
  controllerFor(accountId, "app").lock();
}

export interface PrivateLockApi {
  status: LockStatus | "loading";
  method: LockMethod | null;
  lockoutSeconds: number;
  biometricAvailable: boolean;
  setupPin: (pin: string, alsoBiometric?: boolean) => Promise<SetupResult>;
  setupBiometricOnly: () => Promise<SetupResult>;
  turnOff: () => Promise<boolean>;
  unlockWithPin: (pin: string) => Promise<UnlockResult>;
  unlockWithBiometric: () => Promise<UnlockResult>;
  lock: () => Promise<void>;
  /** Only after the recovery code was verified. */
  resetAfterReverification: () => Promise<boolean>;
}

export function usePrivateLock(accountId: string, scope: LockScope = "private"): PrivateLockApi {
  const controller = useMemo(() => controllerFor(accountId, scope), [accountId, scope]);
  const [status, setStatus] = useState<LockStatus | "loading">("loading");
  const [method, setMethod] = useState<LockMethod | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const [s, m, l] = await Promise.all([controller.status(), controller.method(), controller.lockoutSecondsLeft()]);
    if (!alive.current) return;
    setStatus(s);
    setMethod(m);
    setLockoutSeconds(l);
  }, [controller]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    void deviceBiometric.isAvailable().then((ok) => alive.current && setBiometricAvailable(ok));
    // Re-asked after backgrounding: only a real "background" counts (iOS reports "inactive" for the notification shade and Face ID sheet).
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") controller.onBackgrounded();
      else if (next === "active") {
        controller.onForegrounded();
        void refresh();
      }
    });
    return () => {
      alive.current = false;
      sub.remove();
    };
  }, [controller, refresh]);

  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const id = setInterval(() => setLockoutSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [lockoutSeconds > 0]);

  return {
    status,
    method,
    lockoutSeconds,
    biometricAvailable,
    setupPin: async (pin, alsoBiometric = false) => {
      const r = await controller.setupPin(pin, alsoBiometric);
      await refresh();
      return r;
    },
    setupBiometricOnly: async () => {
      const r = await controller.setupBiometricOnly();
      await refresh();
      return r;
    },
    turnOff: async () => {
      const r = await controller.turnOff();
      await refresh();
      return r.ok;
    },
    unlockWithPin: async (pin) => {
      const r = await controller.unlockWithPin(pin);
      await refresh();
      return r;
    },
    unlockWithBiometric: async () => {
      const r = await controller.unlockWithBiometric();
      await refresh();
      return r;
    },
    lock: async () => {
      controller.lock();
      await refresh();
    },
    resetAfterReverification: async () => {
      const r = await controller.resetAfterReverification();
      await refresh();
      return r.ok;
    },
  };
}
