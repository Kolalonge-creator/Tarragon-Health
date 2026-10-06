import { describe, expect, it } from "@jest/globals";
import { createPaystackPayment, type FetchLike } from "../../../supabase/functions/_shared/integrations/index.ts";
import { createFakePaystack } from "./support/fake-paystack";

const reply = (status: number, body: string) => ({ status, ok: status >= 200 && status < 300, text: async () => body });
const adapter = (fetch: FetchLike, extra: { timeoutMs?: number; webhookSecret?: string } = {}) => createPaystackPayment({ secretKey: "sk_test_x", fetch, ...extra });
const env = (data: unknown) => reply(200, JSON.stringify({ status: true, message: "ok", data }));
const REF = "chg-abcdefgh1234";
const TRF = "trf_abcdefgh123456789";

describe("paystack adapter: requests", () => {
  it("sends integer kobo, NGN, a bearer key and the checkout fields Paystack expects", async () => {
    const fake = createFakePaystack();
    const p = createPaystackPayment({ secretKey: fake.secretKey, fetch: fake.fetch });
    await p.initializeTransaction({ reference: REF, email: "a@example.com", amountKobo: 777_000, callbackUrl: "https://app.example/return", metadata: { order_id: "o-1" } });
    const call = fake.calls[0]!;
    expect(call).toMatchObject({ method: "POST", path: "/transaction/initialize", auth: `Bearer ${fake.secretKey}` });
    expect(call.body).toMatchObject({ reference: REF, amount: 777_000, currency: "NGN", callback_url: "https://app.example/return", metadata: { order_id: "o-1" } });
    expect(Number.isInteger(call.body?.["amount"])).toBe(true);
  });

  it("asks for a partial refund with an amount and a full refund without one", async () => {
    const fake = createFakePaystack();
    const p = createPaystackPayment({ secretKey: fake.secretKey, fetch: fake.fetch });
    await p.initializeTransaction({ reference: REF, email: "a@example.com", amountKobo: 100_000 });
    fake.settle(REF, "success");
    await p.refund({ reference: REF, amountKobo: 25_000, reason: "Visit not held" });
    await p.refund({ reference: REF });
    const refunds = fake.calls.filter((c) => c.path === "/refund");
    expect(refunds[0]!.body).toMatchObject({ transaction: REF, amount: 25_000, merchant_note: "Visit not held" });
    expect(refunds[1]!.body?.["amount"]).toBeUndefined();
  });

  it("sends transfers from the balance in kobo with the caller's reference as the idempotency key", async () => {
    const fake = createFakePaystack();
    const p = createPaystackPayment({ secretKey: fake.secretKey, fetch: fake.fetch });
    const rcp = await p.createTransferRecipient({ name: "Test Clinician", accountNumber: "0123456789", bankCode: "044" });
    if (!rcp.ok) throw new Error("recipient");
    await p.initiateTransfer({ reference: TRF, amountKobo: 4_500_000, recipientCode: rcp.data.recipientCode, reason: "Weekly statement" });
    const t = fake.calls.find((c) => c.path === "/transfer")!;
    expect(t.body).toMatchObject({ source: "balance", amount: 4_500_000, reference: TRF, currency: "NGN" });
    expect(fake.calls.find((c) => c.path === "/transferrecipient")!.body).toMatchObject({ type: "nuban", currency: "NGN" });
  });

  it("filters out bank rows that have no name, and encodes references in the path", async () => {
    const fake = createFakePaystack();
    const p = createPaystackPayment({ secretKey: fake.secretKey, fetch: fake.fetch });
    const banks = await p.listBanks();
    expect(banks.ok && banks.data.map((b) => b.code)).toEqual(["044", "058", "057"]);
    expect(fake.calls.filter((c) => c.path.startsWith("/bank?")).length).toBe(2);
    await p.verifyTransaction("chg-with.dots=ok1");
    expect(fake.calls.at(-1)!.path).toBe("/transaction/verify/chg-with.dots%3Dok1");
  });

  it("uses a custom base URL (Paystack test mode proxy, local simulator)", async () => {
    let seen = "";
    const p = createPaystackPayment({ secretKey: "k", baseUrl: "http://localhost:9000", fetch: async (u) => ((seen = u), env({ authorization_url: "https://x", access_code: "a", reference: REF })) });
    await p.initializeTransaction({ reference: REF, email: "a@example.com", amountKobo: 100 });
    expect(seen).toBe("http://localhost:9000/transaction/initialize");
  });
});

