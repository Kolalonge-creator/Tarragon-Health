import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * RLS-scoped Supabase client authenticated via a bearer JWT rather than
 * Next's cookie store — for Route Handlers hit by the Expo mobile app,
 * which has no Next.js cookie session to read. PostgREST enforces RLS
 * using this token's `auth.uid()` exactly as it would for a
 * cookie-authenticated web request — never the service-role key, so a
 * caller can only ever read/write their own rows through this client.
 */
export function createBearerClient(accessToken: string) {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}
