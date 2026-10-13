// S10x-b: the bus handler behind the partner.webhook subscribers. Thin on purpose: the database function decides what is sent
// (an ids-only envelope, sandbox endpoints for test events, idempotent on the bus event id). A failure must reach the bus
// (retry, then dead letter) so a partner event is never dropped quietly.

import { PermanentHandlerError, type BusEvent, type Handler, type HandlerContext } from "./dispatch.ts";

export const PARTNER_WEBHOOK_HANDLER_KEY = "partner.webhook";

export interface PartnerWebhookPorts {
  /** Calls public.partner_webhook_enqueue_for_delivery. Returns how many endpoint rows were queued, or -1 when the mapping no longer exists. */
  enqueue(deliveryId: string): Promise<number>;
}

export function makePartnerWebhookHandler(ports: PartnerWebhookPorts): Handler {
  return async (event: BusEvent, _ctx: HandlerContext): Promise<void> => {
    if (!event.deliveryId) throw new PermanentHandlerError("partner.webhook delivery has no id");
    await ports.enqueue(event.deliveryId);
  };
}
