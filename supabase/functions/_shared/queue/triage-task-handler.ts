// S16: the event bus handler that turns a graded triage result into clinical tasks (spec 5, 7.3).
//
// Thin on purpose: the database function decides everything (mapping, due time, dedup, who is offered the
// task). This handler only refuses what must never create work. A shadow event (graded by a rule set the CMO has
// not approved, OQ-88) creates nothing, checked here AND in the database function, so a mistake in one layer
// cannot page a clinician from an unsigned rule set. Safe to run twice: the database merges a repeat.

import { PermanentHandlerError, type BusEvent, type Handler, type HandlerContext } from "../event-bus/dispatch.ts";

export const QUEUE_HANDLER_KEY = "queue.create_from_triage";

export interface QueuePorts {
  /** Calls public.create_tasks_from_triage_event and returns how many tasks it created or merged into. */
  createFromTriage(triageEventId: string): Promise<number>;
}

export function makeTriageTaskHandler(ports: QueuePorts): Handler {
  return async (event: BusEvent, _ctx: HandlerContext): Promise<void> => {
    const id = event.payload["triage_event_id"];
    if (typeof id !== "string" || id.length === 0) {
      throw new PermanentHandlerError("triage.graded payload has no triage_event_id");
    }
    if (event.payload["shadow"] === true) return;
    await ports.createFromTriage(id);
  };
}
