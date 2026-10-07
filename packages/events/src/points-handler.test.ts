import { describe, expect, it, jest } from "@jest/globals";
import { PermanentHandlerError, makePointsHandler, POINTS_HANDLER_KEY, type BusEvent, type HandlerContext, type PointsPorts } from "./index";
import { pointsPorts } from "../../../supabase/functions/process-events/points-ports";

const ctx: HandlerContext = { once: async (_n, fn) => { await fn(); return true; } };
const event = (over: Partial<BusEvent> = {}): BusEvent => ({
  deliveryId: "d", leaseToken: "l", attempt: 1, eventId: "ev-1", eventType: "lesson.completed", eventVersion: 1, organisationId: "o", patientId: "p",
  aggregateType: null, aggregateId: null, payload: {}, priority: "normal", isTest: true, occurredAt: "2026-10-07T00:00:00Z",
  subscriberKey: "points.award.lesson_completed", handlerKey: POINTS_HANDLER_KEY, ...over,
});

describe("points handler (S58)", () => {
  it("passes the event id to the database and nothing else", async () => {
    const award = jest.fn<PointsPorts["award"]>().mockResolvedValue(20);
    await makePointsHandler({ award })(event({ payload: { content_id: "c", reading: 190 } }), ctx);
    expect(award).toHaveBeenCalledTimes(1);
    expect(award).toHaveBeenCalledWith("ev-1");
  });

  it("is safe to run twice: each run is the same single database call (the database dedupes per event and rule)", async () => {
    const award = jest.fn<PointsPorts["award"]>().mockResolvedValueOnce(20).mockResolvedValueOnce(0);
    const h = makePointsHandler({ award });
    await h(event(), ctx);
    await h(event(), ctx);
    expect(award.mock.calls).toEqual([["ev-1"], ["ev-1"]]);
  });

  it("skips an event with no person without calling the database", async () => {
    const award = jest.fn<PointsPorts["award"]>();
    await makePointsHandler({ award })(event({ patientId: null }), ctx);
    expect(award).not.toHaveBeenCalled();
  });

  it("dead-letters a delivery with no event id", async () => {
    const award = jest.fn<PointsPorts["award"]>();
    await expect(makePointsHandler({ award })(event({ eventId: "" }), ctx)).rejects.toBeInstanceOf(PermanentHandlerError);
    expect(award).not.toHaveBeenCalled();
  });

  it("lets a database failure through so the delivery retries and a lost award is visible", async () => {
    const award = jest.fn<PointsPorts["award"]>().mockRejectedValue(new Error("db down"));
    await expect(makePointsHandler({ award })(event(), ctx)).rejects.toThrow("db down");
  });
});

describe("points ports", () => {
  it("calls the service-role RPC and returns the points", async () => {
    const rpc = jest.fn<(n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>().mockResolvedValue({ data: 15, error: null });
    expect(await pointsPorts({ rpc } as never).award("ev-9")).toBe(15);
    expect(rpc).toHaveBeenCalledWith("points_award", { p_event_id: "ev-9" });
  });
  it("treats a non-number answer as 0", async () => {
    const rpc = jest.fn<(n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: null }>>().mockResolvedValue({ data: null, error: null });
    expect(await pointsPorts({ rpc } as never).award("ev-9")).toBe(0);
  });
  it("throws the database error so the bus retries", async () => {
    const rpc = jest.fn<(n: string, a: Record<string, unknown>) => Promise<{ data: null; error: { message: string } }>>().mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(pointsPorts({ rpc } as never).award("ev-9")).rejects.toThrow("points_award: boom");
  });
});
