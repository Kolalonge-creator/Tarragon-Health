import type { OfflineGuidanceCode } from "./offline-emergency";

/**
 * A note kept in this browser tab (sessionStorage only, never sent anywhere) that a reading which asked for emergency guidance has NOT been
 * confirmed saved. It exists so the guidance survives the two moments the form itself cannot: a reload with no network (public/offline.html reads
 * it) and a failed request that drops the page into the error screen (the dashboard error boundary reads it). It holds the guidance CODE only:
 * no reading, no symptom, no name (INV-07). It is cleared the moment the server answers.
 */
export const EMERGENCY_MARKER_KEY = "th-emergency-unconfirmed";

export function rememberEmergency(code: OfflineGuidanceCode): void {
  try {
    window.sessionStorage.setItem(EMERGENCY_MARKER_KEY, JSON.stringify({ code }));
  } catch {
    // Storage can be blocked (private window). The dialog itself does not depend on it.
  }
}

export function forgetEmergency(): void {
  try {
    window.sessionStorage.removeItem(EMERGENCY_MARKER_KEY);
  } catch {
    // ignore
  }
}

export function readEmergency(): OfflineGuidanceCode | null {
  try {
    const raw = window.sessionStorage.getItem(EMERGENCY_MARKER_KEY);
    if (!raw) return null;
    const code = (JSON.parse(raw) as { code?: unknown }).code;
    return code === "EMG-001" || code === "EMG-001L" ? code : null;
  } catch {
    return null;
  }
}
