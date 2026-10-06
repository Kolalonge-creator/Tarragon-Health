import { describe, expect, it } from "@jest/globals";
import { createMockPayment } from "../../../supabase/functions/_shared/integrations/payment-mock.ts";
import { mapOrderError, startCheckout, type CreatedOrder, type OrderCreator } from "../../../supabase/functions/_shared/commerce/checkout.ts";
import { supabaseOrderStore, type RpcClient } from "../../../supabase/functions/_shared/commerce/supabase-store.ts";
import { MemoryStore } from "./support/memory-store.ts";

const REF = "tho_0123456789abcdef0123456789abcdef";
const order = (over: Partial<CreatedOrder> = {}): CreatedOrder => ({ orderId: "order-1", reference: REF, amountKobo: 10_000_000, state: "created", checkoutUrl: null, ...over });
const creator = (o: CreatedOrder): OrderCreator => ({ create: async () => ({ ok: true, order: o }) });
const args = { code: "membership_annual", clientKey: "k", email: "a@example.com", callbackUrl: "https://app.example/return" };

describe("mapOrderError", () => {
  it("finds the stable code inside a database message and falls back to unknown", () => {
    expect(mapOrderError("ERROR: no_capacity")).toBe("no_capacity");
    expect(mapOrderError("checkout_not_open")).toBe("checkout_not_open");
    expect(mapOrderError("boom")).toBe("unknown");
  });
});

describe("startCheckout", () => {
  it("initialises Paystack for the order's own price with the order id as the only metadata, and keeps the link", async () => {
    const payments = createMockPayment();
    const store = new MemoryStore();
    store.add({ reference: REF, amountKobo: 10_000_000 });
    const r = await startCheckout({ payments, store, orders: creator(order()) }, args);
    expect(r).toMatchObject({ ok: true, orderId: "order-1", amountKobo: 10_000_000 });
    expect(r.ok && r.checkoutUrl).toContain(REF);
    expect(store.orders.get(REF)!.checkoutUrl).toBe(r.ok ? r.checkoutUrl : null);
    const v = await payments.verifyTransaction(REF);
    expect(v.ok && v.data.metadata).toEqual({ kind: "order", order_id: "order-1" });
    expect(v.ok && v.data.requestedAmountKobo).toBe(10_000_000);
  });
  it("needs an email on file", async () => {
    const r = await startCheckout({ payments: createMockPayment(), store: new MemoryStore(), orders: creator(order()) }, { ...args, email: null });
    expect(r).toEqual({ ok: false, code: "email_needed" });
  });
  it("passes the database's refusal through", async () => {
    const orders: OrderCreator = { create: async () => ({ ok: false, code: "no_capacity" }) };
    expect(await startCheckout({ payments: createMockPayment(), store: new MemoryStore(), orders }, args)).toEqual({ ok: false, code: "no_capacity" });
  });
  it("reopens the stored link on a retry instead of initialising twice", async () => {
    const payments = createMockPayment();
    const r = await startCheckout({ payments, store: new MemoryStore(), orders: creator(order({ checkoutUrl: "https://checkout.example/x" })) }, args);
    expect(r).toMatchObject({ ok: true, checkoutUrl: "https://checkout.example/x" });
    expect((await payments.verifyTransaction(REF)).ok).toBe(false);
  });
  it("refuses an order that is already paid or closed", async () => {
    const d = { payments: createMockPayment(), store: new MemoryStore() };
    expect(await startCheckout({ ...d, orders: creator(order({ state: "paid" })) }, args)).toEqual({ ok: false, code: "already_paid" });
    expect(await startCheckout({ ...d, orders: creator(order({ state: "cancelled" })) }, args)).toEqual({ ok: false, code: "order_closed" });
  });
  it("says so when Paystack is down, and when a link was lost", async () => {
    const payments = createMockPayment();
    payments.failNextCall();
    expect(await startCheckout({ payments, store: new MemoryStore(), orders: creator(order()) }, args)).toEqual({ ok: false, code: "payment_unavailable" });
    await startCheckout({ payments, store: new MemoryStore(), orders: creator(order()) }, args);
    expect(await startCheckout({ payments, store: new MemoryStore(), orders: creator(order()) }, args)).toEqual({ ok: false, code: "checkout_link_lost" });
  });
});

function client(handler: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null } | "throw"): RpcClient & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return {
    calls,
    rpc: async (fn, a = {}) => {
      calls.push([fn, a]);
      const r = handler(fn, a);
      if (r === "throw") throw new Error("down");
      return r;
    },
  };
}

describe("supabaseOrderStore", () => {
  const input = { reference: REF, amountKobo: 1, feeKobo: 0, totalKobo: 1, currency: "NGN", source: "webhook" as const, eventKey: "e", paidAt: null, raw: {} };
  it("calls the service-role functions with the right arguments and reads their replies", async () => {
    const c = client((fn) => {
      if (fn === "record_order_payment") return { data: { result: "paid", order_id: "o1" }, error: null };
      if (fn === "flag_order_payment_mismatch") return { data: { result: "mismatch", reason: "fee", order_id: "o1" }, error: null };
      if (fn === "close_unpaid_order") return { data: true, error: null };
      if (fn === "set_order_checkout_url") return { data: false, error: null };
      return { data: [{ reference: REF, order_id: "o1", expired: true }, { nope: 1 }], error: null };
    });
    const s = supabaseOrderStore(c);
    expect(await s.record(input)).toEqual({ ok: true, data: { result: "paid", orderId: "o1", reason: null } });
    expect(c.calls[0]![1]).toMatchObject({ p_status: "success", p_reference: REF });
    expect(await s.flagMismatch({ reference: REF, reason: "fee", amountKobo: 1, totalKobo: 2, source: "sweep", eventKey: null })).toEqual({ ok: true, data: { result: "mismatch", orderId: "o1", reason: "fee" } });
    expect(await s.close(REF, "expired")).toEqual({ ok: true, data: true });
    expect(await s.setCheckoutUrl(REF, "https://x")).toEqual({ ok: true, data: false });
    expect(await s.listOpen(10)).toEqual({ ok: true, data: [{ reference: REF, orderId: "o1", expired: true }] });
  });
  it("turns a database error, a throw or a strange reply into a failure value, never an exception", async () => {
    const bad = supabaseOrderStore(client(() => ({ data: null, error: { message: "boom" } })));
    for (const r of [await bad.record(input), await bad.flagMismatch({ reference: REF, reason: "x", amountKobo: 1, totalKobo: 1, source: "webhook", eventKey: null }), await bad.close(REF, "failed"), await bad.listOpen(1), await bad.setCheckoutUrl(REF, "https://x")]) {
      expect(r.ok).toBe(false);
    }
    const thrown = supabaseOrderStore(client(() => "throw"));
    expect((await thrown.record(input)).ok).toBe(false);
    const odd = supabaseOrderStore(client(() => ({ data: "what", error: null })));
    expect(await odd.record(input)).toMatchObject({ ok: false, error: { code: "bad_response" } });
    expect(await odd.listOpen(1)).toMatchObject({ ok: false, error: { code: "bad_response" } });
    const weird = supabaseOrderStore(client(() => ({ data: { result: "teleported" }, error: null })));
    expect(await weird.record(input)).toMatchObject({ ok: false, error: { code: "bad_response" } });
  });
});
