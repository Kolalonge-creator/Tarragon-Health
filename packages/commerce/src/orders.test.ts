import { describe, expect, it } from "@jest/globals";
import { createMockPayment } from "../../../supabase/functions/_shared/integrations/payment-mock.ts";
import { confirmPayment, handleOrderWebhook, reconcileOpenOrders } from "../../../supabase/functions/_shared/commerce/orders.ts";
import { MemoryStore } from "./support/memory-store.ts";

const REF = "tho_0123456789abcdef0123456789abcdef";
const PRICE = 10_000_000;

async function setup(opts: { fee?: number } = {}) {
  const payments = createMockPayment();
  const store = new MemoryStore();
  store.add({ reference: REF, amountKobo: PRICE });
  await payments.initializeTransaction({ reference: REF, email: "a@example.com", amountKobo: PRICE, metadata: { kind: "order", order_id: "order-1" } });
  if (opts.fee !== undefined) payments.setCustomerFee(REF, opts.fee);
  return { payments, store, deps: { payments, store } };
}

describe("confirmPayment", () => {
  it("marks an order paid only after Paystack verifies it, recording price, fee and total", async () => {
    const { payments, store, deps } = await setup({ fee: 150_000 });
    payments.settle(REF, "success");
    const r = await confirmPayment(deps, { reference: REF, source: "return" });
    expect(r).toEqual({ outcome: "paid", orderId: "order-1" });
    expect(store.payments[0]).toMatchObject({ amountKobo: PRICE, feeKobo: 150_000, totalKobo: PRICE + 150_000, source: "return" });
    expect(Object.keys(store.payments[0]!.raw)).not.toContain("customer");
  });
  it("does nothing while the customer has not paid", async () => {
    const { deps, store } = await setup();
    expect(await confirmPayment(deps, { reference: REF, source: "return" })).toEqual({ outcome: "pending" });
    expect(store.orders.get(REF)!.state).toBe("created");
  });
  it("reports a failed, abandoned or reversed charge as unpaid", async () => {
    for (const status of ["failed", "abandoned", "reversed"] as const) {
      const { payments, deps } = await setup();
      payments.settle(REF, status);
      expect(await confirmPayment(deps, { reference: REF, source: "sweep" })).toEqual({ outcome: "unpaid", status });
    }
  });
  it("reports an unknown reference as not found without writing", async () => {
    const { deps, store } = await setup();
    expect(await confirmPayment(deps, { reference: "tho_unknown00000000000000000000000", source: "return" })).toEqual({ outcome: "not_found" });
    expect(store.payments).toHaveLength(0);
  });
  it("asks for a retry when Paystack cannot be reached", async () => {
    const { payments, deps } = await setup();
    payments.failNextCall();
    expect(await confirmPayment(deps, { reference: REF, source: "webhook" })).toEqual({ outcome: "retry", where: "provider" });
  });
  it("asks for a retry when the database cannot be reached, then succeeds on the retry", async () => {
    const { payments, store, deps } = await setup();
    payments.settle(REF, "success");
    store.failNext = true;
    expect(await confirmPayment(deps, { reference: REF, source: "webhook" })).toEqual({ outcome: "retry", where: "store" });
    expect(store.orders.get(REF)!.state).toBe("created");
    expect((await confirmPayment(deps, { reference: REF, source: "webhook" })).outcome).toBe("paid");
  });
  it("a wrong price is a mismatch and the order stays unpaid", async () => {
    const payments = createMockPayment();
    const store = new MemoryStore();
    store.add({ reference: REF, amountKobo: PRICE });
    await payments.initializeTransaction({ reference: REF, email: "a@example.com", amountKobo: PRICE - 1, metadata: { kind: "order" } });
    payments.settle(REF, "success");
    const r = await confirmPayment({ payments, store }, { reference: REF, source: "webhook" });
    expect(r).toMatchObject({ outcome: "mismatch", reason: "amount" });
    expect(store.orders.get(REF)!.state).toBe("created");
    expect(store.entitlements).toHaveLength(0);
  });
  it("SAFETY CASE 24: the same payment confirmed many times makes one payment, one entitlement, one event", async () => {
    const { payments, store, deps } = await setup({ fee: 150_000 });
    payments.settle(REF, "success");
    const outcomes = [];
    for (const source of ["webhook", "webhook", "return", "sweep", "webhook"] as const) outcomes.push((await confirmPayment(deps, { reference: REF, source })).outcome);
    expect(outcomes).toEqual(["paid", "replay", "replay", "replay", "replay"]);
    expect(store.payments).toHaveLength(1);
    expect(store.entitlements).toHaveLength(1);
    expect(store.events).toHaveLength(1);
  });
  it("SAFETY CASE 24: concurrent deliveries still make one entitlement", async () => {
    const { payments, store, deps } = await setup();
    payments.settle(REF, "success");
    await Promise.all([1, 2, 3, 4].map(() => confirmPayment(deps, { reference: REF, source: "webhook" })));
    expect(store.entitlements).toHaveLength(1);
  });
  it("flags a processor-fee mismatch (charged more than Paystack's own fee) without paying", async () => {
    const { payments, deps, store } = await setup();
    // a verify that reports customer paid 900,000 over the price but a processor fee of only 150,000
    const verify = payments.verifyTransaction.bind(payments);
    payments.verifyTransaction = async (r: string) => {
      const v = await verify(r);
      return v.ok ? { ok: true, data: { ...v.data, status: "success", amountKobo: PRICE + 900_000, feesKobo: 150_000 } } : v;
    };
    const r = await confirmPayment(deps, { reference: REF, source: "webhook" });
    expect(r).toMatchObject({ outcome: "mismatch", reason: "fee" });
    expect(store.orders.get(REF)!.state).toBe("created");
  });
  it("flags a reference swap and a foreign currency", async () => {
    for (const patch of [{ reference: "tho_swapped000000000000000000000000" }, { currency: "USD" }] as const) {
      const { payments, deps, store } = await setup();
      const verify = payments.verifyTransaction.bind(payments);
      payments.verifyTransaction = async (r: string) => {
        const v = await verify(r);
        return v.ok ? { ok: true, data: { ...v.data, status: "success", ...patch } } : v;
      };
      const r = await confirmPayment(deps, { reference: REF, source: "webhook" });
      expect(r).toMatchObject({ outcome: "mismatch" });
      expect(store.entitlements).toHaveLength(0);
    }
  });
  it("a mismatch on an order we do not know is not found; a store error while flagging asks for a retry", async () => {
    const { payments, deps, store } = await setup();
    payments.settle(REF, "success");
    const verify = payments.verifyTransaction.bind(payments);
    payments.verifyTransaction = async (r: string) => {
      const v = await verify(r);
      return v.ok ? { ok: true, data: { ...v.data, currency: "USD" } } : v;
    };
    store.orders.clear();
    expect(await confirmPayment(deps, { reference: REF, source: "webhook" })).toEqual({ outcome: "not_found" });
    store.add({ reference: REF, amountKobo: PRICE });
    store.failNext = true;
    expect(await confirmPayment(deps, { reference: REF, source: "webhook" })).toEqual({ outcome: "retry", where: "store" });
  });
  it("maps the database's not_found, mismatch and not_paid replies", async () => {
    const { payments, deps, store } = await setup();
    payments.settle(REF, "success");
    const orig = store.record.bind(store);
    store.record = async () => ({ ok: true, data: { result: "not_found", orderId: null, reason: null } });
    expect(await confirmPayment(deps, { reference: REF, source: "webhook" })).toEqual({ outcome: "not_found" });
    store.record = async () => ({ ok: true, data: { result: "mismatch", orderId: "o", reason: "amount" } });
    expect(await confirmPayment(deps, { reference: REF, source: "webhook" })).toEqual({ outcome: "mismatch", reason: "amount", orderId: "o" });
    store.record = async () => ({ ok: true, data: { result: "not_paid", orderId: "o", reason: null } });
    expect(await confirmPayment(deps, { reference: REF, source: "webhook" })).toEqual({ outcome: "pending" });
    store.record = orig;
  });
});

