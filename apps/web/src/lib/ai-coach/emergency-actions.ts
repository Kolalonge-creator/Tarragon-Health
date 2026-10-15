"use server";

import type { EmergencyAddendumInput } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { loadEmergencyContext } from "@/lib/ai-coach/nearest-hospital";

/**
 * S52 (7.8): the nearest hospitals and the signed-in patient's own emergency contact, for the emergency button. Read on the patient's own
 * session (RLS: their own profile, the shared facilities directory). Bounded and best effort: the bundled guidance never waits on it.
 */
export async function getEmergencyContextAction(): Promise<EmergencyAddendumInput> {
  const empty: EmergencyAddendumInput = { hospitals: [], contactName: null, contactPhone: null };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return empty;
    return await loadEmergencyContext(supabase, user.id);
  } catch {
    return empty;
  }
}
