import { readAppLockEnabled } from "./app-lock";
import { loadNotificationSettings } from "./notification-settings";
import { supabase } from "./supabase";

/**
 * The privacy cover (audit 1.18): an opaque screen shown instead of the app whenever the app is not the foreground app, so the
 * app switcher's snapshot, and a glance over a shoulder at it, show the brand mark and nothing of the person's record.
 *
 * Who gets it: anyone with App lock on, or discreet mode on. Both are people who have said they do not want what is on the screen
 * visible to others. It is not forced on everyone, because on iOS "inactive" also happens for a moment during a permission
 * dialog or the Face ID sheet, and a flicker there is a cost only people who asked for privacy should pay.
 *
 * What it can and cannot do, said plainly:
 *   - iOS: the snapshot is taken as the app goes inactive, and React draws the cover in that window. This works.
 *   - Android: the system takes the recents thumbnail as the activity pauses, before JavaScript can react, so a React cover is not
 *     reliable there. The dependable fix is the window's FLAG_SECURE (which also blocks screenshots), which needs a native module
 *     and a new build. That is recorded in docs/OPEN-QUESTIONS.md and is NOT done here.
 * Pure rules below; the overlay is apps/mobile/src/ui/privacy-cover.tsx.
 */
export interface CoverInputs {
  appLockOn: boolean;
  discreetOn: boolean;
}

export function coverEnabled(i: CoverInputs): boolean {
  return i.appLockOn || i.discreetOn;
}

/** Cover whenever the app is not the active, foreground app. "inactive" (iOS app switcher, control centre) and "background" both count. */
export function coverVisible(appState: string, enabled: boolean): boolean {
  return enabled && appState !== "active";
}

/**
 * Reads the two preferences. Best effort: a failed read of either counts as "off" for that one, never as a crash, but a failed
 * read of the discreet flag must not turn off a cover the app lock already asked for.
 */
/**
 * The discreet-mode answer comes from the server, so it is remembered for DISCREET_TTL_MS. Without that, every return to the app would
 * cost a session read and two queries for everyone with discreet mode on and App lock off, on mobile data. The App lock flag is a local
 * keystore read and is always read fresh, so turning App lock on or off in Settings applies at once. A failed read is not remembered.
 */
export const DISCREET_TTL_MS = 10 * 60_000;
let discreetCache: { value: boolean; at: number; account: string } | null = null;

/** Test seam. */
export function __resetCoverCache(): void {
  discreetCache = null;
}

export async function loadCoverEnabled(now: () => number = Date.now): Promise<boolean> {
  let appLockOn = false;
  let discreetOn = false;
  try {
    appLockOn = await readAppLockEnabled();
  } catch {
    appLockOn = false;
  }
  if (appLockOn) return true;
  try {
    const { data } = await supabase.auth.getSession();
    const id = data.session?.user.id;
    if (id) {
      if (discreetCache && discreetCache.account === id && now() - discreetCache.at < DISCREET_TTL_MS) {
        discreetOn = discreetCache.value;
      } else {
        const r = await loadNotificationSettings(id);
        if (r.ok) {
          discreetOn = r.data.discreet === true;
          discreetCache = { value: discreetOn, at: now(), account: id };
        }
      }
    }
  } catch {
    discreetOn = false;
  }
  return coverEnabled({ appLockOn, discreetOn });
}
