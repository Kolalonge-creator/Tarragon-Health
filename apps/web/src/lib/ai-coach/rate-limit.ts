import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoachChatMessage, Database } from "@tarragon/shared";
import { startOfLagosDayUtc } from "./lagos-day";

/** Last-resort default when nothing admin-configured applies — see
 * getCoachDailyLimit() below for the per-plan/per-patient/org-wide
 * overrides admin can set instead. Each message risks a real Claude API
 * charge, so this defaults conservatively. */
export const COACH_DAILY_MESSAGE_LIMIT = Number(process.env.AI_COACH_DAILY_MESSAGE_LIMIT ?? 20);

export const COACH_LIMIT_REACHED_REPLY =
  "You've reached today's message limit for the coach — it resets tomorrow. If something feels urgent in the meantime, please contact your care team directly.";

/**
 * Resolves via public.get_ai_coach_daily_limit() (migration
 * 20260707030000_ai_coach_daily_limits.sql): admins get no effective cap;
 * otherwise an admin-set per-patient override wins, then the most generous
 * cap across the patient's active/trialing subscription plans (so "free vs
 * standard vs premium vs family" can each get a different allowance), then
 * an admin-set org-wide default. Falls back to COACH_DAILY_MESSAGE_LIMIT
 * only if none of those are configured. A security-definer RPC for the same
 * reason as hasCoachAccess() — the backing tables are admin-only.
 */
export async function getCoachDailyLimit(supabase: SupabaseClient<Database>): Promise<number> {
  const { data, error } = await supabase.rpc("get_ai_coach_daily_limit");
  if (error || data == null) return COACH_DAILY_MESSAGE_LIMIT;
  return data;
}

/** Counts today's patient-authored messages across all of a profile's coach
 * conversations, so the cap holds even if they start a new thread. Counted
 * straight from Postgres (ai_conversations.messages), not Redis — nothing
 * in this codebase uses Upstash yet, and per-patient message volume is
 * inherently bounded by this same cap, so a jsonb scan is cheap enough. */
export async function countMessagesToday(
  supabase: SupabaseClient<Database>,
  profileId: string,
  now: Date = new Date()
): Promise<number> {
  const startOfDayIso = startOfLagosDayUtc(now).toISOString();

  const { data } = await supabase
    .from("ai_conversations")
    .select("messages")
    .eq("profile_id", profileId)
    .gte("updated_at", startOfDayIso);

  return (data ?? []).reduce((count, row) => {
    const messages = (row.messages as CoachChatMessage[] | null) ?? [];
    return count + messages.filter((m) => m.role === "user" && m.created_at >= startOfDayIso).length;
  }, 0);
}
