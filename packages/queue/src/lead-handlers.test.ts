import { describe, expect, it, jest } from "@jest/globals";
import { PermanentHandlerError, type BusEvent, type HandlerContext } from "../../../supabase/functions/_shared/event-bus/dispatch";
import {
  LEAD_CLINICIAN_EVENT_HANDLER_KEY, LEAD_ORDER_PAID_HANDLER_KEY, makeClinicianEventHandler, makeOrderPaidLeadHandler, type LeadPorts,
} from "./index";
import { leadPorts } from "../../../supabase/functions/process-events/queue-ports";

const ctx: HandlerContext = { once: async (_n, fn) => { await fn(); return true; } };
const event = (eventType: string, payload: Record<string, unknown>, patientId: string | null = null): BusEvent => ({
  deliveryId: "d", leaseToken: "l", attempt: 1, eventId: "e", eventType, eventVersion: 1, organisationId: "o", patientId,
  aggregateType: null, aggregateId: null, payload, priority: "normal", isTest: true, occurredAt: "2026-10-06T00:00:00Z",
  subscriberKey: "k", handlerKey: LEAD_CLINICIAN_EVENT_HANDLER_KEY,
});
const ports = (): { p: LeadPorts; onClinicianEvent: jest.Mock<LeadPorts["onClinicianEvent"]>; assignForOrder: jest.Mock<LeadPorts["assignForOrder"]> } => {
  const onClinicianEvent = jest.fn<LeadPorts["onClinicianEvent"]>().mockResolvedValue(undefined);
  const assignForOrder = jest.fn<LeadPorts["assignForOrder"]>().mockResolvedValue(undefined);
  return { p: { onClinicianEvent, assignForOrder }, onClinicianEvent, assignForOrder };
};

describe("clinician event handler (suspended, reinstated, competency changed)", () => {
  it("passes the clinician and the event type to the database", async () => {
    const { p, onClinicianEvent } = ports();
    await makeClinicianEventHandler(p)(event("clinician.suspended", { clinical_staff_id: "s1" }), ctx);
    expect(onClinicianEvent).toHaveBeenCalledWith("s1", "clinician.suspended");
  });

  it("dead-letters a payload with no clinician, since a retry cannot fix it", async () => {
    const { p, onClinicianEvent } = ports();
    const h = makeClinicianEventHandler(p);
    await expect(h(event("clinician.suspended", {}), ctx)).rejects.toBeInstanceOf(PermanentHandlerError);
    await expect(h(event("clinician.suspended", { clinical_staff_id: "" }), ctx)).rejects.toBeInstanceOf(PermanentHandlerError);
    expect(onClinicianEvent).not.toHaveBeenCalled();
  });

  it("lets a database failure through so the delivery retries and then dead-letters", async () => {
    const onClinicianEvent = jest.fn<LeadPorts["onClinicianEvent"]>().mockRejectedValue(new Error("boom"));
    await expect(makeClinicianEventHandler({ onClinicianEvent, assignForOrder: jest.fn<LeadPorts["assignForOrder"]>() })(event("clinician.reinstated", { clinical_staff_id: "s1" }), ctx)).rejects.toThrow("boom");
  });
});

describe("order.paid handler", () => {
  it("assigns a lead for a paid care pack", async () => {
    const { p, assignForOrder } = ports();
    await makeOrderPaidLeadHandler(p)(event("order.paid", { care_pack: true, order_id: "o1" }, "p1"), ctx);
    expect(assignForOrder).toHaveBeenCalledWith("p1", "o1");
  });

  it("passes no order when the payload names none", async () => {
    const { p, assignForOrder } = ports();
    await makeOrderPaidLeadHandler(p)(event("order.paid", { care_pack: true }, "p1"), ctx);
    expect(assignForOrder).toHaveBeenCalledWith("p1", null);
    await makeOrderPaidLeadHandler(p)(event("order.paid", { care_pack: true, order_id: "" }, "p1"), ctx);
    expect(assignForOrder).toHaveBeenLastCalledWith("p1", null);
  });

  it("ignores an order that is not a care pack", async () => {
    const { p, assignForOrder } = ports();
    const h = makeOrderPaidLeadHandler(p);
    await h(event("order.paid", { order_id: "o1" }, "p1"), ctx);
    await h(event("order.paid", { care_pack: false, order_id: "o1" }, "p1"), ctx);
    await h(event("order.paid", { care_pack: "yes" }, "p1"), ctx);
    expect(assignForOrder).not.toHaveBeenCalled();
  });

  it("dead-letters a care pack order with no patient", async () => {
    const { p } = ports();
    await expect(makeOrderPaidLeadHandler(p)(event("order.paid", { care_pack: true, order_id: "o1" }, null), ctx)).rejects.toBeInstanceOf(PermanentHandlerError);
  });

  it("registers under its own handler key", () => {
    expect(LEAD_ORDER_PAID_HANDLER_KEY).toBe("lead.assign_on_order_paid");
  });
});

describe("lead ports", () => {
  type Rpc = (n: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  it("calls the service-role functions with the right arguments", async () => {
    const rpc = jest.fn<Rpc>().mockResolvedValue({ data: null, error: null });
    await leadPorts({ rpc }).onClinicianEvent("s9", "clinician.suspended");
    await leadPorts({ rpc }).assignForOrder("p9", "o9");
    expect(rpc).toHaveBeenNthCalledWith(1, "lead_on_clinician_event", { p_staff: "s9", p_event: "clinician.suspended" });
    expect(rpc).toHaveBeenNthCalledWith(2, "assign_lead_for_event", { p_patient: "p9", p_order: "o9" });
  });

  it("throws on a database error so the delivery retries", async () => {
    const bad = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
    await expect(leadPorts(bad).onClinicianEvent("s", "e")).rejects.toThrow("lead_on_clinician_event: boom");
    await expect(leadPorts(bad).assignForOrder("p", null)).rejects.toThrow("assign_lead_for_event: boom");
  });
});
