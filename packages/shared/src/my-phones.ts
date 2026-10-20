/**
 * "My phones" (S06x follow-up): the patient's own list of phones that keep a saved, encrypted copy of their entries, built over
 * `public.offline_device_leases` (S06x). Pure and shared by the web page and the phone screen, so both say the same thing.
 *
 * Calm on purpose: a state is a plain sentence plus whether "this phone was lost" is still offered. It never names a health value,
 * medicine or condition, and a phone's id is never shown (a platform and a last-seen time are enough to recognise your own phone).
 */

export interface PhoneLeaseRow {
  device_id: string;
  platform: string;
  registered_at: string | null;
  last_checkin_at: string;
  lease_expires_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  wipe_confirmed_at: string | null;
  wipe_reason: string | null;
  unsent_at_wipe: number | null;
  danger_at_wipe: number | null;
  retired_at: string | null;
}

/** `lease_ending` is informational only (inside the last 7 days of the lease); nothing is wrong yet. */
export type PhoneState = "active" | "lease_ending" | "lease_lapsed" | "lost_reported" | "cleared" | "quiet";

export const PHONE_LEASE_ENDING_DAYS = 7;
const DAY_MS = 86_400_000;

export const PHONE_ROW_COLUMNS =
  "device_id, platform, registered_at, last_checkin_at, lease_expires_at, revoked_at, revoke_reason, wipe_confirmed_at, wipe_reason, unsent_at_wipe, danger_at_wipe, retired_at";

export function phoneState(row: PhoneLeaseRow, nowMs: number): PhoneState {
  if (row.wipe_confirmed_at) return "cleared";
  if (row.revoked_at) return "lost_reported";
  if (row.retired_at) return "quiet";
  const expires = Date.parse(row.lease_expires_at);
  if (Number.isFinite(expires)) {
    if (expires <= nowMs) return "lease_lapsed";
    if (expires - nowMs <= PHONE_LEASE_ENDING_DAYS * DAY_MS) return "lease_ending";
  }
  return "active";
}

/** Whether "this phone was lost" is offered. Once reported (or already cleared) there is nothing more to ask for. */
export function canReportLost(state: PhoneState): boolean {
  return state !== "lost_reported" && state !== "cleared";
}

export function phoneKind(platform: string): "ios" | "android" | "other" {
  return platform === "ios" ? "ios" : platform === "android" ? "android" : "other";
}

/** Phones that still hold data first (newest check-in first), quiet ones next, cleared ones last. */
export function sortPhones(rows: readonly PhoneLeaseRow[], nowMs: number): PhoneLeaseRow[] {
  const rank = (r: PhoneLeaseRow) => {
    const s = phoneState(r, nowMs);
    return s === "cleared" ? 2 : s === "quiet" ? 1 : 0;
  };
  return [...rows].sort((a, b) => rank(a) - rank(b) || Date.parse(b.last_checkin_at) - Date.parse(a.last_checkin_at));
}

/** Counts shown after a phone was cleared: entries that had not reached us (counts only, never content). */
export function clearedCounts(row: PhoneLeaseRow): { unsent: number; urgent: number } {
  const clamp = (n: number | null) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  const unsent = clamp(row.unsent_at_wipe);
  return { unsent, urgent: Math.min(clamp(row.danger_at_wipe), unsent) };
}
