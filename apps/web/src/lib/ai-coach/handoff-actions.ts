"use server";

import { z } from "zod";
import type { CoachChatMessage } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildCoachHandoffSummary } from "./handoff-summary";
import { loadHandoffSnapshot } from "./escalate";

const conversationIdSchema = z.string().uuid().optional();

export type SpeakToSomeoneResult =
  | { success: true; threadId: string }
  | { success: false; error: string };

/**
 * §78.12 "I want to speak to someone" -- a patient-REQUESTED handoff,
 * distinct from the automatic tier-triggered escalation ai-coach/escalate.ts
 * already does. Opens a real care_messages thread (the platform's actual
 * in-app patient<->care-team channel, not WhatsApp — see CLAUDE.md's
 * two-way-conversation-is-in-app-only rule) pre-filled with the same
 * structured summary shape as an automatic escalation, so whoever picks it
 * up doesn't have to re-read the whole chat.
 *
 * Deliberately calls start_care_thread on the PATIENT's own RLS-scoped
 * session, not service-role: private.enforce_care_message_author() stamps
 * author_role from auth.uid(), and a service-role call has no auth.uid() to
 * stamp — this is the patient's own message, sent on their own behalf, so
 * their own session is the correct caller.
 */
export async function requestCareTeamHandoffAction(
  conversationId: string | undefined
): Promise<SpeakToSomeoneResult> {
  const parsedId = conversationIdSchema.safeParse(conversationId);
  if (!parsedId.success) return { success: false, error: "Invalid conversation" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not signed in" };

  let recentMessages: CoachChatMessage[] = [];
  if (parsedId.data) {
    const { data: conversation } = await supabase
      .from("ai_conversations")
      .select("messages")
      .eq("id", parsedId.data)
      .maybeSingle();
    recentMessages = ((conversation?.messages as CoachChatMessage[] | null) ?? []).slice(-10);
  }

  const svc = createServiceRoleClient();
  const snapshot = await loadHandoffSnapshot(svc, user.id);
  const body = await buildCoachHandoffSummary({
    recentMessages,
    triggerMessage:
      recentMessages.filter((m) => m.role === "user").at(-1)?.content ??
      "Patient asked to speak with someone directly, without a specific message.",
    aiAction: "Patient asked to speak with a person instead of continuing with the AI Coach",
    medications: snapshot.medications,
    conditions: snapshot.conditions,
  });

  const { data: threadId, error } = await supabase.rpc("start_care_thread", {
    p_subject: "From your AI Coach conversation",
    p_body: body,
  });
  if (error || !threadId) {
    return { success: false, error: error?.message ?? "Could not start a conversation with your care team" };
  }

  return { success: true, threadId };
}
