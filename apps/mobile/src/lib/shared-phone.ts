import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { isValidSharedPhonePin } from "@tarragon/shared";

/**
 * Shared-phone mode for the wellbeing screens (S56), the same behaviour as web (apps/web/src/lib/mental-health/shared-phone.ts):
 * with the mode on the wellbeing screens open hidden and hide again whenever the app goes to the background; Hide now is always one
 * tap; an optional 4 to 8 digit PIN guards Show. The PIN is stored on this phone only, salted and stretched, never sent anywhere.
 * It is a household privacy gate, not security against a determined attacker. Nothing here puts mood or scores in a notification.
 * A failing store means the mode is off and nothing is hidden by default.
 */
const KEY = "tarragon.sharedPhone.v1";
const STRETCH_ROUNDS = 1000;

export interface SharedPhoneStored { on: boolean; salt?: string; hash?: string }
export type SharedPhoneSnapshot = { on: boolean; hasPin: boolean; hidden: boolean; ready: boolean };
export type Digest = (input: string) => Promise<string>;

/** Salted, stretched hash through an injectable digest (so the logic is testable without the native module). */
export async function hashPin(pin: string, salt: string, digest: Digest, rounds: number = STRETCH_ROUNDS): Promise<string> {
  let h = `${salt}:${pin}`;
  for (let i = 0; i < rounds; i += 1) h = await digest(`${salt}:${h}`);
  return h;
}

/** True when the content may be shown: no PIN set, or the PIN matches. */
export async function pinAllows(stored: SharedPhoneStored, pin: string | undefined, digest: Digest, rounds: number = STRETCH_ROUNDS): Promise<boolean> {
  if (!stored.hash || !stored.salt) return true;
  if (!pin || !isValidSharedPhonePin(pin)) return false;
  return (await hashPin(pin, stored.salt, digest, rounds)) === stored.hash;
}

const sha256: Digest = (input) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input);

let stored: SharedPhoneStored = { on: false };
let hidden = false;
let ready = false;
let cached: SharedPhoneSnapshot = { on: false, hasPin: false, hidden: false, ready: false };
const listeners = new Set<() => void>();

function recompute() {
  const next: SharedPhoneSnapshot = { on: stored.on, hasPin: !!stored.hash, hidden, ready };
  if (next.on !== cached.on || next.hasPin !== cached.hasPin || next.hidden !== cached.hidden || next.ready !== cached.ready) cached = next;
  listeners.forEach((l) => l());
}
async function persist() {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(stored)); } catch { /* the mode simply stays as it is in memory */ }
}
let loading: Promise<void> | null = null;
function load(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const v = JSON.parse(raw) as SharedPhoneStored;
          stored = { on: v.on === true, salt: typeof v.salt === "string" ? v.salt : undefined, hash: typeof v.hash === "string" ? v.hash : undefined };
        }
      } catch { /* off */ }
      hidden = stored.on;
      ready = true;
      recompute();
    })();
  }
  return loading;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useSharedPhone() {
  const snap = useSyncExternalStore(subscribe, () => cached, () => cached);
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!snap.on) return;
    const sub = AppState.addEventListener("change", (s) => { if (s !== "active") { hidden = true; recompute(); } });
    return () => sub.remove();
  }, [snap.on]);

  const setOn = useCallback(async (on: boolean) => {
    stored = on ? { ...stored, on: true } : { on: false };
    hidden = on;
    recompute();
    await persist();
  }, []);
  const hideNow = useCallback(() => { hidden = true; recompute(); }, []);
  const show = useCallback(async (pin?: string): Promise<boolean> => {
    if (!(await pinAllows(stored, pin, sha256))) return false;
    hidden = false;
    recompute();
    return true;
  }, []);
  const setPin = useCallback(async (pin: string): Promise<boolean> => {
    if (!isValidSharedPhonePin(pin)) return false;
    const salt = Crypto.randomUUID();
    stored = { ...stored, salt, hash: await hashPin(pin, salt, sha256) };
    recompute();
    await persist();
    return true;
  }, []);
  const clearPin = useCallback(async () => { stored = { on: stored.on }; recompute(); await persist(); }, []);

  return { ...snap, setOn, hideNow, show, setPin, clearPin };
}
