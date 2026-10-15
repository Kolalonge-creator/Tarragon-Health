import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { emitAssistantEvent } from "./events";
import { isAssistantOpen } from "./guard";

export const prepDraftSchema = z.object({
  text: z.string().trim().min(10, "Write a little more before sending").max(4000, "That is a little long. Please shorten it"),
  conversationId: z.string().uuid().optional(),
});

export type SendPrepDraftResult = { success: true; threadId: string } | { success: false; error: string };

/**
 * S51 (7.7, INV-11): sends the pre-visit message the PATIENT has read, edited and approved. The assistant's draft is never sent by
 * itself and never written to the record: this runs only from the patient's own press of "Send to my care team", on their own
 * session (start_care_thread stamps the author from auth.uid()), and what is sent is the text they approved, not the draft.
 */
export async function sendApprovedPrepDraft(params: {
  supabase: SupabaseClient<Database>;
  getServiceRoleSupabase: () => SupabaseClient<Database>;
  profileId: string;
  organisationId: string;
  input: unknown;
}): Promise<SendPrepDraftResult> {
  const parsed = prepDraftSchema.safeParse(params.input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid message" };
  // INV-14: part of the assistant, so behind the same guard (closed for real patients until it is on; is_test accounts can exercise it).
  if (!(await isAssistantOpen(params.supabase))) {
    return { success: false, error: "This is not open yet. You can message your care team directly in the app." };
  }
  // The conversation must be the caller's own (RLS-scoped read plus an explicit owner check) BEFORE anything is sent or any event is written.
  if (parsed.data.conversationId) {
    const { data: own } = await params.supabase
      .from("ai_conversations")
      .select("id")
      .eq("id", parsed.data.conversationId)
      .eq("profile_id", params.profileId)
      .maybeSingle();
    if (!own) return { success: false, error: "We could not find that conversation." };
  }
  const { data: threadId, error } = await params.supabase.rpc("start_care_thread", {
    p_subject: "Before my appointment",
    p_body: parsed.data.text,
  });
  if (error || !threadId) {
    return { success: false, error: error?.message ?? "Could not send your message. Please try again, or message your care team directly." };
  }
  if (parsed.data.conversationId) {
    await emitAssistantEvent(params.getServiceRoleSupabase(), params.organisationId, params.profileId, {
      type: "assistant.handoff",
      conversationId: parsed.data.conversationId,
      target: "care_team",
      turnKey: `prep-draft:${threadId}`,
    });
  }
  return { success: true, threadId };
}
