import * as SecureStore from "expo-secure-store";
import { supabase } from "./supabase";

/**
 * Mobile counterpart to apps/web/src/lib/auth/idle-timeout.ts — same
 * threshold, same "sign the session out after real inactivity" contract,
 * built for a reason that isn't obvious from the web file alone: Supabase's
 * own project-level `inactivity_timeout` (supabase/config.toml
 * [auth.sessions], enforced by GoTrue itself) does NOT actually catch a
 * foregrounded-but-untouched mobile app. That setting is only checked when a
 * session's refresh token is redeemed, and @supabase/supabase-js's
 * `autoRefreshToken` proactively refreshes on a timer roughly every
 * (access-token-lifetime minus ~60s) — regardless of whether a human has
 * touched anything — for as long as the JS runtime is alive, which on a
 * foregrounded app is continuously. A patient could leave the app open and
 * idle on a screen for hours and GoTrue would see nothing but a perfectly
 * healthy, regularly-refreshing session the whole time. This file is the
 * real enforcement; the GoTrue-level setting is a genuine but coarser
 * defense-in-depth backstop (a hard cap on a stolen/replayed refresh token
 * that isn't itself driving an auto-refreshing SDK), not a substitute — see
 * config.toml's own comment on [auth.sessions].
 *
 * "Activity" is any touch anywhere in the authenticated app shell (wired in
 * App.tsx via a root-level onTouchStart, deliberately non-capturing so it
 * never interferes with navigation/gesture handling) — the closest mobile
 * analogue to the web file's "any request reaching the proxy while
 * authenticated". Persisted to SecureStore (not just an in-memory variable)
 * so idle time keeps accruing correctly across an app kill+relaunch: a
 * patient who backgrounds the app, has it evicted by the OS, and reopens it
 * 45 minutes later must still be treated as idle-expired, not given a fresh
 * clock just because the JS process restarted.
 */

const LAST_ACTIVITY_KEY = "idle-timeout-last-seen-v1";

export const IDLE_TIMEOUT_MS = (() => {
  const minutes = Number(process.env.EXPO_PUBLIC_IDLE_TIMEOUT_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60 * 1000;
})();

/** True when `lastSeen` is old enough that the session should be treated as
 * idle-expired. `null` (never stamped — e.g. right after a fresh sign-in,
 * before the first touch) is NOT idle, matching the web file's identical
 * "missing means never stamped" reasoning. Pure and exported for direct
 * unit testing, same shape as the web file's isSessionIdle. */
export function isIdleExpired(lastSeen: number | null, now: number): boolean {
  if (lastSeen === null) return false;
  return now - lastSeen > IDLE_TIMEOUT_MS;
}

/** Best-effort — matches app-lock.ts's own posture (SecureStore I/O must
 * never crash a touch handler). A write failure just means the next check
 * falls back to whatever was last successfully stamped (or null), never
 * blocks the touch itself. */
export async function stampActivity(now: number = Date.now()): Promise<void> {
  try {
    await SecureStore.setItemAsync(LAST_ACTIVITY_KEY, String(now));
  } catch {
    // Best-effort — see comment above.
  }
}

async function readLastActivity(): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(LAST_ACTIVITY_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    // Fail closed here would lock a patient out on a transient SecureStore
    // read error; fail open (treat as "never stamped", i.e. not idle) —
    // matches every other SecureStore read in this app (app-lock.ts).
    return null;
  }
}

async function clearActivity(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(LAST_ACTIVITY_KEY);
  } catch {
    // Best-effort.
  }
}

/**
 * Reads the persisted last-activity timestamp and signs the session out if
 * it's idle-expired. Called (a) on every transition to AppState "active" —
 * catches a session that went idle-expired while backgrounded, since JS
 * timers don't reliably run then — and (b) on a periodic interval while
 * foregrounded, both wired in App.tsx.
 *
 * Deliberately calls supabase.auth.signOut() directly rather than the
 * cookie-jar-surgery approach apps/web/src/lib/auth/idle-timeout.ts uses:
 * that web-specific workaround exists only because of a cookie-storage
 * closure-capture quirk in Next.js middleware (see that file's own header
 * comment) — the mobile client has no such indirection, so a plain
 * signOut() genuinely clears the SecureStore-persisted session and fires
 * onAuthStateChange(SIGNED_OUT), which App.tsx already listens for and
 * reacts to (falls through to LoginScreen) with no further wiring needed
 * here.
 *
 * Returns true iff it actually signed the session out — callers use this
 * only for their own logging/testing, never as a condition for anything
 * else, so a failed signOut() call is swallowed rather than surfaced: an
 * idle-expired session that fails to sign out this pass will be caught by
 * the very next check (the next AppState resume or interval tick), and a
 * thrown error here must not crash whatever caller invoked it (an
 * AppState listener or a setInterval callback, neither has anywhere useful
 * to surface an exception).
 */
export async function checkIdleAndMaybeSignOut(now: number = Date.now()): Promise<boolean> {
  const lastSeen = await readLastActivity();
  if (!isIdleExpired(lastSeen, now)) {
    return false;
  }
  try {
    await supabase.auth.signOut();
  } catch {
    return false;
  }
  await clearActivity();
  return true;
}