describe("handleOrderWebhook", () => {
  it("handles a signed charge.success for an order and pays it once even when delivered three times", async () => {
    const { payments, store, deps } = await setup({ fee: 150_000 });
    payments.settle(REF, "success");
    const { rawBody, signature } = await payments.signedChargeWebhook(REF);
    const outs = [];
    for (let i = 0; i < 3; i++) outs.push(await handleOrderWebhook(deps, rawBody, signature));
    expect(outs.map((o) => (o.handled ? o.confirm.outcome : "unhandled"))).toEqual(["paid", "replay", "replay"]);
    expect(store.entitlements).toHaveLength(1);
  });
  it("refuses a body with a bad signature and writes nothing", async () => {
    const { payments, store, deps } = await setup();
    payments.settle(REF, "success");
    const { rawBody } = await payments.signedChargeWebhook(REF);
    expect(await handleOrderWebhook(deps, rawBody, "deadbeef")).toEqual({ handled: false, reason: "invalid_signature" });
    expect(await handleOrderWebhook(deps, rawBody, null)).toEqual({ handled: false, reason: "invalid_signature" });
    expect(store.payments).toHaveLength(0);
  });
  it("does not claim a charge that is not one of our orders, or another event type", async () => {
    const { payments, deps } = await setup();
    payments.settle(REF, "success");
    const legacy = await payments.signedWebhook({ event: "charge.success", data: { reference: REF, amount: PRICE, currency: "NGN", metadata: { kind: "service_purchase" } } });
    expect(await handleOrderWebhook(deps, legacy.rawBody, legacy.signature)).toEqual({ handled: false, reason: "not_an_order_event" });
    const refund = await payments.signedWebhook({ event: "refund.processed", data: { transaction_reference: REF, status: "processed" } });
    expect(await handleOrderWebhook(deps, refund.rawBody, refund.signature)).toEqual({ handled: false, reason: "not_an_order_event" });
  });
  it("trusts Paystack's verify, not the webhook body: a body that claims success for an unpaid charge pays nothing", async () => {
    const { payments, store, deps } = await setup();
    const forged = await payments.signedWebhook({ event: "charge.success", data: { reference: REF, amount: PRICE, requested_amount: PRICE, fees: 0, currency: "NGN", metadata: { kind: "order" } } });
    const out = await handleOrderWebhook(deps, forged.rawBody, forged.signature);
    expect(out).toEqual({ handled: true, confirm: { outcome: "pending" } });
    expect(store.entitlements).toHaveLength(0);
  });
});

