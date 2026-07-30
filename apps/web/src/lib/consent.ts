"use client";

import { useSyncExternalStore } from "react";

/**
 * Cookie/tracking-technology consent state. Opt-out model: the first-party
 * analytics beacon (components/analytics/page-tracker.tsx) runs by default
 * and stops immediately the moment someone rejects (or sends Do Not Track) —
 * "accepted"/null are both tracking-allowed, only "rejected" turns it off.
 * Essential auth cookies (Supabase) are unaffected either way; they're
 * required for the app to work and are never gated.
 *
 * useSyncExternalStore (not useState+useEffect) because this reads an
 * external store (localStorage) that can differ between the SSR pass and the
 * client, and can change from another tab/component — exactly the case it's
 * designed for, including a safe, mismatch-free server snapshot.
 */

export type CookieConsentChoice = "accepted" | "rejected";

const STORAGE_KEY = "th_cookie_consent";
const CHANGE_EVENT = "th:cookie-consent-change";

function readConsent(): CookieConsentChoice | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "accepted" || value === "rejected" ? value : null;
  } catch {
    return null;
  }
}

function getServerSnapshot(): CookieConsentChoice | null {
  return null;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The visitor's current cookie-consent choice, or null if unanswered. */
export function useCookieConsent(): CookieConsentChoice | null {
  return useSyncExternalStore(subscribe, readConsent, getServerSnapshot);
}

/** Opt-out: true unless the visitor has explicitly rejected. */
export function useAnalyticsAllowed(): boolean {
  return useCookieConsent() !== "rejected";
}

/**
 * Direct, non-reactive read of the real stored choice — bypasses
 * useSyncExternalStore's SSR-matched snapshot. That snapshot deliberately
 * reads as "unknown" (tracking-allowed, under opt-out) for one render tick
 * after hydration on every fresh page load, to avoid a visual mismatch on
 * the banner; correct there, but wrong for a side effect that must never
 * fire even once after a real rejection. Effects only ever run client-side,
 * so this is always safe to call from inside one — call it as an extra
 * guard right before sending a beacon, not for anything rendered.
 */
export function isAnalyticsAllowedNow(): boolean {
  return readConsent() !== "rejected";
}

export function setStoredConsent(choice: CookieConsentChoice): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // localStorage unavailable (private mode / disabled) — the choice won't
    // persist, so the banner just re-asks next visit.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Reopens the banner (e.g. from a "change my preferences" control). */
export function clearStoredConsent(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
