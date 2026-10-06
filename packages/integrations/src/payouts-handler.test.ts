import { describe, expect, it } from "@jest/globals";
import { createMockPayment } from "../../../supabase/functions/_shared/integrations/index.ts";
import { sendPayout, verifyBank, type PayoutDeps, type RpcReply } from "../../../supabase/functions/_shared/payouts/handler.ts";

const ID = "11111111-2222-3333-4444-555555555555";
const REF = "tpo-11111111222233334444555555555555-01";

type Call = { who: "user" | "service"; fn: string; args: Record<string, unknown> };
function make(prepare?: RpcReply) {
  const payment = createMockPayment();
  const calls: Call[] = [];
  const deps: PayoutDeps = {
    payment,
    userId: "doc-1",
    asUser: async (fn, args = {}) => {
      calls.push({ who: "user", fn, args });
      return prepare ?? { data: { reference: REF, amount_kobo: 181_000, recipient_code: "RCP_x", reason: "Tarragon weekly payout" }, error: null };
    },
    asService: async (fn, args) => {
      calls.push({ who: "service", fn, args });
      if (fn === "record_bank_resolution") {
        const match = String(args["p_resolved_name"]).includes("OKAFOR");
        return { data: { id: "bank-1", name_match: match ? "verified" : "mismatch" }, error: null };
      }
      return { data: { payout_id: ID, state: "sent" }, error: null };
    },
  };
  return { deps, calls, payment };
}
async function recipient(payment: ReturnType<typeof createMockPayment>): Promise<string> {
  const r = await payment.createTransferRecipient({ name: "Ada Okafor", accountNumber: "0123456789", bankCode: "044" });
  if (!r.ok) throw new Error("recipient");
  return r.data.recipientCode;
}

describe("sendPayout", () => {
  it("refuses a malformed id before touching anything", async () => {
    const { deps, calls } = make();
    expect((await sendPayout(deps, "nope")).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("stops when the database refuses (guard off, not approved): nothing is recorded or sent", async () => {
    const { deps, calls } = make({ data: null, error: { message: "payout_guard_off" } });
    expect(await sendPayout(deps, ID)).toEqual({ status: 409, body: { error: "payout_guard_off" } });
    expect(calls.filter((c) => c.who === "service")).toEqual([]);
  });

  it("sends the exact kobo with the stored reference, then records the answer", async () => {
    const { deps, calls, payment } = make();
    const code = await recipient(payment);
    const asUser: PayoutDeps["asUser"] = async () => ({ data: { reference: REF, amount_kobo: 181_000, recipient_code: code, reason: "x" }, error: null });
    const r = await sendPayout({ ...deps, asUser }, ID);
    expect(r.status).toBe(200);
    expect(calls.find((c) => c.fn === "payout_record_send")!.args).toMatchObject({ p_reference: REF, p_status: "pending" });
    const t = await payment.verifyTransfer(REF);
    expect(t.ok && t.data.amountKobo).toBe(181_000);
  });

  it("sending twice with the same reference asks Paystack what happened instead of paying twice", async () => {
    const { deps, calls, payment } = make();
    const code = await recipient(payment);
    const asUser: PayoutDeps["asUser"] = async () => ({ data: { reference: REF, amount_kobo: 181_000, recipient_code: code, reason: "x" }, error: null });
    await sendPayout({ ...deps, asUser }, ID);
    const again = await sendPayout({ ...deps, asUser }, ID);
    expect(again.status).toBe(200);
    expect(calls.filter((c) => c.fn === "payout_record_send")).toHaveLength(2);
  });

  it("a Paystack failure is recorded as an error and reported as retryable", async () => {
    const { deps, calls, payment } = make();
    payment.failNextCall();
    const r = await sendPayout(deps, ID);
    expect(r.body).toMatchObject({ error: "send_failed", retryable: true });
    expect(calls.find((c) => c.fn === "payout_record_send")!.args["p_status"]).toBe("error");
  });
});

describe("verifyBank", () => {
  it("a person who may not look accounts up is refused before Paystack is asked anything", async () => {
    const { deps, calls } = make({ data: null, error: { message: "payout_not_a_contracted_clinician" } });
    const r = await verifyBank(deps, { bankCode: "044", accountNumber: "0123456789" });
    expect(r.status).toBe(403);
    expect(calls.map((c) => c.fn)).toEqual(["payout_bank_check_allowed"]);
  });

  it("the daily limit is a 429 and nothing is looked up", async () => {
    const { deps } = make({ data: null, error: { message: "payout_bank_too_many_lookups" } });
    expect((await verifyBank(deps, { bankCode: "044", accountNumber: "0123456789" })).status).toBe(429);
  });

  it("refuses a bad bank code or account number", async () => {
    const { deps } = make();
    expect((await verifyBank(deps, { bankCode: "x", accountNumber: "0123456789" })).status).toBe(400);
    expect((await verifyBank(deps, { bankCode: "044", accountNumber: "12345" })).status).toBe(400);
  });

  it("a name that does not match creates no recipient and the number is not passed on", async () => {
    const { deps, calls } = make();
    const r = await verifyBank(deps, { bankCode: "044", accountNumber: "0123456789" });
    expect(r.body).toMatchObject({ verified: false, name_match: "mismatch", last4: "6789" });
    expect(calls.map((c) => c.fn)).toEqual(["payout_bank_check_allowed", "record_bank_resolution"]);
    expect(JSON.stringify(calls)).not.toContain("0123456789");
  });

  it("a matching name creates the recipient and attaches it", async () => {
    const { deps, calls, payment } = make();
    const real = payment.resolveAccount.bind(payment);
    (payment as { resolveAccount: typeof real }).resolveAccount = async (i) => {
      const r = await real(i);
      return r.ok ? { ok: true, data: { ...r.data, accountName: "OKAFOR ADA CHINWE" } } : r;
    };
    const r = await verifyBank(deps, { bankCode: "044", accountNumber: "0123456789" });
    expect(r.body).toMatchObject({ verified: true, last4: "6789" });
    expect(calls.map((c) => c.fn)).toEqual(["payout_bank_check_allowed", "record_bank_resolution", "attach_bank_recipient"]);
    expect(calls.find((c) => c.fn === "attach_bank_recipient")!.args["p_recipient_code"]).toMatch(/^RCP_/);
  });
});