describe("reconcileOpenOrders", () => {
  it("pays a late settlement, closes an abandoned one, closes an expired unknown one and keeps the rest", async () => {
    const payments = createMockPayment();
    const store = new MemoryStore();
    const refs = { late: "tho_late0000000000000000000000000", gone: "tho_gone0000000000000000000000000", fresh: "tho_fresh000000000000000000000000", lost: "tho_lost0000000000000000000000000", mism: "tho_mism0000000000000000000000000" };
    for (const r of Object.values(refs)) store.add({ reference: r, amountKobo: 500_000 });
    store.orders.get(refs.gone)!.expired = true;
    store.orders.get(refs.lost)!.expired = true;
    for (const r of [refs.late, refs.gone, refs.fresh]) await payments.initializeTransaction({ reference: r, email: "a@example.com", amountKobo: 500_000, metadata: { kind: "order" } });
    await payments.initializeTransaction({ reference: refs.mism, email: "a@example.com", amountKobo: 400_000, metadata: { kind: "order" } });
    payments.settle(refs.late, "success");
    payments.settle(refs.gone, "abandoned");
    payments.settle(refs.mism, "success");
    const out = await reconcileOpenOrders({ payments, store });
    expect(out).toEqual({ ok: true, data: { checked: 5, paid: 1, closed: 2, mismatches: 1, stillPending: 1, errors: 0 } });
    expect(store.orders.get(refs.late)!.state).toBe("paid");
    expect(store.orders.get(refs.fresh)!.state).toBe("created");
    expect(store.entitlements).toHaveLength(1);
    // a second pass changes nothing that is already paid
    const again = await reconcileOpenOrders({ payments, store });
    expect(again.ok && again.data.paid).toBe(0);
    expect(store.entitlements).toHaveLength(1);
  });
  it("counts errors without stopping, and reports when the list itself cannot be read", async () => {
    const payments = createMockPayment();
    const store = new MemoryStore();
    store.add({ reference: REF, amountKobo: 500_000 });
    await payments.initializeTransaction({ reference: REF, email: "a@example.com", amountKobo: 500_000, metadata: { kind: "order" } });
    payments.failNextCall();
    const out = await reconcileOpenOrders({ payments, store });
    expect(out.ok && out.data.errors).toBe(1);
    store.failNext = true;
    expect((await reconcileOpenOrders({ payments, store })).ok).toBe(false);
  });
  it("counts a failed close as an error", async () => {
    const payments = createMockPayment();
    const store = new MemoryStore();
    store.add({ reference: REF, amountKobo: 500_000, expired: true });
    store.close = async () => ({ ok: false, error: { code: "network", message: "x", retryable: true } });
    const out = await reconcileOpenOrders({ payments, store });
    expect(out.ok && out.data.errors).toBe(1);
  });
  it("an order the webhook paid a moment ago is a replay, not counted again", async () => {
    const payments = createMockPayment();
    const store = new MemoryStore();
    store.add({ reference: REF, amountKobo: 500_000 });
    await payments.initializeTransaction({ reference: REF, email: "a@example.com", amountKobo: 500_000, metadata: { kind: "order" } });
    payments.settle(REF, "success");
    store.record = async () => ({ ok: true, data: { result: "replay", orderId: "o", reason: null } });
    const out = await reconcileOpenOrders({ payments, store });
    expect(out.ok && out.data).toMatchObject({ checked: 1, paid: 0, errors: 0 });
  });
  it("does not count an already-closed order twice", async () => {
    const payments = createMockPayment();
    const store = new MemoryStore();
    store.add({ reference: REF, amountKobo: 500_000 });
    await payments.initializeTransaction({ reference: REF, email: "a@example.com", amountKobo: 500_000, metadata: { kind: "order" } });
    payments.settle(REF, "failed");
    store.close = async () => ({ ok: true, data: false });
    const out = await reconcileOpenOrders({ payments, store });
    expect(out.ok && out.data.closed).toBe(0);
  });
});
