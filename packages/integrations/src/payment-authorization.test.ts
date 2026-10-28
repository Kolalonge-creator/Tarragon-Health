import { describe, expect, it } from "@jest/globals";
import { createMockPayment, createPaystackPayment, type FetchLike } from "../../../supabase/functions/_shared/integrations/index.ts";

/**
 * Saved-card support for Membership auto-renewal: the processor reports which card paid (and whether it can be charged again),
 * and a reusable card can be charged with a fresh reference. Proved for the in-memory mock and for the Paystack adapter over a
 * fake vendor, so the mock refuses what the real adapter would.
 */
const REF = "chg-abcdefgh1234";
const NEW_REF = "ren_abcdefgh1234";
const CARD = { code: "AUTH_card_1", reusable: true, signature: "SIG_1", brand: "visa", last4: "4081", expMonth: "12", expYear: "2030", channel: "card" } as const;

async function mockWithCard() {
  const p = createMockPayment();
  await p.initializeTransaction({ reference: REF, email: "a@example.com", amountKobo: 12_900_000, metadata: { kind: "order" } });
  p.setAuthorization(REF, CARD);
  p.settle(REF, "success");
  return p;
}

describe("mock payment: saved cards", () => {
  it("reports the card on a successful payment and never on an unpaid one", async () => {
    const p = await mockWithCard();
    const paid = await p.verifyTransaction(REF);
    expect(paid.ok && paid.data.authorization).toMatchObject({ code: "AUTH_card_1", reusable: true, last4: "4081" });
    expect(paid.ok && paid.data.customerCode).toBe("CUS_a@example.com");
    const q = createMockPayment();
    await q.initializeTransaction({ reference: REF, email: "a@example.com", amountKobo: 100_000 });
    const pending = await q.verifyTransaction(REF);
    expect(pending.ok && pending.data.authorization).toBeNull();
  });

  it("setAuthorization on an unknown reference is a test error", () => {
    expect(() => createMockPayment().setAuthorization("nope-nope-nope", CARD)).toThrow("unknown reference");
  });

  it("charges a reusable card for the exact amount, with a new reference, and the result verifies", async () => {
    const p = await mockWithCard();
    const r = await p.chargeAuthorization({ reference: NEW_REF, email: "a@example.com", amountKobo: 12_900_000, authorizationCode: CARD.code, metadata: { kind: "order", renewal: true } });
    expect(r).toMatchObject({ ok: true, data: { status: "success", amountKobo: 12_900_000, requestedAmountKobo: 12_900_000, authorization: { code: CARD.code } } });
    expect(p.chargeCalls).toEqual([{ reference: NEW_REF, email: "a@example.com", amountKobo: 12_900_000, authorizationCode: CARD.code }]);
    const v = await p.verifyTransaction(NEW_REF);
    expect(v.ok && v.data.metadata).toMatchObject({ renewal: true });
  });

  it("refuses an unknown or non-reusable authorization, a reused reference and bad input", async () => {
    const p = await mockWithCard();
    const base = { reference: NEW_REF, email: "a@example.com", amountKobo: 100_000, authorizationCode: CARD.code };
    expect(await p.chargeAuthorization({ ...base, authorizationCode: "AUTH_unknown" })).toMatchObject({ ok: false, error: { code: "vendor_error" } });
    const nr = createMockPayment();
    await nr.initializeTransaction({ reference: REF, email: "a@example.com", amountKobo: 100_000 });
    nr.setAuthorization(REF, { ...CARD, code: "AUTH_transfer", reusable: false });
    nr.settle(REF, "success");
    expect(await nr.chargeAuthorization({ ...base, authorizationCode: "AUTH_transfer" })).toMatchObject({ ok: false, error: { code: "vendor_error" } });
    expect((await p.chargeAuthorization({ ...base, reference: "x" })).ok).toBe(false);
    expect((await p.chargeAuthorization({ ...base, email: "not-an-email" })).ok).toBe(false);
    expect((await p.chargeAuthorization({ ...base, amountKobo: 0 })).ok).toBe(false);
    expect((await p.chargeAuthorization(base)).ok).toBe(true);
    expect(await p.chargeAuthorization(base)).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  it("can simulate Paystack adding its fee to a renewal with no separate requested amount, and verify agrees", async () => {
    const p = await mockWithCard();
    p.setRenewalFee(193_500);
    const r = await p.chargeAuthorization({ reference: NEW_REF, email: "a@example.com", amountKobo: 12_900_000, authorizationCode: CARD.code });
    expect(r).toMatchObject({ ok: true, data: { amountKobo: 13_093_500, requestedAmountKobo: 13_093_500, feesKobo: 193_500 } });
    const v = await p.verifyTransaction(NEW_REF);
    expect(v).toMatchObject({ ok: true, data: { amountKobo: 13_093_500, requestedAmountKobo: 13_093_500, feesKobo: 193_500 } });
  });

  it("can be driven to a decline, to pending, and to a dropped connection", async () => {
    const p = await mockWithCard();
    p.setChargeOutcome("failed");
    const failed = await p.chargeAuthorization({ reference: NEW_REF, email: "a@example.com", amountKobo: 100_000, authorizationCode: CARD.code });
    expect(failed).toMatchObject({ ok: true, data: { status: "failed", paidAt: null } });
    p.setChargeOutcome("pending");
    const pending = await p.chargeAuthorization({ reference: "ren_pendingpending", email: "a@example.com", amountKobo: 100_000, authorizationCode: CARD.code });
    expect(pending).toMatchObject({ ok: true, data: { status: "pending" } });
    p.failNextCall();
    expect(await p.chargeAuthorization({ reference: "ren_dropdropdrop", email: "a@example.com", amountKobo: 100_000, authorizationCode: CARD.code })).toMatchObject({ ok: false, error: { code: "network" } });
  });
});

const reply = (status: number, body: string) => ({ status, ok: status >= 200 && status < 300, text: async () => body });
const env = (data: unknown) => reply(200, JSON.stringify({ status: true, message: "ok", data }));
const adapter = (fetch: FetchLike) => createPaystackPayment({ secretKey: "sk_test_x", fetch });
const txn = (over: Record<string, unknown> = {}) => ({
  reference: NEW_REF, status: "success", amount: 12_900_000, requested_amount: 12_900_000, fees: 0, currency: "NGN", paid_at: "2026-10-26T06:00:00.000Z",
  customer: { email: "a@example.com", customer_code: "CUS_1" }, metadata: { kind: "order" },
  authorization: { authorization_code: "AUTH_card_1", reusable: true, signature: "SIG_1", brand: "visa", last4: "4081", exp_month: "12", exp_year: "2030", channel: "card" },
  ...over,
});

describe("paystack adapter: saved cards", () => {
  it("reads the card and customer code from verify, and says when a card is not reusable", async () => {
    const r = await adapter(async () => env(txn())).verifyTransaction(NEW_REF);
    expect(r.ok && r.data.authorization).toEqual({ code: "AUTH_card_1", reusable: true, signature: "SIG_1", brand: "visa", last4: "4081", expMonth: "12", expYear: "2030", channel: "card" });
    expect(r.ok && r.data.customerCode).toBe("CUS_1");
    const transfer = await adapter(async () => env(txn({ authorization: { authorization_code: "AUTH_t", reusable: false, channel: "bank_transfer", card_type: "transfer" } }))).verifyTransaction(NEW_REF);
    expect(transfer.ok && transfer.data.authorization).toMatchObject({ code: "AUTH_t", reusable: false, brand: "transfer", channel: "bank_transfer" });
  });

  it("returns no authorization when Paystack sends none or sends one with no code", async () => {
    const none = await adapter(async () => env(txn({ authorization: undefined, customer: { email: "a@example.com" } }))).verifyTransaction(NEW_REF);
    expect(none.ok && none.data.authorization).toBeNull();
    expect(none.ok && none.data.customerCode).toBeNull();
    const codeless = await adapter(async () => env(txn({ authorization: { reusable: true } }))).verifyTransaction(NEW_REF);
    expect(codeless.ok && codeless.data.authorization).toBeNull();
  });

  it("sends charge_authorization with integer kobo, NGN, the card code, email and the new reference, then reads the transaction", async () => {
    const seen: { url: string; body: unknown }[] = [];
    const p = adapter(async (url, init) => { seen.push({ url, body: JSON.parse(String((init as { body?: string } | undefined)?.body ?? "{}")) }); return env(txn()); });
    const r = await p.chargeAuthorization({ reference: NEW_REF, email: "a@example.com", amountKobo: 12_900_000, authorizationCode: "AUTH_card_1", metadata: { kind: "order", renewal: true } });
    expect(r).toMatchObject({ ok: true, data: { status: "success", amountKobo: 12_900_000 } });
    expect(seen[0]!.url).toBe("https://api.paystack.co/transaction/charge_authorization");
    expect(seen[0]!.body).toEqual({ authorization_code: "AUTH_card_1", email: "a@example.com", amount: 12_900_000, currency: "NGN", reference: NEW_REF, metadata: { kind: "order", renewal: true } });
  });

  it("refuses bad input before calling Paystack, and passes a vendor refusal through", async () => {
    let calls = 0;
    const p = adapter(async () => { calls += 1; return env(txn()); });
    const base = { reference: NEW_REF, email: "a@example.com", amountKobo: 100_000, authorizationCode: "AUTH_card_1" };
    expect((await p.chargeAuthorization({ ...base, reference: "x" })).ok).toBe(false);
    expect((await p.chargeAuthorization({ ...base, email: "nope" })).ok).toBe(false);
    expect((await p.chargeAuthorization({ ...base, amountKobo: 1.5 })).ok).toBe(false);
    expect((await p.chargeAuthorization({ ...base, authorizationCode: "" })).ok).toBe(false);
    expect(calls).toBe(0);
    const refused = await adapter(async () => reply(200, JSON.stringify({ status: false, message: "Authorization is not reusable" }))).chargeAuthorization(base);
    expect(refused).toMatchObject({ ok: false, error: { code: "vendor_error", message: "Authorization is not reusable" } });
    expect(await adapter(async () => reply(400, JSON.stringify({ status: false, message: "Duplicate Transaction Reference" }))).chargeAuthorization(base)).toMatchObject({ ok: false, error: { code: "conflict" } });
  });
});
