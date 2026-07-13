import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@tarragon/shared";

/**
 * Server Supabase client — for Server Components, Server Actions, and Route
 * Handlers. Reads/writes the session via Next's cookie store, so RLS is
 * enforced with the caller's own JWT (never the service-role key).
 *
 * Wrapped in React.cache() so every call site within one request/render
 * pass shares the same client instead of each constructing its own — this
 * alone doesn't dedupe network calls (see getCurrentUser below for that),
 * but avoids redundant client setup.
 */
export const createClient = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — the proxy already refreshes
            // the session, so a failed write here is safe to ignore.
          }
        },
      },
    }
  );
});

/**
 * The signed-in caller's own auth user, deduped per request via
 * React.cache() — without this, every layout/page/query-helper that needs
 * the caller's identity (there are over a dozen) independently calls
 * supabase.auth.getUser(), each a separate network round-trip to Supabase
 * Auth. A single /admin page load was measured making 3+ of these calls
 * before any prefetching; that fan-out compounds badly when a session's
 * refresh token is invalid, since each independent call attempts its own
 * refresh.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
