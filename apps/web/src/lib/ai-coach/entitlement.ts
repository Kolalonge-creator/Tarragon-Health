import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

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
