import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { hasCoachAccess } from "./entitlement";
import { isAssistantOpen } from "./guard";

/**
 * S51 (INV-14): should a screen DRAW the assistant? Yes only when the assistant_enabled go-live guard is open AND the patient is
 * entitled. Kept apart from `hasCoachAccess` (entitlement only) so "not open yet" is never reported as "not on your plan". The server
 * paths (runCoachTurn, runQuickAction, the mobile routes) check the guard themselves; this only keeps screens from showing it early.
 */
export async function isAssistantOffered(supabase: SupabaseClient<Database>): Promise<boolean> {
  const [open, entitled] = await Promise.all([isAssistantOpen(supabase), hasCoachAccess(supabase)]);
  return open && entitled;
}
