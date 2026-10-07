// Handler registry for the event bus (S10). A subscriber row names a handler_key; the code for it is
// registered here. S11 onward add their handlers (triage, tasks, paging, notifications) to this map.
// Rules for a handler: safe to run twice (use ctx.once for side effects), read patient records
// through the audited path rather than the payload, and never put a reading, condition or result in
// a notification (INV-07).

import { noopHandler, type HandlerRegistry } from "../_shared/event-bus/dispatch.ts";
import { makeObservationHandler, TRIAGE_HANDLER_KEY } from "../_shared/triage/observation-handler.ts";
import { makeTriageTaskHandler, QUEUE_HANDLER_KEY } from "../_shared/queue/triage-task-handler.ts";
import {
  LEAD_CLINICIAN_EVENT_HANDLER_KEY, LEAD_ORDER_PAID_HANDLER_KEY, makeClinicianEventHandler, makeOrderPaidLeadHandler,
} from "../_shared/queue/lead-handlers.ts";
import { makePagingHandler, PAGING_HANDLER_KEY } from "../_shared/queue/paging-handler.ts";
import { makePointsHandler, POINTS_HANDLER_KEY } from "../_shared/rewards/points-handler.ts";
import { pointsPorts } from "./points-ports.ts";
import { leadPorts, pagingPorts, queuePorts } from "./queue-ports.ts";
import { triagePorts, type RpcClient } from "./triage-ports.ts";

export function buildHandlers(client: RpcClient): HandlerRegistry {
  return {
    "bus.noop": noopHandler,
    [TRIAGE_HANDLER_KEY]: makeObservationHandler(triagePorts(client)),
    [QUEUE_HANDLER_KEY]: makeTriageTaskHandler(queuePorts(client)),
    [LEAD_CLINICIAN_EVENT_HANDLER_KEY]: makeClinicianEventHandler(leadPorts(client)),
    [LEAD_ORDER_PAID_HANDLER_KEY]: makeOrderPaidLeadHandler(leadPorts(client)),
    [PAGING_HANDLER_KEY]: makePagingHandler(pagingPorts(client)),
    [POINTS_HANDLER_KEY]: makePointsHandler(pointsPorts(client)),
  };
}
