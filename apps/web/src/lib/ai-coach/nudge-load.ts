import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { loadPatientContext } from "./context";
import { isAssistantOpen } from "./guard";
import { buildDailyNudge, buildWeeklyReflection, type DailyNudge, type WeeklyReflection } from "./nudges";

export type AssistantNudges = { open: false } | { open: true; daily: DailyNudge; weekly: WeeklyReflection };

/** The patient's nudge and weekly reflection, built from their own data on request. Closed (and nothing read) while the guard is closed. */
export async function loadAssistantNudges(supabase: SupabaseClient<Database>, profileId: string): Promise<AssistantNudges> {
  if (!(await isAssistantOpen(supabase))) return { open: false };
  const context = await loadPatientContext(supabase, profileId);
  const [daily, weekly] = await Promise.all([buildDailyNudge(supabase, profileId, context), buildWeeklyReflection(supabase, profileId)]);
  return { open: true, daily, weekly };
}