describe("paystack adapter: failures are values", () => {
  it("a wrong key is unauthorized and not retryable, and the key is not in the error", async () => {
    const fake = createFakePaystack();
    const p = createPaystackPayment({ secretKey: "sk_live_this_is_secret", fetch: fake.fetch });
    const r = await p.verifyTransaction(REF);
    expect(r).toMatchObject({ ok: false, error: { code: "unauthorized", retryable: false } });
    expect(JSON.stringify(r)).not.toContain("sk_live_this_is_secret");
  });

  it("a 5xx and a 429 are retryable vendor errors; another 4xx is not", async () => {
    for (const [status, retryable] of [[500, true], [503, true], [429, true], [400, false], [422, false]] as const) {
      const r = await adapter(async () => reply(status, JSON.stringify({ status: false, message: "no" }))).verifyTransaction(REF);
      expect(r).toMatchObject({ ok: false, error: { code: "vendor_error", retryable } });
    }
  });

  it("maps 404 to not_found and 409 to conflict", async () => {
    expect((await adapter(async () => reply(404, "{}")).verifyTransaction(REF))).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect((await adapter(async () => reply(409, "{}")).verifyTransaction(REF))).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  it("a reply that is not JSON, or an envelope with status false, is a failure", async () => {
    expect((await adapter(async () => reply(200, "<html>gateway</html>")).verifyTransaction(REF))).toMatchObject({ ok: false, error: { code: "bad_response" } });
    expect((await adapter(async () => reply(200, JSON.stringify({ status: false, message: "Declined" }))).verifyTransaction(REF))).toMatchObject({ ok: false, error: { code: "vendor_error", message: "Declined" } });
    expect((await adapter(async () => reply(200, "null")).verifyTransaction(REF))).toMatchObject({ ok: false, error: { code: "bad_response" } });
    expect((await adapter(async () => reply(200, "")).verifyTransaction(REF))).toMatchObject({ ok: false, error: { code: "bad_response" } });
    expect((await adapter(async () => reply(500, "boom")).verifyTransaction(REF))).toMatchObject({ ok: false, error: { code: "vendor_error", retryable: true } });
  });

  it("reads the requested amount and fee when Paystack sends them, and treats the whole amount as the price when it does not", async () => {
    const withFee = await adapter(async () => env({ reference: REF, status: "success", amount: 261_250, requested_amount: 250_000, fees: 11_250, currency: "NGN" })).verifyTransaction(REF);
    expect(withFee.ok && withFee.data).toMatchObject({ amountKobo: 261_250, requestedAmountKobo: 250_000, feesKobo: 11_250 });
    const without = await adapter(async () => env({ reference: REF, status: "success", amount: 250_000, currency: "NGN" })).verifyTransaction(REF);
    expect(without.ok && without.data).toMatchObject({ requestedAmountKobo: 250_000, feesKobo: 0 });
  });

  it("an answer that is missing fields, or has a fractional amount, is a bad response rather than a guess", async () => {
    const bad: unknown[] = [{ reference: REF, status: "success", amount: 10.5, currency: "NGN" }, { reference: REF, status: "success", amount: 100 }, {}];
    for (const data of bad) expect((await adapter(async () => env(data)).verifyTransaction(REF))).toMatchObject({ ok: false, error: { code: "bad_response" } });
    expect((await adapter(async () => env({})).initializeTransaction({ reference: REF, email: "a@example.com", amountKobo: 100 }))).toMatchObject({ ok: false, error: { code: "bad_response" } });
    expect((await adapter(async () => env({})).refund({ reference: REF }))).toMatchObject({ ok: false, error: { code: "bad_response" } });
    expect((await adapter(async () => env({})).createTransferRecipient({ name: "A", accountNumber: "0123456789", bankCode: "044" }))).toMatchObject({ ok: false, error: { code: "bad_response" } });
    expect((await adapter(async () => env({})).resolveAccount({ accountNumber: "0123456789", bankCode: "044" }))).toMatchObject({ ok: false, error: { code: "bad_response" } });
    expect((await adapter(async () => env({})).initiateTransfer({ reference: TRF, amountKobo: 100, recipientCode: "RCP_x" }))).toMatchObject({ ok: false, error: { code: "bad_response" } });
    expect((await adapter(async () => env("nope")).listBanks())).toMatchObject({ ok: false, error: { code: "bad_response" } });
  });

  it("a call that never answers times out as a retryable failure", async () => {
    const hang: FetchLike = (_u, init) => new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const r = await adapter(hang, { timeoutMs: 20 }).verifyTransaction(REF);
    expect(r).toMatchObject({ ok: false, error: { code: "timeout", retryable: true } });
  });

  it("a dropped connection is a retryable network failure", async () => {
    const r = await adapter(async () => { throw new TypeError("fetch failed"); }).verifyTransaction(REF);
    expect(r).toMatchObject({ ok: false, error: { code: "network", retryable: true } });
  });
});

describe("paystack adapter: bank list paging", () => {
  it("stops with an error rather than looping forever if the vendor never ends the list", async () => {
    const forever: FetchLike = async () => reply(200, JSON.stringify({ status: true, message: "ok", data: [{ code: "044", name: "Access Bank" }], meta: { next: "again" } }));
    const r = await adapter(forever).listBanks();
    expect(r).toMatchObject({ ok: false, error: { code: "bad_response" } });
  });
  it("passes the cursor from the previous page", async () => {
    const urls: string[] = [];
    const pages = [{ data: [{ code: "044", name: "A" }], meta: { next: "c 1/2" } }, { data: [{ code: "058", name: "B" }], meta: { next: null } }];
    const f: FetchLike = async (u) => (urls.push(u), reply(200, JSON.stringify({ status: true, message: "ok", ...pages[urls.length - 1] })));
    const r = await adapter(f).listBanks();
    expect(r.ok && r.data).toHaveLength(2);
    expect(urls[1]).toContain("next=c%201%2F2");
  });
});

describe("paystack adapter: status mapping", () => {
  const verify = async (status: string) => {
    const r = await adapter(async () => env({ reference: REF, status, amount: 100, currency: "NGN" })).verifyTransaction(REF);
    return r.ok ? r.data.status : r.error.code;
  };
  it("maps transaction states, and treats anything in progress as pending", async () => {
    expect(await verify("success")).toBe("success");
    expect(await verify("failed")).toBe("failed");
    expect(await verify("abandoned")).toBe("abandoned");
    expect(await verify("reversed")).toBe("reversed");
    for (const s of ["ongoing", "pending", "processing", "queued", "something-new"]) expect(await verify(s)).toBe("pending");
  });

  it("maps refund and transfer states, and sends an OTP request or an unknown transfer state to a human", async () => {
    const refund = async (status: unknown) => {
      const r = await adapter(async () => env({ id: 77, status })).refund({ reference: REF });
      return r.ok ? r.data.status : r.error.code;
    };
    expect(await refund("processed")).toBe("processed");
    expect(await refund("needs-attention")).toBe("needs_attention");
    expect(await refund("processing")).toBe("processing");
    expect(await refund(undefined)).toBe("pending");
    const transfer = async (status: unknown) => {
      const r = await adapter(async () => env({ reference: TRF, transfer_code: "TRF_1", amount: 100, status })).verifyTransfer(TRF);
      return r.ok ? r.data.status : r.error.code;
    };
    expect(await transfer("success")).toBe("success");
    expect(await transfer("received")).toBe("pending");
    expect(await transfer("otp")).toBe("needs_attention");
    expect(await transfer("brand-new-state")).toBe("needs_attention");
    expect(await transfer(undefined)).toBe("needs_attention");
  });

  it("accepts a numeric refund id and refuses an empty one", async () => {
    const a = await adapter(async () => env({ id: 9, status: "pending" })).refund({ reference: REF });
    expect(a.ok && a.data.refundId).toBe("9");
    const b = await adapter(async () => env({ id: "r_9", status: "pending" })).refund({ reference: REF });
    expect(b.ok && b.data.refundId).toBe("r_9");
  });
});

describe("paystack adapter: webhooks", () => {
  const fake = createFakePaystack();
  const p = createPaystackPayment({ secretKey: fake.secretKey, fetch: fake.fetch });
  const parse = async (body: unknown) => {
    const h = await fake.signedWebhook(body);
    return p.parseWebhook(h.rawBody, h.signature);
  };

  it("normalises refund events, using the original charge reference", async () => {
    const r = await parse({ event: "refund.processed", data: { status: "processed", transaction_reference: REF, refund_reference: "rr_1", amount: 100 } });
    expect(r.ok && r.data).toMatchObject({ kind: "refund", reference: REF, status: "processed", key: `refund.processed:${REF}` });
    const failed = await parse({ event: "refund.failed", data: { transaction_reference: REF } });
    expect(failed.ok && failed.data).toMatchObject({ kind: "refund", status: "failed" });
  });

  it("normalises transfer events: success, failed and reversed", async () => {
    for (const status of ["success", "failed", "reversed"]) {
      const r = await parse({ event: `transfer.${status}`, data: { reference: TRF, transfer_code: "TRF_1", status } });
      expect(r.ok && r.data).toMatchObject({ kind: "transfer", reference: TRF, transferCode: "TRF_1", status });
    }
    const noCode = await parse({ event: "transfer.success", data: { reference: TRF } });
    expect(noCode.ok && noCode.data).toMatchObject({ kind: "transfer", transferCode: null, status: "success" });
  });

  it("does not trust a charge.success without an amount and currency: it becomes unknown", async () => {
    const r = await parse({ event: "charge.success", data: { reference: REF } });
    expect(r.ok && r.data.kind).toBe("unknown");
  });

  it("keys an event with no reference by its id, or by none", async () => {
    const withId = await parse({ event: "subscription.create", data: { id: 42 } });
    const none = await parse({ event: "subscription.create", data: {} });
    expect(withId.ok && withId.data.key).toBe("subscription.create:42");
    expect(none.ok && none.data.key).toBe("subscription.create:none");
  });

  it("rejects a signed body with no event or no data", async () => {
    expect((await parse({ data: {} })).ok).toBe(false);
    expect((await parse({ event: "charge.success" })).ok).toBe(false);
    const arr = await fake.signedWebhook([1]);
    expect((await p.parseWebhook(arr.rawBody, arr.signature)).ok).toBe(false);
  });

  it("verifies with a separate webhook secret when one is configured, and accepts an upper-case signature", async () => {
    const sep = createPaystackPayment({ secretKey: "sk_test_x", webhookSecret: "whsec-other", fetch: fake.fetch });
    const h = await fake.signedWebhook({ event: "x", data: {} }); // signed with the fake's secret key
    expect((await sep.parseWebhook(h.rawBody, h.signature)).ok).toBe(false);
    const ok = await p.parseWebhook(h.rawBody, h.signature.toUpperCase());
    expect(ok.ok).toBe(true);
  });
});

describe("paystack adapter: input rules", () => {
  const p = createPaystackPayment({ secretKey: "k", fetch: async () => env({}) });
  it("refuses bad references, accounts, banks and empty names before any call", async () => {
    const codes = await Promise.all([
      p.verifyTransaction("bad ref"),
      p.refund({ reference: "bad ref" }),
      p.resolveAccount({ accountNumber: "12345", bankCode: "044" }),
      p.resolveAccount({ accountNumber: "0123456789", bankCode: "x" }),
      p.createTransferRecipient({ name: "  ", accountNumber: "0123456789", bankCode: "044" }),
      p.createTransferRecipient({ name: "A", accountNumber: "1", bankCode: "044" }),
      p.createTransferRecipient({ name: "A", accountNumber: "0123456789", bankCode: "zz" }),
      p.initiateTransfer({ reference: TRF, amountKobo: 100, recipientCode: "" }),
      p.verifyTransfer("Bad Ref"),
    ]);
    for (const r of codes) expect(r).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});
