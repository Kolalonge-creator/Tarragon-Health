// S58: the event bus handler that awards Health Points (spec 11.1).
//
// Thin on purpose: the database function public.points_award decides everything (which rules match, plausibility, caps,
// decay, the daily limit, minors) and is idempotent per event and rule, so running this twice, or replaying a delivery,
// never awards twice. This handler only passes the event id. It never reads a reading, never decides a number and never
// sends a notification (INV-07). A failure goes back to the bus (retry, then dead letter) so a lost award is visible.

import { PermanentHandlerError, type BusEvent, type Handler, type HandlerContext } from "../event-bus/dispatch.ts";

export const POINTS_HANDLER_KEY = "points.award";

export interface PointsPorts {
  /** Calls public.points_award(event_id). Returns the points credited (0 when nothing applied or on a replay). */
  award(eventId: string): Promise<number>;
}

export function makePointsHandler(ports: PointsPorts): Handler {
  return async (event: BusEvent, _ctx: HandlerContext): Promise<void> => {
    if (typeof event.eventId !== "string" || event.eventId.length === 0) {
      throw new PermanentHandlerError("points delivery has no event id");
    }
    // A person-less event cannot earn anything; the database also returns 0, this just avoids the call.
    if (event.patientId === null) return;
    await ports.award(event.eventId);
  };
}
