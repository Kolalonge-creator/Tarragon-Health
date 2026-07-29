import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type { Database, Json } from "./database.types";
export type TarragonClient = SupabaseClient<Database>;

/**
 * Thin factory over supabase-js typed against the v3 schema. Callers supply their own
 * url/key (anon or service role) -- this package never reads env vars directly, since
 * apps/patient (Expo), apps/console (Next.js) and apps/screening (Expo) each source
 * config differently.
 */
export function createTarragonClient(url: string, key: string): TarragonClient {
  return createClient<Database>(url, key);
}
