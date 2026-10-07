import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * INV-14 (S51): the assistant_enabled go-live guard, checked on the server for every assistant turn and every assistant quick action.
 * Fails closed: an RPC error, a missing session or an unknown answer is "closed". The database answers through
 * `go_live_guard_is_open`, which is open when the guard is on, or when the signed-in person is an is_test account (so the assistant
 * can be exercised end to end with test accounts before the guard is on). A real person is never reachable while it is off.
 */
export const ASSISTANT_GUARD_KEY = "assistant_enabled";

export const ASSISTANT_NOT_OPEN_REPLY =
  "The assistant is not open yet. If you need help now, send your care team a message in the app, and for anything urgent go to the nearest hospital.";

export async function isAssistantOpen(supabase: SupabaseClient<Database>): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("go_live_guard_is_open", { p_key: ASSISTANT_GUARD_KEY });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

/**
 * The guard's own switch, read with the service role (no signed-in person, so `go_live_guard_is_open` cannot be used). For batch jobs
 * only (the nudge cron, the silence signal, the monthly sampler). null means "could not be read": the caller must treat that as closed.
 * go_live_guards is not in the generated types yet, hence the narrow cast.
 */
export async function readAssistantGuardIsOn(svc: SupabaseClient<Database>): Promise<boolean | null> {
  try {
    const loose = svc as unknown as {
      from: (t: string) => {
        select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { is_on: boolean } | null; error: unknown }> } };
      };
    };
    const { data, error } = await loose.from("go_live_guards").select("is_on").eq("key", ASSISTANT_GUARD_KEY).maybeSingle();
    if (error) return null;
    return data?.is_on === true;
  } catch {
    return null;
  }
}
