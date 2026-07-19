import "server-only";
/**
 * Outbound MessagingGateway (spec §3.1, §10) — the LPE's implementation of the
 * engine's injected messaging boundary, over the existing `notifications`
 * queue. Outbound only; WhatsApp is never a logging surface.
 *
 * toneGuard runs at enqueue time on any free-text variables: a template that
 * would carry stigmatising or clinically-reassuring copy is refused rather than
 * queued (fail safe — never send unsafe copy).
 */
import {
  toneGuard,
  type MessagingGateway,
  type OutboundMessage,
} from "@tarragon/lifestyle-engine";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/** Message classes that go out over WhatsApp (all of them today). */
function channelFor(): "whatsapp" {
  return "whatsapp";
}

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
      const { error } = await svc.from("notifications").insert({
        organisation_id: organisationId,
        recipient_id: message.patientId,
        channel: channelFor(),
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
