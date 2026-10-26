import { describe, expect, it } from "@jest/globals";
import { createMockPayment } from "../../../supabase/functions/_shared/integrations/payment-mock.ts";
import { confirmPayment } from "../../../supabase/functions/_shared/commerce/orders.ts";
import { runRenewals, supabaseRenewalStore, type RenewalStore } from "../../../supabase/functions/_shared/commerce/renewal.ts";
import { supabaseOrderStore, type RpcClient } from "../../../supabase/functions/_shared/commerce/supabase-store.ts";
import { fail, ok } from "../../../supabase/functions/_shared/integrations/result.ts";
import { MemoryStore } from "./support/memory-store.ts";

const FIRST = "tho_0123456789abcdef0123456789abcdef";
const RENEWAL_REF = "ren_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PRICE = 12_900_000;
const CARD = { code: "AUTH_card_1", reusable: true, signature: "SIG_1", brand: "visa", last4: "4081", expMonth: "12", expYear: "2030", channel: "card" } as const;

async function renewable(orderAmount: number) {
  const payments = createMockPayment();
  const store = new MemoryStore();
  store.add({ reference: FIRST, amountKobo: PRICE });
  await payments.initializeTransaction({ reference: FIRST, email: "p@example.com", amountKobo: PRICE, metadata: { kind: "order", order_id: "order-1" } });
  payments.setAuthorization(FIRST, CARD);
  payments.settle(FIRST, "success");
  await confirmPayment({ payments, store }, { reference: FIRST, source: "return" });
  store.add({ reference: RENEWAL_REF, amountKobo: orderAmount });
  const attempts: { outcome: string }[] = [];
  const renewals: RenewalStore = {
    due: async () => ok(["m-1"]),
    openReferences: async () => ok([]),
    prepare: async () => ok({ prepared: { orderId: "order-2", reference: RENEWAL_REF, amountKobo: PRICE, email: "p@example.com", authorizationCode: CARD.code, attemptNo: 1 } }),
    recordAttempt: async (_ref, outcome) => { attempts.push({ outcome }); return ok(true); },
  };
  return { payments, store, renewals, attempts };
}

describe("runRenewals: a charge Paystack accepted but the database could not confirm", () => {
  it("is PENDING (the webhook or the next run confirms it), never failed", async () => {
    const { payments, store, renewals, attempts } = await renewable(PRICE);
    const dropping = Object.create(store, { record: { value: async () => fail("network", "db down") } }) as MemoryStore;
    const r = await runRenewals({ payments, store: dropping, renewals });
    expect(r).toMatchObject({ ok: true, data: { pending: 1, failed: 0, renewed: 0 } });
    expect(attempts).toEqual([{ outcome: "pending" }]);
  });

  it("a payment that does not match the order is failed and flagged, never marked renewed", async () => {
    const { payments, store, renewals, attempts } = await renewable(PRICE + 1);
    const r = await runRenewals({ payments, store, renewals });
    expect(r).toMatchObject({ ok: true, data: { failed: 1, renewed: 0 } });
    expect(store.mismatches).toHaveLength(1);
    expect(attempts).toEqual([{ outcome: "failed" }]);
  });
});

function rpc(handler: (fn: string, a: Record<string, unknown>) => { data: unknown; error: { message: string } | null } | "throw"): RpcClient & { calls: Array<[string, Record<string, unknown>]> } {
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

describe("supabaseRenewalStore", () => {
  it("reads who is due, earlier references, a prepared order, a skip, and records the outcome", async () => {
    const c = rpc((fn) => {
      if (fn === "service_due_membership_renewals") return { data: [{ membership_id: "m-1" }, { nope: 1 }], error: null };
      if (fn === "service_renewal_open_references") return { data: [{ reference: "ren_x1234567" }, { nope: 1 }], error: null };
      if (fn === "service_prepare_membership_renewal") return { data: { order_id: "o-2", reference: "ren_y1234567", amount_kobo: 12_900_000, email: "p@example.com", authorization_code: "AUTH_1", attempt_no: 2 }, error: null };
      return { data: {}, error: null };
    });
    const s = supabaseRenewalStore(c);
    expect(await s.due(5)).toEqual({ ok: true, data: ["m-1"] });
    expect(await s.openReferences("m-1")).toEqual({ ok: true, data: ["ren_x1234567"] });
    expect(await s.prepare("m-1")).toEqual({ ok: true, data: { prepared: { orderId: "o-2", reference: "ren_y1234567", amountKobo: 12_900_000, email: "p@example.com", authorizationCode: "AUTH_1", attemptNo: 2 } } });
    expect(await s.recordAttempt("ren_y1234567", "failed", "declined")).toEqual({ ok: true, data: true });
    expect(c.calls[0]).toEqual(["service_due_membership_renewals", { p_limit: 5 }]);
    expect(c.calls[3]).toEqual(["service_record_renewal_attempt", { p_reference: "ren_y1234567", p_outcome: "failed", p_error: "declined" }]);
    const skipping = supabaseRenewalStore(rpc(() => ({ data: { skip: "too_soon" }, error: null })));
    expect(await skipping.prepare("m-1")).toEqual({ ok: true, data: { skip: "too_soon" } });
  });

  it("turns an error, a throw or a strange reply into a failure value, never an exception", async () => {
    const bad = supabaseRenewalStore(rpc(() => ({ data: null, error: { message: "boom" } })));
    for (const r of [await bad.due(1), await bad.openReferences("m"), await bad.prepare("m"), await bad.recordAttempt("r", "failed", null)]) expect(r.ok).toBe(false);
    const thrown = supabaseRenewalStore(rpc(() => "throw"));
    expect((await thrown.due(1)).ok).toBe(false);
    const odd = supabaseRenewalStore(rpc(() => ({ data: "what", error: null })));
    expect(await odd.due(1)).toMatchObject({ ok: false, error: { code: "bad_response" } });
    expect(await odd.openReferences("m")).toMatchObject({ ok: false, error: { code: "bad_response" } });
    expect(await odd.prepare("m")).toMatchObject({ ok: false, error: { code: "bad_response" } });
    const partial = supabaseRenewalStore(rpc(() => ({ data: { order_id: "o" }, error: null })));
    expect(await partial.prepare("m")).toMatchObject({ ok: false, error: { code: "bad_response" } });
  });
});

describe("supabaseOrderStore.saveCard", () => {
  it("calls save_membership_card with the card fields and returns the database's verdict", async () => {
    const c = rpc(() => ({ data: { result: "saved" }, error: null }));
    const s = supabaseOrderStore(c);
    expect(await s.saveCard({ reference: FIRST, authorization: CARD, customerCode: "CUS_1", email: "p@example.com" })).toEqual({ ok: true, data: "saved" });
    expect(c.calls[0]).toEqual(["save_membership_card", {
      p_reference: FIRST, p_authorization_code: CARD.code, p_reusable: true, p_signature: "SIG_1", p_brand: "visa", p_last4: "4081",
      p_exp_month: "12", p_exp_year: "2030", p_customer_code: "CUS_1", p_email: "p@example.com",
    }]);
    expect(await supabaseOrderStore(rpc(() => ({ data: "x", error: null }))).saveCard({ reference: FIRST, authorization: CARD, customerCode: null, email: null })).toEqual({ ok: true, data: "unknown" });
    expect((await supabaseOrderStore(rpc(() => ({ data: null, error: { message: "e" } }))).saveCard({ reference: FIRST, authorization: CARD, customerCode: null, email: null })).ok).toBe(false);
  });
});
