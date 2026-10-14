import "server-only";
/**
 * Outbound MessagingGateway (spec §3.1, §10) — the LPE's implementation of the
 * engine's injected messaging boundary, over the existing `notifications`
 * queue. Outbound only, delivered in the app inbox.
 *
 * toneGuard runs at enqueue time on any free-text variables: a template that
 * would carry stigmatising or clinically-reassuring copy is refused rather than
 * queued (fail safe — never send unsafe copy). The INV-07 term list (check_notification_text)
 * runs over the same text, and a hit or a failed check refuses it too (OQ-94).
 */
import {
  toneGuard,
  type MessagingGateway,
  type OutboundMessage,
} from "@tarragon/lifestyle-engine";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export function createLifestyleMessagingGateway(
  organisationId: string,
): MessagingGateway {
  return {
    async send(message: OutboundMessage): Promise<{ ok: boolean }> {
      // toneGuard the free-text variable values before anything is queued.
      const freeText = Object.values(message.variables ?? {}).join(" ");
      if (freeText && !toneGuard(freeText).ok) {
        return { ok: false };
      }

      const svc = createServiceRoleClient();

      // OQ-94: the INV-07 term list at write time. The LLM-personalised message must not name a condition, reading, result or
      // medicine, because an inbox preview and a push can be read by anyone. A hit refuses the message; so does a failed
      // check, because this is a coaching nudge, not a safety message, and never worth the risk of a leak.
      if (freeText) {
        const { data: hits, error: checkError } = await (svc as unknown as {
          rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
        }).rpc("check_notification_text", { p_text: freeText });
        if (checkError || !Array.isArray(hits) || hits.length > 0) return { ok: false };
      }

      const { error } = await svc.from("notifications").insert({
        organisation_id: organisationId,
        recipient_id: message.patientId,
        channel: "in_app",
        template: message.templateKey,
        payload: {
          message_class: message.messageClass,
          ...(message.variables ?? {}),
        },
      });
      return { ok: !error };
    },
  };
}
