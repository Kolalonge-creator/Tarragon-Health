"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { isValidSharedPhonePin } from "@tarragon/shared";

/**
 * Shared-phone mode for the wellbeing screens (S56). Several people in one household use one phone, so:
 *   - nothing about mood, scores or crisis is ever put in a notification or on a lock screen (the notification templates are
 *     neutral, INV-07; this mode adds no new push);
 *   - with the mode on, the wellbeing screens open hidden and hide again when the page goes to the background;
 *   - "Hide now" is always one tap, mode on or off;
 *   - an optional PIN (4 to 8 digits) guards "Show". It is stored on this device only, salted and stretched (PBKDF2), and never sent
 *     anywhere. It is a household privacy gate, not security against a determined attacker, and the screen says so.
 * Everything is stored in this browser. A blocked or empty store means the mode is off and nothing is hidden by default.
 */
const KEY = "tarragon.sharedPhone.v1";
const HIDDEN_KEY = "tarragon.sharedPhone.hidden.v1";

interface Stored { on: boolean; salt?: string; hash?: string }
type Snapshot = { on: boolean; hasPin: boolean; hidden: boolean };

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function readStored(): Stored {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { on: false };
    const v = JSON.parse(raw) as Stored;
    return { on: v.on === true, salt: typeof v.salt === "string" ? v.salt : undefined, hash: typeof v.hash === "string" ? v.hash : undefined };
  } catch {
    return { on: false };
  }
}
function writeStored(v: Stored) {
  try { window.localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* blocked store: the mode simply stays off */ }
  notify();
}
function readHidden(): boolean | null {
  try {
    const v = window.sessionStorage.getItem(HIDDEN_KEY);
    return v === null ? null : v === "1";
  } catch {
    return null;
  }
}
function writeHidden(h: boolean) {
  try { window.sessionStorage.setItem(HIDDEN_KEY, h ? "1" : "0"); } catch { /* ignore */ }
  notify();
}

let cached: Snapshot = { on: false, hasPin: false, hidden: false };
function snapshot(): Snapshot {
  const s = readStored();
  const h = readHidden();
  const next: Snapshot = { on: s.on, hasPin: !!s.hash, hidden: h === null ? s.on : h };
  if (next.on !== cached.on || next.hasPin !== cached.hasPin || next.hidden !== cached.hidden) cached = next;
  return cached;
}
const SERVER: Snapshot = { on: false, hasPin: false, hidden: false };

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY || e.key === HIDDEN_KEY) cb(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); window.removeEventListener("storage", onStorage); };
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function hashPin(pin: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
  return toHex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256));
}

export function useSharedPhone() {
  const snap = useSyncExternalStore(subscribe, snapshot, () => SERVER);

  // With the mode on, hide again whenever the page goes to the background (task switcher, lock).
  useEffect(() => {
    if (!snap.on) return;
    const onVis = () => { if (document.visibilityState === "hidden") writeHidden(true); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [snap.on]);

  const setOn = useCallback((on: boolean) => {
    const cur = readStored();
    writeStored(on ? { ...cur, on: true } : { on: false });
    writeHidden(on);
  }, []);
  const hideNow = useCallback(() => writeHidden(true), []);
  /** Returns true when the content may now be shown. */
  const show = useCallback(async (pin?: string): Promise<boolean> => {
    const cur = readStored();
    if (cur.hash && cur.salt) {
      if (!pin || !isValidSharedPhonePin(pin) || (await hashPin(pin, cur.salt)) !== cur.hash) return false;
    }
    writeHidden(false);
    return true;
  }, []);
  const setPin = useCallback(async (pin: string): Promise<boolean> => {
    if (!isValidSharedPhonePin(pin)) return false;
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer);
    writeStored({ ...readStored(), salt, hash: await hashPin(pin, salt) });
    return true;
  }, []);
  const clearPin = useCallback(() => { const cur = readStored(); writeStored({ on: cur.on }); }, []);

  return { ...snap, setOn, hideNow, show, setPin, clearPin };
}
