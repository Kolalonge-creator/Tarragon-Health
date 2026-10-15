import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * S51: assistant events through the S10 outbox (`emit_domain_event`, service role only). Payloads carry ids, tiers and codes, never the
 * text of a message or anything clinical (INV-07 applies to what a subscriber may later forward). Best effort and idempotent: the
 * patient's turn never waits on, or fails because of, an event (core features never depend on a send succeeding).
 */
export type AssistantEvent =
  | { type: "assistant.message"; conversationId: string; tier: string; turnKey: string }
  | { type: "assistant.red_flag_detected"; conversationId: string; trigger: "keyword" | "model" | "self_harm"; turnKey: string }
  | { type: "assistant.handoff"; conversationId: string; target: "symptom_checker" | "care_team"; turnKey: string };

export async function emitAssistantEvent(
  svc: SupabaseClient<Database>,
  organisationId: string,
  patientId: string,
  event: AssistantEvent,
): Promise<boolean> {
  const payload =
    event.type === "assistant.message"
      ? { conversation_id: event.conversationId, tier: event.tier }
      : event.type === "assistant.red_flag_detected"
        ? { conversation_id: event.conversationId, trigger: event.trigger }
        : { conversation_id: event.conversationId, target: event.target };
  try {
    // emit_domain_event is not in the generated types yet (S10 predates the last regeneration); the cast is the repo's precedent for that.
    const { error } = await (svc as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }> }).rpc(
      "emit_domain_event",
      {
        p_event_type: event.type,
        p_organisation_id: organisationId,
        p_payload: payload,
        p_idempotency_key: `${event.type}:${event.conversationId}:${event.turnKey}`,
        p_patient_id: patientId,
        p_aggregate_type: "ai_conversations",
        p_aggregate_id: event.conversationId,
        p_priority: "normal",
      },
    );
    if (error) {
      console.error("ai-coach: assistant event not recorded", event.type, error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error("ai-coach: assistant event threw", event.type, error);
    return false;
  }
}
