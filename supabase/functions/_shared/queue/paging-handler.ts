// S19: the event bus handler that pages the clinician on call for a red triage grade (spec 7.9, INV-05).
//
// Thin on purpose: the database function decides everything (who is on call, whether the grade is red and approved,
// the notifications, the no-cover path). This handler only refuses what must never page. A shadow event (graded by a
// rule set the CMO has not approved, OQ-88) pages nobody, checked here AND in the database function, so a mistake in one
// layer cannot page a clinician from an unsigned rule set. Safe to run twice: the database returns the existing page.
// A failure must reach the bus (retry, then dead letter): a red event that cannot be paged must never be dropped quietly.

import { PermanentHandlerError, type BusEvent, type Handler, type HandlerContext } from "../event-bus/dispatch.ts";

export const PAGING_HANDLER_KEY = "paging.create_from_triage";

export interface PagingPorts {
  /** Calls public.create_red_page. Returns the root page id, or null when the event is not one that pages. */
  createRedPage(triageEventId: string): Promise<string | null>;
}

export function makePagingHandler(ports: PagingPorts): Handler {
  return async (event: BusEvent, _ctx: HandlerContext): Promise<void> => {
    const id = event.payload["triage_event_id"];
    if (typeof id !== "string" || id.length === 0) {
      throw new PermanentHandlerError("triage.graded payload has no triage_event_id");
    }
    if (event.payload["shadow"] === true) return;
    await ports.createRedPage(id);
  };
}
