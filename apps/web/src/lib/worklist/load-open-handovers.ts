import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export type OpenHandover = Database["public"]["Functions"]["open_escalation_handovers"]["Returns"][number];

/**
 * G10: waiting handovers that involve the caller (all of the organisation's for the CMO). Null when the read failed, so a page
 * says so instead of showing an empty all-clear ("unknown is not zero").
 */
export async function loadOpenHandovers(supabase: SupabaseClient<Database>): Promise<OpenHandover[] | null> {
  const { data, error } = await supabase.rpc("open_escalation_handovers");
  return error ? null : (data ?? []);
}
