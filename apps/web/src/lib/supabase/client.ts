import { createBrowserClient } from "@supabase/ssr";
import type { AppDatabase } from "@tarragon/shared";

/** Browser Supabase client — safe to call from Client Components. */
export function createClient() {
  return createBrowserClient<AppDatabase>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
