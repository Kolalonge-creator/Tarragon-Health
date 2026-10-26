import { describe, expect, it } from "@jest/globals";
import { createMockPayment } from "../../../supabase/functions/_shared/integrations/payment-mock.ts";
import { confirmPayment } from "../../../supabase/functions/_shared/commerce/orders.ts";
import { runRenewals, type PrepareResult, type RenewalStore } from "../../../supabase/functions/_shared/commerce/renewal.ts";
import { handleRenewal } from "../../../supabase/functions/membership-renewal/handler.ts";
import { fail, ok, type ProviderResult } from "../../../supabase/functions/_shared/integrations/result.ts";
import { MemoryStore } from "./support/memory-store.ts";

const FIRST = "tho_0123456789abcdef0123456789abcdef";
const PRICE = 12_900_000;
const CARD = { code: "AUTH_card_1", reusable: true, signature: "SIG_1", brand: "visa", last4: "4081", expMonth: "12", expYear: "2030", channel: "card" } as const;

/** A Membership that was paid for once with a card the buyer agreed to keep, so the mock knows the authorization. */
async function boughtWithCard() {
  const payments = createMockPayment();
  const store = new MemoryStore();
  store.add({ reference: FIRST, amountKobo: PRICE });
  await payments.initializeTransaction({ reference: FIRST, email: "p@example.com", amountKobo: PRICE, metadata: { kind: "order", order_id: "order-1" } });
  payments.setAuthorization(FIRST, CARD);
  payments.settle(FIRST, "success");
  return { payments, store };
}

interface Plan { open?: string[]; prepare?: PrepareResult; due?: string[]; ref?: string }
/** A fake of the database half. It records every attempt so a test can assert exactly how each ended. */
function fakeRenewals(plan: Plan = {}) {
  const attempts: { reference: string; outcome: string; error: string | null }[] = [];
  const calls = { prepare: 0 };
  const store: RenewalStore = {
    async due() { return ok(plan.due ?? ["m-1"]); },
    async openReferences() { return ok(plan.open ?? []); },
    async prepare() {
      calls.prepare += 1;
      return ok(plan.prepare ?? { prepared: { orderId: "order-2", reference: plan.ref ?? "ren_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", amountKobo: PRICE, email: "p@example.com", authorizationCode: CARD.code, attemptNo: 1 } });
    },
    async recordAttempt(reference, outcome, error) { attempts.push({ reference, outcome, error }); return ok(true); },
  };
  return { store, attempts, calls };
}

const RENEWAL_REF = "ren_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("confirmPayment offers the card after a paid order", () => {
  it("offers a reusable card once, and a failed save never changes the payment outcome", async () => {
    const { payments, store } = await boughtWithCard();
    const out = await confirmPayment({ payments, store }, { reference: FIRST, source: "return" });
    expect(out).toMatchObject({ outcome: "paid" });
    expect(store.savedCards).toHaveLength(1);
    expect(store.savedCards[0]!.authorization).toMatchObject({ code: CARD.code, reusable: true, last4: "4081" });
    expect(store.savedCards[0]!.email).toBe("p@example.com");
  });

  it("a failed save still leaves the order paid", async () => {
    const { payments, store } = await boughtWithCard();
    store.failSaveCard = true;
    expect(await confirmPayment({ payments, store }, { reference: FIRST, source: "webhook" })).toMatchObject({ outcome: "paid" });
    expect(store.orders.get(FIRST)!.state).toBe("paid");
  });

  it("offers nothing when Paystack sent no card", async () => {
    const payments = createMockPayment();
    const store = new MemoryStore();
    store.add({ reference: FIRST, amountKobo: PRICE });
    await payments.initializeTransaction({ reference: FIRST, email: "p@example.com", amountKobo: PRICE, metadata: { kind: "order" } });
    payments.settle(FIRST, "success");
    await confirmPayment({ payments, store }, { reference: FIRST, source: "return" });
    expect(store.savedCards).toHaveLength(0);
  });

  it("offers nothing for an unpaid order", async () => {
    const { payments, store } = await boughtWithCard();
    payments.settle(FIRST, "failed");
    await confirmPayment({ payments, store }, { reference: FIRST, source: "return" });
    expect(store.savedCards).toHaveLength(0);
  });
});

