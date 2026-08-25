import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/** Colocated with hasCoachAccess() the way COACH_LIMIT_REACHED_REPLY sits
 * next to the rate-limit functions in rate-limit.ts — the reply a caller
 * shows when runCoachTurn's own entitlement check (not just the UI gate)
 * turns a patient away. */
export const COACH_ACCESS_DENIED_REPLY =
  "The AI Coach isn't included on your current plan. Contact your care team if you think this is a mistake.";

/**
 * Resolves via private.has_ai_coach_access() (migration
 * 20260707010000_ai_coach_access_rules.sql): admins always pass; otherwise
 * an admin-set per-patient rule wins, then an admin-set global "everyone"
 * rule, then falls back to the subscription-plan 'ai_coach' feature flag.
 * A security-definer RPC rather than a direct table read, because the
 * backing ai_coach_access_rules table is admin-only — a patient's own
 * session can't select from it, only ask "do *I* have access".
 */
export async function hasCoachAccess(
  supabase: SupabaseClient<Database>
): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_ai_coach_access");
  if (error) return false;
  return data ?? false;
}
