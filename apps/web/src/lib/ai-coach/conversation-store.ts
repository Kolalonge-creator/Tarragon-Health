import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoachChatMessage, Database, Json } from "@tarragon/shared";

/** Shared conversation persistence for every AI-assistant surface that
 * writes into ai_conversations — the chat turn (index.ts) and the
 * composed-surface quick actions (quick-actions.ts) alike, so both follow
 * the same "read full history, append, write back" shape rather than two
 * copies drifting apart. */

export async function resolveOrCreateConversation(
  supabase: SupabaseClient<Database>,
  organisationId: string,
  profileId: string,
  conversationId: string | undefined
): Promise<{ conversationId: string; fullMessages: CoachChatMessage[] }> {
  let resolvedId = conversationId;
  let fullMessages: CoachChatMessage[] = [];

  if (resolvedId) {
    const { data } = await supabase
      .from("ai_conversations")
      .select("id, messages")
      .eq("id", resolvedId)
      .maybeSingle();
    if (data) {
      fullMessages = (data.messages as CoachChatMessage[] | null) ?? [];
    } else {
      resolvedId = undefined;
    }
  }

  if (!resolvedId) {
    const { data, error } = await supabase
      .from("ai_conversations")
      .insert({ organisation_id: organisationId, profile_id: profileId })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? "Could not start a conversation");
    }
    resolvedId = data.id;
  }

  return { conversationId: resolvedId, fullMessages };
}

export async function appendMessages(
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
