import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * INV-14: the `result_passport_enabled` go-live guard, checked on the server before the glucose and lab sections of the PDF are built, and
 * by the passport page. The database answers through `go_live_guard_is_open`: open when the guard is on, or when the signed-in person is a
 * test account. Fails closed: an RPC error, a missing session or an unexpected answer is "closed".
 */
export const PASSPORT_GUARD_KEY = "result_passport_enabled";

export async function isPassportOpen(supabase: SupabaseClient<Database>): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("go_live_guard_is_open", { p_key: PASSPORT_GUARD_KEY });
    return !error && data === true;
  } catch {
    return false;
  }
}
