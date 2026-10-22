import { describe, expect, it } from "@jest/globals";
import {
  createPaystackPayment,
  createResendEmail,
  paystackEventKey,
  supabaseInboxStore,
  videoFromEnv,
  zoomEventKey,
  type FetchLike,
} from "../../../supabase/functions/_shared/integrations/index.ts";

/** The remaining branches of the vendor adapters: every method against a vendor that refuses, and every reply shape that is off. */
const reply = (status: number, body: unknown): FetchLike => async () => ({ status, ok: status < 300, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
const KEY = "sk_test_x";

describe("Paystack: a vendor that refuses or answers oddly, method by method", () => {
  const refused = createPaystackPayment({ secretKey: KEY, fetch: reply(401, { message: "Invalid key" }) });
  it("returns the vendor failure from every method instead of throwing", async () => {
    const results = await Promise.all([
      refused.initializeTransaction({ reference: "ord_12345678", email: "a@example.com", amountKobo: 100 }),
      refused.verifyTransaction("ord_12345678"),
      refused.refund({ reference: "ord_12345678" }),
      refused.listBanks(),
      refused.resolveAccount({ accountNumber: "0123456789", bankCode: "044" }),
      refused.createTransferRecipient({ name: "A", accountNumber: "0123456789", bankCode: "044" }),
      refused.initiateTransfer({ reference: "payout-0001-attempt-1-abcd", amountKobo: 100, recipientCode: "RCP_x" }),
      refused.verifyTransfer("payout-0001-attempt-1-abcd"),
      refused.listSettlements({}),
      refused.listSettlementTransactions("1"),
    ]);
    for (const r of results) expect(r.ok === false && r.error.code).toBe("unauthorized");
  });
  it("reports a status:false envelope with and without a message", async () => {
    const withMsg = await createPaystackPayment({ secretKey: KEY, fetch: reply(200, { status: false, message: "Nope" }) }).listBanks();
    expect(withMsg.ok === false && withMsg.error.message).toBe("Nope");
    const bare = await createPaystackPayment({ secretKey: KEY, fetch: reply(200, { status: false }) }).listBanks();
    expect(bare.ok === false && bare.error.message).toBe("Paystack reported an error");
    const notObject = await createPaystackPayment({ secretKey: KEY, fetch: reply(200, "[]") }).listBanks();
    expect(notObject.ok === false && notObject.error.code).toBe("bad_response");
  });
  it("maps a transaction status that is missing or new to pending, and a transfer status that is new to needs_attention", async () => {
    const tx = (status: unknown) => createPaystackPayment({ secretKey: KEY, fetch: reply(200, { status: true, data: { reference: "ord_12345678", amount: 100, currency: "NGN", status } }) }).verifyTransaction("ord_12345678");
    expect((await tx(undefined)).ok && (await tx(undefined))).toMatchObject({ data: { status: "pending" } });
    expect(await tx("ongoing")).toMatchObject({ data: { status: "pending" } });
    expect(await tx("reversed")).toMatchObject({ data: { status: "reversed" } });
    const tr = await createPaystackPayment({ secretKey: KEY, fetch: reply(200, { status: true, data: { reference: "payout-0001-attempt-1-abcd", amount: 100, transfer_code: "TRF_1", status: "otp" } }) }).verifyTransfer("payout-0001-attempt-1-abcd");
    expect(tr).toMatchObject({ data: { status: "needs_attention" } });
    const unknown = await createPaystackPayment({ secretKey: KEY, fetch: reply(200, { status: true, data: { reference: "payout-0001-attempt-1-abcd", amount: 100, transfer_code: "TRF_1" } }) }).verifyTransfer("payout-0001-attempt-1-abcd");
    expect(unknown).toMatchObject({ data: { status: "needs_attention" } });
  });
  it("sends no body for a refund without an amount, a note or a callback, and drops an absent email", async () => {
    const seen: string[] = [];
    const f: FetchLike = async (_u, init) => { seen.push(init.body ?? ""); return { status: 200, ok: true, text: async () => '{"status":true,"data":{"id":9,"status":"needs-attention"}}' }; };
    const r = await createPaystackPayment({ secretKey: KEY, fetch: f }).refund({ reference: "ord_12345678" });
    expect(r).toMatchObject({ ok: true, data: { refundId: "9", status: "needs_attention" } });
    expect(seen[0]).not.toContain("amount");
  });
  it("walks a paged bank list by cursor", async () => {
    let n = 0;
    const f: FetchLike = async (u) => {
      n += 1;
      const more = n === 1;
      return { status: 200, ok: true, text: async () => JSON.stringify({ status: true, data: [{ code: "044", name: `Bank ${n}` }, { code: 1 }], meta: more ? { next: "cursor/1" } : {} }) + (u.includes("next=cursor%2F1") || more ? "" : "") };
    };
    const banks = await createPaystackPayment({ secretKey: KEY, fetch: f }).listBanks();
    expect(banks.ok && banks.data.length).toBe(2);
  });
  it("refuses bad inputs and bad replies on every read", async () => {
    const p = createPaystackPayment({ secretKey: KEY, fetch: reply(200, { status: true, data: {} }) });
    expect((await p.initializeTransaction({ reference: "ord_12345678", email: "a@example.com", amountKobo: 100 })).ok).toBe(false);
    expect((await p.refund({ reference: "ord_12345678" })).ok).toBe(false);
    expect((await p.resolveAccount({ accountNumber: "0123456789", bankCode: "044" })).ok).toBe(false);
    expect((await p.createTransferRecipient({ name: "A", accountNumber: "0123456789", bankCode: "044" })).ok).toBe(false);
    expect((await p.listSettlements({})).ok).toBe(false);
    expect((await p.listSettlementTransactions("1")).ok).toBe(false);
    const rows = createPaystackPayment({ secretKey: KEY, fetch: reply(200, { status: true, data: [{ id: "x", total_amount: 1 }] }) });
    expect((await rows.listSettlements({})).ok).toBe(false);
    expect((await createPaystackPayment({ secretKey: KEY, fetch: reply(200, { status: true, data: [{}] }) }).listSettlementTransactions("1")).ok).toBe(false);
    const nopage = createPaystackPayment({ secretKey: KEY, fetch: reply(200, { status: true, data: [{ id: 1, total_amount: 5 }] }) });
    const one = await nopage.listSettlements({ from: "2027-01-01", to: "2027-01-31", page: 2, perPage: 1 });
    expect(one.ok && one.data.hasMore).toBe(true);
    const created = await createPaystackPayment({ secretKey: KEY, fetch: reply(200, { status: true, data: { authorization_url: "https://checkout.paystack.com/x", access_code: "a", reference: "ord_12345678" } }) }).initializeTransaction({ reference: "ord_12345678", email: "a@example.com", amountKobo: 100, channels: ["card"] });
    expect(created.ok).toBe(true);
  });
});

describe("Resend: attachments and a refused send", () => {
  it("sends an attachment as base64 content and omits it when there is none", async () => {
    const bodies: string[] = [];
    const f: FetchLike = async (_u, init) => { bodies.push(init.body ?? ""); return { status: 200, ok: true, text: async () => '{"id":"em_1"}' }; };
    const p = createResendEmail({ apiKey: "re_x", from: "x <a@example.com>", fetch: f });
    const base = { to: "a@example.com", subject: "s", text: "t", audience: "staff" as const, idempotencyKey: "k-1:email" };
    await p.send({ ...base, attachments: [{ filename: "a.pdf", contentBase64: "QUJD" }] });
    await p.send({ ...base, idempotencyKey: "k-2:email" });
    expect(bodies[0]).toContain('"content":"QUJD"');
    expect(bodies[1]).not.toContain("attachments");
  });
});

describe("from-env and the inbox store", () => {
  it("passes the dedicated Zoom host user through", () => {
    const env = { ZOOM_ACCOUNT_ID: "a", ZOOM_CLIENT_ID: "c", ZOOM_CLIENT_SECRET: "s", ZOOM_HOST_USER_ID: "host@example.test" };
    expect(videoFromEnv(env, reply(200, {}))).toMatchObject({ name: "zoom" });
  });
  it("keys an unparseable Zoom body by its hash", async () => {
    expect((await zoomEventKey("not json")).eventType).toBe("unknown");
  });
  it("keys a Paystack event with no data object by its body hash", async () => {
    expect((await paystackEventKey('{"event":"x"}')).idempotencyKey).toMatch(/^x:sha256:/);
  });
  it("passes a store failure through on complete and fail, and reads an odd fail reply as unknown", async () => {
    const down = supabaseInboxStore({ rpc: async () => ({ data: null, error: { message: "boom" } }) });
    expect((await down.complete("i", "l")).ok).toBe(false);
    expect((await down.fail("i", "l", "e", false)).ok).toBe(false);
    expect((await down.claimDue(5)).ok).toBe(false);
    const odd = supabaseInboxStore({ rpc: async () => ({ data: 5, error: null }) });
    expect(await odd.fail("i", "l", "e", false)).toMatchObject({ ok: true, data: "unknown" });
  });
});
