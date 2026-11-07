"use client";

import { useSyncExternalStore } from "react";

/**
 * Cookie/tracking-technology consent state, two models (founder decision
 * W-07, 2026-11-05):
 * - Public marketing site: OPT-IN. The first-party analytics beacon
 *   (components/analytics/page-tracker.tsx) sends nothing until the visitor
 *   presses "Accept"; unanswered (null) and "rejected" both mean no tracking.
 *   NDPA guidance expects consent before non-essential analytics.
 * - Signed-in app: opt-out, unchanged. There the analytics is a disclosed,
 *   in-Terms part of running the service and the banner never shows, so only
 *   an explicit "rejected" (or Do Not Track) turns it off.
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

/**
 * Signed-in app areas, where analytics is disclosed in the Terms and stays
 * opt-out. Everything else (the marketing site AND anonymous public pages such
 * as /signup, /login, /checkout, /claim or /share) is opt-in: a code review
 * found that keying opt-in to the marketing route list alone left /signup
 * tracking an anonymous visitor who had never been asked. Missing an area
 * here fails safe (that area becomes opt-in), and consent-opt-in.test.ts
 * checks every folder under app/(dashboard) is listed.
 */
export const SIGNED_IN_APP_PREFIXES = [
  "/account",
  "/admin",
  "/analytics",
  "/clinician",
  // the shared Community moderation desk (COM-31), staff only
  "/community-desk",
  "/credentialing",
  "/dashboard",
  "/doctor",
  "/finance",
  "/lab-liaison",
  "/lab-partner",
  "/onboarding",
  "/patient",
  "/payer",
  "/pharmacist",
  "/provider-org",
  "/reader",
  "/rota",
] as const;

/** True for a path inside the signed-in app (opt-out analytics); false for every public page (opt-in). */
export function isSignedInAppPath(pathname: string): boolean {
  return SIGNED_IN_APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Whether a stored choice permits analytics under the given model. */
function allows(choice: CookieConsentChoice | null, optIn: boolean): boolean {
  return optIn ? choice === "accepted" : choice !== "rejected";
}

/**
 * Whether analytics may run. `optIn` is true on every public page (only an
 * explicit "accepted" allows it) and false in the signed-in app (anything but
 * an explicit "rejected" allows it); see isSignedInAppPath.
 */
export function useAnalyticsAllowed(optIn: boolean): boolean {
  return allows(useCookieConsent(), optIn);
}

/**
 * Direct, non-reactive read of the real stored choice — bypasses
 * useSyncExternalStore's SSR-matched snapshot. That snapshot deliberately
 * reads as "unknown" (tracking-allowed under opt-out) for one render tick
 * after hydration on every fresh page load, to avoid a visual mismatch on
 * the banner; correct there, but wrong for a side effect that must never
 * fire even once after a real rejection. Effects only ever run client-side,
 * so this is always safe to call from inside one — call it as an extra
 * guard right before sending a beacon, not for anything rendered.
 */
export function isAnalyticsAllowedNow(optIn: boolean): boolean {
  return allows(readConsent(), optIn);
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
