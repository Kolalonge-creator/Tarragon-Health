import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoachChatMessage, CoachTier, Database, Json } from "@tarragon/shared";
import { buildCoachGraph, type CoachGraphDeps } from "./graph";
import { COACH_LIMIT_REACHED_REPLY, countMessagesToday, getCoachDailyLimit } from "./rate-limit";

export interface RunCoachTurnParams {
  supabase: SupabaseClient<Database>;
  getServiceRoleSupabase: () => SupabaseClient<Database>;
  profileId: string;
  organisationId: string;
  /** Omit to start a new conversation thread. */
  conversationId?: string;
  message: string;
  model?: CoachGraphDeps["model"];
}

export interface RunCoachTurnResult {
  conversationId: string;
  reply: string;
  tier: CoachTier;
}

/** Cap on how much history is sent to Claude for context — not a cap on
 * what's persisted. Keeping these separate matters: an earlier version of
 * this function reused the windowed slice as the base for saving, which
 * silently dropped everything older than the window on every single turn. */
const CONTEXT_HISTORY_LIMIT = 20;

async function appendMessages(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  fullMessages: CoachChatMessage[],
  newMessages: CoachChatMessage[]
): Promise<void> {
  await supabase
    .from("ai_conversations")
    .update({ messages: [...fullMessages, ...newMessages] as unknown as Json })
    .eq("id", conversationId);
}

/** Transport-agnostic AI Coach turn — takes a profile + message, runs the
 * LangGraph flow, and returns the reply. Callable from a server action
 * today; the same function is what a future WhatsApp webhook route would
 * call too, so it doesn't assume anything about how it was invoked. */
export async function runCoachTurn(params: RunCoachTurnParams): Promise<RunCoachTurnResult> {
  const { supabase, getServiceRoleSupabase, profileId, organisationId, message } = params;

  let conversationId = params.conversationId;
  let fullMessages: CoachChatMessage[] = [];

  if (conversationId) {
    const { data } = await supabase
      .from("ai_conversations")
      .select("id, messages")
      .eq("id", conversationId)
      .maybeSingle();
    if (data) {
      fullMessages = (data.messages as CoachChatMessage[] | null) ?? [];
    } else {
      conversationId = undefined;
    }
  }

  if (!conversationId) {
    const { data, error } = await supabase
      .from("ai_conversations")
      .insert({ organisation_id: organisationId, profile_id: profileId })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? "Could not start a conversation");
    }
    conversationId = data.id;
  }

  const [messagesToday, dailyLimit] = await Promise.all([
    countMessagesToday(supabase, profileId),
    getCoachDailyLimit(supabase),
  ]);
  if (messagesToday >= dailyLimit) {
    // Skip the graph entirely — the whole point is to avoid the Claude call,
    // not just decline to show its result.
    const now = new Date().toISOString();
    const userMessage: CoachChatMessage = { id: crypto.randomUUID(), role: "user", content: message, created_at: now };
    const assistantMessage: CoachChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: COACH_LIMIT_REACHED_REPLY,
      tier: "routine",
      created_at: now,
    };
    await appendMessages(supabase, conversationId, fullMessages, [userMessage, assistantMessage]);
    return { conversationId, reply: COACH_LIMIT_REACHED_REPLY, tier: "routine" };
  }

  const graph = buildCoachGraph({ supabase, getServiceRoleSupabase, model: params.model });
  const result = await graph.invoke({
    profileId,
    organisationId,
    conversationId,
    incomingMessage: message,
    priorMessages: fullMessages.slice(-CONTEXT_HISTORY_LIMIT),
  });

  const tier = result.tier ?? "routine";
  const now = new Date().toISOString();
  const userMessage: CoachChatMessage = { id: crypto.randomUUID(), role: "user", content: message, created_at: now };
  const assistantMessage: CoachChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: result.reply,
    tier,
    created_at: now,
  };
  await appendMessages(supabase, conversationId, fullMessages, [userMessage, assistantMessage]);

  return { conversationId, reply: result.reply, tier };
}
