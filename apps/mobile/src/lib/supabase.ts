import "react-native-url-polyfill/auto";
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
