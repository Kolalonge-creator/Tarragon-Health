import { describe, expect, it, jest } from "@jest/globals";
import { PermanentHandlerError, type BusEvent, type HandlerContext } from "../../../supabase/functions/_shared/event-bus/dispatch";
import { makePagingHandler, PAGING_HANDLER_KEY, type PagingPorts } from "./index";
import { pagingPorts } from "../../../supabase/functions/process-events/queue-ports";

const ctx: HandlerContext = { once: async (_n, fn) => { await fn(); return true; } };
const event = (payload: Record<string, unknown>): BusEvent => ({
  deliveryId: "d", leaseToken: "l", attempt: 1, eventId: "e", eventType: "triage.graded", eventVersion: 1, organisationId: "o", patientId: "p",
  aggregateType: "triage_event", aggregateId: "t", payload, priority: "urgent", isTest: true, occurredAt: "2026-10-06T00:00:00Z",
  subscriberKey: PAGING_HANDLER_KEY, handlerKey: PAGING_HANDLER_KEY,
});

describe("triage.graded -> page handler", () => {
  it("asks the database to page for an approved grade", async () => {
    const createRedPage = jest.fn<PagingPorts["createRedPage"]>().mockResolvedValue("page-1");
    await makePagingHandler({ createRedPage })(event({ triage_event_id: "t1", shadow: false }), ctx);
    expect(createRedPage).toHaveBeenCalledWith("t1");
  });

  it("never pages for a shadow grade (OQ-88)", async () => {
    const createRedPage = jest.fn<PagingPorts["createRedPage"]>();
    await makePagingHandler({ createRedPage })(event({ triage_event_id: "t1", shadow: true }), ctx);
    expect(createRedPage).not.toHaveBeenCalled();
  });

  it("accepts a grade the database decides is not a page", async () => {
    const createRedPage = jest.fn<PagingPorts["createRedPage"]>().mockResolvedValue(null);
    await expect(makePagingHandler({ createRedPage })(event({ triage_event_id: "t1" }), ctx)).resolves.toBeUndefined();
  });

  it("dead-letters a payload with no triage event id, since a retry cannot fix it", async () => {
    const createRedPage = jest.fn<PagingPorts["createRedPage"]>();
    const h = makePagingHandler({ createRedPage });
    await expect(h(event({}), ctx)).rejects.toBeInstanceOf(PermanentHandlerError);
    await expect(h(event({ triage_event_id: "" }), ctx)).rejects.toBeInstanceOf(PermanentHandlerError);
    expect(createRedPage).not.toHaveBeenCalled();
  });

  it("lets a database failure through so the delivery retries: a red event is never dropped quietly", async () => {
    const createRedPage = jest.fn<PagingPorts["createRedPage"]>().mockRejectedValue(new Error("db down"));
    await expect(makePagingHandler({ createRedPage })(event({ triage_event_id: "t1" }), ctx)).rejects.toThrow("db down");
  });
});

describe("paging ports", () => {
  type Rpc = (n: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  it("calls the service-role function and returns the page id", async () => {
    const rpc = jest.fn<Rpc>().mockResolvedValue({ data: "page-9", error: null });
    expect(await pagingPorts({ rpc }).createRedPage("t9")).toBe("page-9");
    expect(rpc).toHaveBeenCalledWith("create_red_page", { p_triage_event: "t9" });
  });
  it("returns null when the database says it is not a page, and throws on an error", async () => {
    expect(await pagingPorts({ rpc: async () => ({ data: null, error: null }) }).createRedPage("t")).toBeNull();
    await expect(pagingPorts({ rpc: async () => ({ data: null, error: { message: "boom" } }) }).createRedPage("t")).rejects.toThrow("create_red_page: boom");
  });
});
