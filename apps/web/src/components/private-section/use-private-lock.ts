"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PrivateLockController,
  getPrivateLockConfig,
  type LockMethod,
  type LockStatus,
  type LockStorage,
  type SetupResult,
  type UnlockResult,
} from "@tarragon/shared";

/**
 * Web binding for the private section lock (S66). The rules live in @tarragon/shared (PrivateLockController); this hook only supplies the
 * browser's storage, clock and random source and re-locks when the tab has been hidden for longer than the configured time.
 *
 * Storage is localStorage keyed by account, so a shared computer keeps one PIN per account. The record holds a salted PBKDF2 hash, never
 * the PIN. Unlocked state is held in memory only: a reload asks for the PIN again, by design.
 */

export const browserLockStorage: LockStorage = {
  async get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    window.localStorage.setItem(key, value);
  },
  async remove(key) {
    window.localStorage.removeItem(key);
  },
};

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  window.crypto.getRandomValues(out);
  return out;
}

// One controller per account for the whole page session, so every PrivateSection on a page shares one unlocked state.
const controllers = new Map<string, PrivateLockController>();

export function controllerFor(accountId: string): PrivateLockController {
  let c = controllers.get(accountId);
  if (!c) {
    c = new PrivateLockController({
      storage: browserLockStorage,
      config: getPrivateLockConfig(),
      now: () => Date.now(),
      randomBytes,
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
  setupPin: (pin: string) => Promise<SetupResult>;
  turnOff: () => Promise<boolean>;
  unlockWithPin: (pin: string) => Promise<UnlockResult>;
  lock: () => Promise<void>;
  /** Call only after the recovery code was verified on the server. */
  resetAfterReverification: () => Promise<boolean>;
}

export function usePrivateLock(accountId: string): PrivateLockApi {
  const controller = useMemo(() => controllerFor(accountId), [accountId]);
  const [status, setStatus] = useState<LockStatus | "loading">("loading");
  const [method, setMethod] = useState<LockMethod | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
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
    const onVisibility = () => {
      if (document.visibilityState === "hidden") controller.onBackgrounded();
      else {
        controller.onForegrounded();
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [controller, refresh]);

  // Count a lockout down so the screen can say how long is left, and re-enable the field when it ends.
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const id = window.setInterval(() => setLockoutSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [lockoutSeconds > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    status,
    method,
    lockoutSeconds,
    setupPin: async (pin) => {
      const r = await controller.setupPin(pin);
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
