"use server";

import { createClient } from "@/lib/supabase/server";
import { loadAssistantNudges, type AssistantNudges } from "./nudge-load";

/** S51 (7.5): today's one nudge and the weekly reflection for the signed-in patient. */
export async function getAssistantNudgesAction(): Promise<AssistantNudges> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { open: false };
  try {
    return await loadAssistantNudges(supabase, user.id);
  } catch {
    return { open: false };
  }
}
