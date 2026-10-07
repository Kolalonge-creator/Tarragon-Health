import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import {
  PrivateLockController,
  getPrivateLockConfig,
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

const controllers = new Map<string, PrivateLockController>();

export function controllerFor(accountId: string): PrivateLockController {
  let c = controllers.get(accountId);
  if (!c) {
    c = new PrivateLockController({
      storage: secureStoreLockStorage,
      config: getPrivateLockConfig(),
      now: () => Date.now(),
      randomBytes: (n) => Crypto.getRandomBytes(n),
      biometric: deviceBiometric,
      accountId,
    });
    controllers.set(accountId, c);
  }
  return c;
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

export function usePrivateLock(accountId: string): PrivateLockApi {
  const controller = useMemo(() => controllerFor(accountId), [accountId]);
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
  }, [lockoutSeconds > 0]); // eslint-disable-line react-hooks/exhaustive-deps

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
