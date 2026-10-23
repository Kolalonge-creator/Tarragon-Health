/**
 * "Hide on this phone" (UI-B, change 6). A per-card, per-account, per-DEVICE switch for sensitive cards (cycle, pregnancy,
 * contraception, growth) so a glance on a shared phone does not show them. It sits next to the PrivateSection lock and uses the same
 * injected storage (SecureStore on the phone, localStorage on the web), so nothing leaves the device.
 *
 * What it is NOT: it deletes nothing, it does not change who else can see the data, and it is not a lock (showing the card again needs
 * no PIN). A person who wants a PIN uses PrivateSection. The pure rules are here so web and phone behave the same.
 */
import type { LockStorage } from "./controller";

/** The cards that offer the switch. A test keeps the list closed: adding a card is a deliberate change. */
export const HIDEABLE_CARDS = ["cycle", "pregnancy", "contraception", "growth"] as const;
export type HideableCard = (typeof HIDEABLE_CARDS)[number];

export function hideOnDeviceKey(accountId: string, card: HideableCard): string {
  return `hide_on_device:${accountId}:${card}`;
}

/** A storage that cannot be read counts as NOT hidden: failing to read must never hide a safety card, and never throws. */
export async function isHiddenOnDevice(storage: LockStorage, accountId: string, card: HideableCard): Promise<boolean> {
  try {
    return (await storage.get(hideOnDeviceKey(accountId, card))) === "1";
  } catch {
    return false;
  }
}

/** Returns false when the choice could not be saved, so the screen can say so instead of pretending the card is hidden. */
export async function setHiddenOnDevice(storage: LockStorage, accountId: string, card: HideableCard, hidden: boolean): Promise<boolean> {
  try {
    if (hidden) await storage.set(hideOnDeviceKey(accountId, card), "1");
    else await storage.remove(hideOnDeviceKey(accountId, card));
    return true;
  } catch {
    return false;
  }
}

/**
 * The shortest patient-first window the server accepts: `care_circle_config` checks `checkin_window_minutes` is between 1 and 60
 * (migration 20261016191430_s29e). The live window is NOT readable from the client (`circle_check_in_pending` returns only a boolean)
 * and the check-in's start time is not either, so a snooze must be safe against the shortest possible window, not the PROPOSED 5.
 */
export const CHECKIN_WINDOW_MIN_MINUTES = 1;
/** The longest window the server accepts (same migration): a snooze record older than this belongs to a question that has ended. */
export const CHECKIN_WINDOW_MAX_MINUTES = 60;

export type CheckInSnoozeState = "none" | "snoozed" | "asked_again";

/**
 * Where a check-in question stands given the snooze deadline kept for this browser session (or null). A reload therefore cannot give a
 * second snooze: a past deadline means the question was already snoozed once, so it is shown again with no snooze button. A deadline
 * older than the longest possible window is stale and ignored.
 */
export function restoreCheckInSnooze(deadlineMs: number | null, nowMs: number): CheckInSnoozeState {
  if (deadlineMs === null || !Number.isFinite(deadlineMs)) return "none";
  if (nowMs - deadlineMs > CHECKIN_WINDOW_MAX_MINUTES * 60_000) return "none";
  return nowMs < deadlineMs ? "snoozed" : "asked_again";
}

/**
 * How long "Not right now" hides a Care Circle check-in question before it is asked once more: a quarter of the given window, never
 * below 15 seconds and never past half of it, so the second ask still has time left in it. Callers pass CHECKIN_WINDOW_MIN_MINUTES
 * (15 seconds), because the live window cannot be read here. The window is decided on the server and a snooze cannot extend it; the
 * screen says so.
 */
export function checkInSnoozeSeconds(windowMinutes: number): number {
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) return 15;
  const windowSeconds = windowMinutes * 60;
  return Math.min(Math.max(15, Math.floor(windowSeconds / 4)), Math.floor(windowSeconds / 2));
}
