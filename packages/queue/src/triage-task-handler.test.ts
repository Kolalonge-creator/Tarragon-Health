import { describe, expect, it, jest } from "@jest/globals";
import { PermanentHandlerError, type BusEvent, type HandlerContext } from "../../../supabase/functions/_shared/event-bus/dispatch";
import { makeTriageTaskHandler, QUEUE_HANDLER_KEY, type QueuePorts } from "./index";
import { queuePorts } from "../../../supabase/functions/process-events/queue-ports";

const ctx: HandlerContext = { once: async (_n, fn) => { await fn(); return true; } };
const event = (payload: Record<string, unknown>): BusEvent => ({
  deliveryId: "d", leaseToken: "l", attempt: 1, eventId: "e", eventType: "triage.graded", eventVersion: 1, organisationId: "o", patientId: "p",
  aggregateType: "triage_event", aggregateId: "t", payload, priority: "normal", isTest: true, occurredAt: "2026-10-06T00:00:00Z",
  subscriberKey: QUEUE_HANDLER_KEY, handlerKey: QUEUE_HANDLER_KEY,
});

describe("triage.graded -> tasks handler", () => {
  it("creates tasks for an approved grade", async () => {
    const createFromTriage = jest.fn<QueuePorts["createFromTriage"]>().mockResolvedValue(1);
    await makeTriageTaskHandler({ createFromTriage })(event({ triage_event_id: "t1", shadow: false }), ctx);
    expect(createFromTriage).toHaveBeenCalledWith("t1");
  });

  it("ignores a shadow grade entirely (OQ-88)", async () => {
    const createFromTriage = jest.fn<QueuePorts["createFromTriage"]>();
    await makeTriageTaskHandler({ createFromTriage })(event({ triage_event_id: "t1", shadow: true }), ctx);
    expect(createFromTriage).not.toHaveBeenCalled();
  });

  it("dead-letters a payload with no triage event id, since a retry cannot fix it", async () => {
    const createFromTriage = jest.fn<QueuePorts["createFromTriage"]>();
    const h = makeTriageTaskHandler({ createFromTriage });
    await expect(h(event({ shadow: false }), ctx)).rejects.toBeInstanceOf(PermanentHandlerError);
    await expect(h(event({ triage_event_id: "" }), ctx)).rejects.toBeInstanceOf(PermanentHandlerError);
    expect(createFromTriage).not.toHaveBeenCalled();
  });

  it("lets a database failure through so the delivery retries and then dead-letters", async () => {
    const createFromTriage = jest.fn<QueuePorts["createFromTriage"]>().mockRejectedValue(new Error("no task type answers the triage task key x"));
    await expect(makeTriageTaskHandler({ createFromTriage })(event({ triage_event_id: "t1" }), ctx)).rejects.toThrow("no task type answers");
  });
});

describe("queue ports", () => {
  it("calls the service-role function with the event id and returns the count", async () => {
    const rpc = jest.fn<(n: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>>().mockResolvedValue({ data: 2, error: null });
    expect(await queuePorts({ rpc }).createFromTriage("t9")).toBe(2);
    expect(rpc).toHaveBeenCalledWith("create_tasks_from_triage_event", { p_triage_event: "t9" });
  });

  it("returns 0 for a non-numeric answer and throws on an error", async () => {
    const ok = { rpc: async () => ({ data: null, error: null }) };
    expect(await queuePorts(ok).createFromTriage("t")).toBe(0);
    const bad = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
    await expect(queuePorts(bad).createFromTriage("t")).rejects.toThrow("create_tasks_from_triage_event: boom");
  });
});
