import "react-native-url-polyfill/auto";
import { AppState } from "react-native";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import type { Database } from "@tarragon/shared";

/**
 * Session storage backed by the OS keychain/keystore (via expo-secure-store)
 * rather than AsyncStorage — the Supabase session includes a refresh token,
 * which shouldn't sit in plaintext storage on the device.
 */
const SecureStoreSessionAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

/**
 * Same project as the web app (apps/web/src/lib/supabase/client.ts) — the
 * mobile app is an additional authenticated client against the same
 * Supabase project, not a separate backend. RLS applies identically.
 */
export const supabase = createClient<Database>(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: SecureStoreSessionAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);

/**
 * Supabase's own documented React Native requirement
 * (https://supabase.com/docs/guides/auth/quickstarts/react-native) —
 * autoRefreshToken above needs to be told when the app is foregrounded vs.
 * backgrounded, or it keeps trying (and failing) to refresh while
 * backgrounded, and won't reliably resume once the app returns. This was
 * previously missing entirely. Also closes the door on a subtler effect:
 * without this, the refresh timer runs continuously regardless of
 * foreground state, which is part of why Supabase's project-level
 * `inactivity_timeout` alone can't be relied on as a real idle-timeout for
 * this app — see lib/idle-timeout.ts's header comment.
 *
 * Guarded by a `globalThis` flag, not a module-level `let` — Supabase's own
 * docs say to "register the listener only once", but a plain module-level
 * guard doesn't actually survive Metro Fast Refresh re-evaluating this
 * module during normal local development (edit-and-save on this very file,
 * or anything that invalidates its module cache entry), which would
 * silently register a second listener each time and double-call
 * startAutoRefresh()/stopAutoRefresh() per transition. `globalThis` persists
 * across a Fast Refresh module re-evaluation, so this guard actually holds
 * in the one situation it exists to cover; a production cold start only
 * ever evaluates this module once regardless.
 */
const AUTO_REFRESH_LISTENER_GUARD = "__tarragonAutoRefreshListenerRegistered";
if (!(globalThis as Record<string, unknown>)[AUTO_REFRESH_LISTENER_GUARD]) {
  (globalThis as Record<string, unknown>)[AUTO_REFRESH_LISTENER_GUARD] = true;
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  });
}
