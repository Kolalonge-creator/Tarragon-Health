import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@tarragon/shared";

/**
 * Server Supabase client — for Server Components, Server Actions, and Route
 * Handlers. Reads/writes the session via Next's cookie store, so RLS is
 * enforced with the caller's own JWT (never the service-role key).
 */
export async function createClient() {
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
}
