import { describe, expect, it } from "@jest/globals";
import { createMockPayment } from "../../../supabase/functions/_shared/integrations/payment-mock.ts";
import { mapOrderError, startCheckout, startInstalmentPayment, type CreatedOrder, type InstalmentPreparer, type OrderCreator, type OrderExtras, type PreparedInstalment } from "../../../supabase/functions/_shared/commerce/checkout.ts";
import { MemoryStore } from "./support/memory-store.ts";

// S25b: paying the annual Membership in parts. The database decides everything (the schedule, the amounts, who may pay which part); this
// layer only has to start a Paystack payment for exactly what it was told, under the reference it was given, and never trust a client amount.

const PART_REF = "thi_0123456789abcdef0123456789abcdef";
const part = (over: Partial<PreparedInstalment> = {}): PreparedInstalment => ({ instalmentId: "inst-2", orderId: "order-1", reference: PART_REF, amountKobo: 3_333_333, checkoutUrl: null, ...over });
const preparer = (p: PreparedInstalment): InstalmentPreparer => ({ prepare: async () => ({ ok: true, part: p }) });
const args = { instalmentId: "inst-2", email: "a@example.com", callbackUrl: "https://app.example/return" };

describe("mapOrderError (S25b)", () => {
  it("finds the pay-in-parts refusals inside a database message", () => {
    for (const code of ["instalments_not_open", "instalment_schedule_invalid", "instalment_not_available", "instalment_order_mismatch", "pay_earlier_part_first", "instalment_closed", "instalment_not_found", "instalment_plan_ended"]) {
      expect(mapOrderError(`ERROR: ${code}`)).toBe(code);
    }
  });
});

describe("startCheckout with a plan (S25b)", () => {
  it("hands the number of parts to the order creator and pays the FIRST PART under the part's own reference", async () => {
    const payments = createMockPayment();
    const store = new MemoryStore();
    store.add({ reference: PART_REF, amountKobo: 3_333_334 });
    let seen: OrderExtras | undefined;
    const orders: OrderCreator = {
      create: async (_c, _k, _b, extras) => {
        seen = extras;
        const o: CreatedOrder = { orderId: "order-1", reference: PART_REF, amountKobo: 3_333_334, state: "created", checkoutUrl: null };
        return { ok: true, order: o };
      },
    };
    const r = await startCheckout({ payments, store, orders }, { code: "membership_annual", clientKey: "k", email: "a@example.com", callbackUrl: "https://app.example/return", instalmentParts: 3 });
    expect(seen).toEqual({ instalmentParts: 3 });
    expect(r).toMatchObject({ ok: true, orderId: "order-1", reference: PART_REF, amountKobo: 3_333_334 });
    const v = await payments.verifyTransaction(PART_REF);
    expect(v.ok && v.data.requestedAmountKobo).toBe(3_333_334);
    expect(v.ok && v.data.metadata).toEqual({ kind: "order", order_id: "order-1" });
  });

  it("sends nothing extra when no plan is asked for (the ordinary call is unchanged)", async () => {
    let seen: OrderExtras | undefined;
    const orders: OrderCreator = { create: async (_c, _k, _b, extras) => { seen = extras; return { ok: false, code: "no_capacity" }; } };
    await startCheckout({ payments: createMockPayment(), store: new MemoryStore(), orders }, { code: "membership_annual", clientKey: "k", email: "a@example.com", callbackUrl: "https://app.example/return" });
    expect(seen).toEqual({});
  });
});

describe("startInstalmentPayment (S25b)", () => {
  it("initialises Paystack for exactly the part's amount, with the order id as the only metadata, and keeps the hosted page", async () => {
    const payments = createMockPayment();
    const store = new MemoryStore();
    store.add({ reference: PART_REF, amountKobo: 3_333_333 });
    const r = await startInstalmentPayment({ payments, store, parts: preparer(part()) }, args);
    expect(r).toMatchObject({ ok: true, instalmentId: "inst-2", orderId: "order-1", reference: PART_REF, amountKobo: 3_333_333 });
    const v = await payments.verifyTransaction(PART_REF);
    expect(v.ok && v.data.requestedAmountKobo).toBe(3_333_333);
    expect(v.ok && v.data.metadata).toEqual({ kind: "order", order_id: "order-1" });
    expect(payments.channelsFor(PART_REF)).toEqual(["card", "bank_transfer", "ussd"]);
    expect(store.orders.get(PART_REF)!.checkoutUrl).toBe(r.ok ? r.checkoutUrl : null);
  });

  it("reopens a still-fresh hosted page instead of starting a second transaction, and needs no email for that", async () => {
    const payments = createMockPayment();
    const r = await startInstalmentPayment({ payments, store: new MemoryStore(), parts: preparer(part({ checkoutUrl: "https://checkout.example/x" })) }, { ...args, email: null });
    expect(r).toMatchObject({ ok: true, checkoutUrl: "https://checkout.example/x" });
    expect((await payments.verifyTransaction(PART_REF)).ok).toBe(false);
  });

  it("passes the database's refusal through untouched and never calls Paystack", async () => {
    const payments = createMockPayment();
    const parts: InstalmentPreparer = { prepare: async () => ({ ok: false, code: "pay_earlier_part_first" }) };
    expect(await startInstalmentPayment({ payments, store: new MemoryStore(), parts }, args)).toEqual({ ok: false, code: "pay_earlier_part_first" });
    expect((await payments.verifyTransaction(PART_REF)).ok).toBe(false);
  });

  it("needs an email on file for a new hosted page", async () => {
    const r = await startInstalmentPayment({ payments: createMockPayment(), store: new MemoryStore(), parts: preparer(part()) }, { ...args, email: null });
    expect(r).toEqual({ ok: false, code: "email_needed" });
  });

  it("says so when Paystack is down, and when a link was lost (a reference Paystack already holds)", async () => {
    const payments = createMockPayment();
    payments.failNextCall();
    expect(await startInstalmentPayment({ payments, store: new MemoryStore(), parts: preparer(part()) }, args)).toEqual({ ok: false, code: "payment_unavailable" });
    await startInstalmentPayment({ payments, store: new MemoryStore(), parts: preparer(part()) }, args);
    expect(await startInstalmentPayment({ payments, store: new MemoryStore(), parts: preparer(part()) }, args)).toEqual({ ok: false, code: "checkout_link_lost" });
  });
});
