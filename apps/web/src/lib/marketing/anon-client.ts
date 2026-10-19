import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The one anon Supabase client the marketing tree is allowed to build.
 *
 * Deliberately a BARE supabase-js client rather than `@/lib/supabase/server`:
 * marketing pages must not import auth/platform modules (see
 * docs/MARKETING_SITE_SPEC.md §4). Every public marketing loader reads through
 * this, so they all resolve the key the same way.
 *
 * Both key env-var names are accepted on purpose. Supabase renamed the browser
 * key from `anon` to `publishable`, and before this helper existed
 * plan-prices.ts alone read `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
 * NEXT_PUBLIC_SUPABASE_ANON_KEY` while six sibling loaders read only
 * `..._ANON_KEY` — so a rename would have silently blanked six pages (every
 * loader here fails soft, so the symptom is empty content, not an error) while
 * pricing kept working. Accept both in one place instead.
 *
 * Returns null when neither the URL nor a key is configured, so callers keep
 * their existing "degrade to static copy" path instead of throwing.
 */
export function marketingAnonKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export const MARKETING_FETCH_TIMEOUT_MS = 10_000;

export function marketingAnonClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = marketingAnonKey();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    // supabase-js has no request timeout of its own. These loaders run while
    // Next prerenders the public pages, where one stalled call holds the
    // build's single worker and every page in flight times out with it
    // (production builds failed this way 2026-10-17/18). Every loader fails
    // soft, so a call that gives up costs a section its live data, not a build.
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(MARKETING_FETCH_TIMEOUT_MS) }),
    },
  });
}
