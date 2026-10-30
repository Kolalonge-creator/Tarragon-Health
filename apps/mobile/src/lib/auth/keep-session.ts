import type { Session } from "@supabase/supabase-js";

/**
 * supabase-js re-emits an auth event (SIGNED_IN, TOKEN_REFRESHED) whenever the app returns to the foreground or the
 * session is re-read, each time with a new Session object even when nothing about it changed. App.tsx keyed its
 * identity load and all of the patient background work on that object, so a system sheet that flips the app between
 * active and inactive (the HealthKit authorisation sheet does) restarted the whole chain every time: identity reset,
 * home shell remounted, push token and HealthKit registered again. That loop ran about 17 times a second.
 *
 * Keep the previous object when it is the same person on the same access token.
 */
export function keepSessionIfSame(
  previous: Session | null | undefined,
  next: Session | null,
): Session | null | undefined {
  if (previous && next && previous.user.id === next.user.id && previous.access_token === next.access_token) {
    return previous;
  }
  return next;
}
