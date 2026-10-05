import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/** `platform_switches.key` for the platform-wide Pidgin kill switch (admin: /admin/settings/language). */
export const PIDGIN_SWITCH_KEY = "pidgin_language";

/**
 * Whether Pidgin is currently offered platform-wide. Fail-closed: if the switch
 * cannot be read for any reason the answer is false, so the app shows English,
 * the safe language, rather than Pidgin that an admin may have switched off.
 * Answerable signed out (the row is opted in for anon). Deduplicated per request.
 */
export const getPidginEnabled = cache(async (): Promise<boolean> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("platform_switch_is_on", { p_key: PIDGIN_SWITCH_KEY });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
});
