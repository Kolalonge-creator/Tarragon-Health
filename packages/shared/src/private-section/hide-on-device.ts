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
 * How long "Not right now" hides a Care Circle check-in question before it is asked once more: a quarter of the patient-first window
 * from `care_circle.rules.checkin_window_minutes`, so the second ask still has time left in it. The window itself is server side and a
 * snooze cannot extend it; the screen says so. Never below 15 seconds and never past half the window.
 */
export function checkInSnoozeSeconds(windowMinutes: number): number {
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) return 15;
  const windowSeconds = windowMinutes * 60;
  return Math.min(Math.max(15, Math.floor(windowSeconds / 4)), Math.floor(windowSeconds / 2));
}
