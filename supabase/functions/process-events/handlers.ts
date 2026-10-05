// Handler registry for the event bus (S10). A subscriber row names a handler_key; the code for it is
// registered here. S11 onward add their handlers (triage, tasks, paging, notifications) to this map.
// Rules for a handler: safe to run twice (use ctx.once for side effects), read patient records
// through the audited path rather than the payload, and never put a reading, condition or result in
// a notification (INV-07).

import { noopHandler, type HandlerRegistry } from "../_shared/event-bus/dispatch.ts";

export const handlers: HandlerRegistry = {
  "bus.noop": noopHandler,
};