describe("runRenewals", () => {
  async function setup(plan: Plan = {}) {
    const { payments, store } = await boughtWithCard();
    await confirmPayment({ payments, store }, { reference: FIRST, source: "return" });
    store.add({ reference: plan.ref ?? RENEWAL_REF, amountKobo: PRICE });
    const renewals = fakeRenewals(plan);
    return { payments, store, renewals, deps: { payments, store, renewals: renewals.store } };
  }

  it("charges the saved card for the order's exact amount, confirms it through the normal path and records the attempt as charged", async () => {
    const { payments, store, renewals, deps } = await setup();
    const r = await runRenewals(deps);
    expect(r).toMatchObject({ ok: true, data: { considered: 1, renewed: 1, failed: 0, pending: 0 } });
    expect(payments.chargeCalls).toEqual([{ reference: RENEWAL_REF, email: "p@example.com", amountKobo: PRICE, authorizationCode: CARD.code }]);
    expect(store.orders.get(RENEWAL_REF)!.state).toBe("paid");
    expect(renewals.attempts).toEqual([{ reference: RENEWAL_REF, outcome: "charged", error: null }]);
  });

  it("marks the charge as order metadata so the existing webhook path handles it", async () => {
    const { payments, deps } = await setup();
    await runRenewals(deps);
    const v = await payments.verifyTransaction(RENEWAL_REF);
    expect(v.ok && v.data.metadata).toMatchObject({ kind: "order", order_id: "order-2", renewal: true });
  });

  it("a decline is recorded as failed and nothing is marked paid", async () => {
    const { payments, store, renewals, deps } = await setup();
    payments.setChargeOutcome("failed");
    const r = await runRenewals(deps);
    expect(r).toMatchObject({ ok: true, data: { renewed: 0, failed: 1 } });
    expect(store.orders.get(RENEWAL_REF)!.state).toBe("created");
    expect(renewals.attempts[0]).toMatchObject({ outcome: "failed" });
  });

  it("a charge Paystack has not finished is PENDING, never failed", async () => {
    const { payments, renewals, deps } = await setup();
    payments.setChargeOutcome("pending");
    expect(await runRenewals(deps)).toMatchObject({ ok: true, data: { pending: 1, failed: 0 } });
    expect(renewals.attempts[0]).toMatchObject({ outcome: "pending" });
  });

  it("a dropped connection on the charge is PENDING (it may have gone through), not failed", async () => {
    const { payments, renewals, deps } = await setup();
    payments.failNextCall();
    expect(await runRenewals(deps)).toMatchObject({ ok: true, data: { pending: 1, failed: 0 } });
    expect(renewals.attempts[0]).toMatchObject({ outcome: "pending" });
  });

  it("a card Paystack says is not reusable is a failure, not a retry loop", async () => {
    const { renewals, deps } = await setup({ prepare: { prepared: { orderId: "order-2", reference: RENEWAL_REF, amountKobo: PRICE, email: "p@example.com", authorizationCode: "AUTH_unknown", attemptNo: 1 } } });
    expect(await runRenewals(deps)).toMatchObject({ ok: true, data: { failed: 1 } });
    expect(renewals.attempts[0]).toMatchObject({ outcome: "failed" });
  });

  it("verifies an EARLIER attempt first: one that was actually paid is settled and NO second charge is made", async () => {
    const earlier = "ren_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const { payments, store, renewals, deps } = await setup({ open: [earlier] });
    store.add({ reference: earlier, amountKobo: PRICE });
    await payments.chargeAuthorization({ reference: earlier, email: "p@example.com", amountKobo: PRICE, authorizationCode: CARD.code, metadata: { kind: "order" } });
    payments.chargeCalls.length = 0;
    const r = await runRenewals(deps);
    expect(r).toMatchObject({ ok: true, data: { alreadyPaid: 1, renewed: 0 } });
    expect(payments.chargeCalls).toHaveLength(0);
    expect(renewals.calls.prepare).toBe(0);
    expect(store.orders.get(earlier)!.state).toBe("paid");
  });

  it("an earlier attempt still pending makes the run wait: no new order, no new charge", async () => {
    const earlier = "ren_cccccccccccccccccccccccccccccccc";
    const { payments, store, renewals, deps } = await setup({ open: [earlier] });
    store.add({ reference: earlier, amountKobo: PRICE });
    payments.setChargeOutcome("pending");
    await payments.chargeAuthorization({ reference: earlier, email: "p@example.com", amountKobo: PRICE, authorizationCode: CARD.code });
    payments.chargeCalls.length = 0;
    expect(await runRenewals(deps)).toMatchObject({ ok: true, data: { pending: 1 } });
    expect(payments.chargeCalls).toHaveLength(0);
    expect(renewals.calls.prepare).toBe(0);
  });

  it("an earlier attempt that definitely failed lets the run try again", async () => {
    const earlier = "ren_dddddddddddddddddddddddddddddddd";
    const { payments, store, deps } = await setup({ open: [earlier] });
    store.add({ reference: earlier, amountKobo: PRICE });
    payments.setChargeOutcome("failed");
    await payments.chargeAuthorization({ reference: earlier, email: "p@example.com", amountKobo: PRICE, authorizationCode: CARD.code });
    payments.setChargeOutcome("success");
    payments.chargeCalls.length = 0;
    expect(await runRenewals(deps)).toMatchObject({ ok: true, data: { renewed: 1 } });
    expect(payments.chargeCalls).toHaveLength(1);
  });

  it("when the database says skip (too soon, no card, exhausted) nothing is charged", async () => {
    const { payments, deps } = await setup({ prepare: { skip: "too_soon" } });
    expect(await runRenewals(deps)).toMatchObject({ ok: true, data: { skipped: 1, renewed: 0 } });
    expect(payments.chargeCalls).toHaveLength(0);
  });

  it("nothing due is a clean no-op", async () => {
    const { payments, deps } = await setup({ due: [] });
    expect(await runRenewals(deps)).toMatchObject({ ok: true, data: { considered: 0 } });
    expect(payments.chargeCalls).toHaveLength(0);
  });

  it("a database failure listing who is due fails the run without charging anyone", async () => {
    const { payments, deps } = await setup();
    const broken: RenewalStore = { ...deps.renewals, due: async (): Promise<ProviderResult<readonly string[]>> => fail("vendor_error", "db down", true) };
    expect((await runRenewals({ ...deps, renewals: broken })).ok).toBe(false);
    expect(payments.chargeCalls).toHaveLength(0);
  });
});

describe("membership-renewal handler", () => {
  const req = (secret?: string) => new Request("https://x.invalid/membership-renewal", { method: "POST", headers: secret === undefined ? {} : { "x-membership-renewal-secret": secret } });

  it("fails closed without a configured secret, with the wrong one, and without a payment provider", async () => {
    const { payments, store } = await boughtWithCard();
    const renewal = { payments, store, renewals: fakeRenewals({ due: [] }).store };
    expect((await handleRenewal(req("s"), { secret: null, renewal })).status).toBe(503);
    expect((await handleRenewal(req("wrong"), { secret: "s", renewal })).status).toBe(401);
    expect((await handleRenewal(req(), { secret: "s", renewal })).status).toBe(401);
    expect((await handleRenewal(req("s"), { secret: "s", renewal: null })).status).toBe(503);
  });

  it("runs the sweep for the right secret and returns the summary", async () => {
    const { payments, store } = await boughtWithCard();
    const res = await handleRenewal(req("s"), { secret: "s", renewal: { payments, store, renewals: fakeRenewals({ due: [] }).store } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ considered: 0, renewed: 0 });
  });
});
