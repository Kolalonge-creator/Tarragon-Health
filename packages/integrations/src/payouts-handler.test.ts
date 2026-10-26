import { describe, expect, it } from "@jest/globals";
import { createMockPayment } from "../../../supabase/functions/_shared/integrations/index.ts";
import { listBanks, sendPayout, verifyBank, type PayoutDeps, type RpcReply } from "../../../supabase/functions/_shared/payouts/handler.ts";

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

describe("sendPayout when the answer is unknown (timeout, network, 5xx)", () => {
  const setup = async (failure: { code: "timeout" | "network" | "vendor_error" | "invalid_input" | "bad_response"; retryable: boolean }, reached: boolean) => {
    const { deps, calls, payment } = make();
    const code = await recipient(payment);
    const asUser: PayoutDeps["asUser"] = async () => ({ data: { reference: REF, amount_kobo: 181_000, recipient_code: code, reason: "x" }, error: null });
    const real = payment.initiateTransfer.bind(payment);
    let verifies = 0;
    const realVerify = payment.verifyTransfer.bind(payment);
    (payment as { initiateTransfer: typeof real }).initiateTransfer = async (i) => {
      if (reached) await real(i);
      return { ok: false, error: { code: failure.code, message: "Vendor did not answer in time", retryable: failure.retryable } };
    };
    (payment as { verifyTransfer: typeof realVerify }).verifyTransfer = async (r) => { verifies += 1; return realVerify(r); };
    return { deps: { ...deps, asUser }, calls, verifies: () => verifies };
  };

  it("a timeout after Paystack accepted the transfer records what Paystack says, not an error (the money may already be moving)", async () => {
    const { deps, calls, verifies } = await setup({ code: "timeout", retryable: true }, true);
    const r = await sendPayout(deps, ID);
    expect(r.status).toBe(200);
    expect(verifies()).toBe(1);
    expect(calls.find((c) => c.fn === "payout_record_send")!.args).toMatchObject({ p_status: "pending", p_reference: REF });
    expect(calls.find((c) => c.fn === "payout_record_send")!.args["p_transfer_code"]).toMatch(/^TRF_/);
  });

  it("a timeout where Paystack never saw it is an error the admin can retry with the same reference", async () => {
    const { deps, calls, verifies } = await setup({ code: "network", retryable: true }, false);
    const r = await sendPayout(deps, ID);
    expect(r.body).toMatchObject({ error: "send_failed", retryable: true });
    expect(verifies()).toBe(1);
    expect(calls.find((c) => c.fn === "payout_record_send")!.args["p_status"]).toBe("error");
  });

  it("a refusal that is not about reaching Paystack is not second-guessed with a lookup", async () => {
    const { deps, verifies } = await setup({ code: "invalid_input", retryable: false }, false);
    expect((await sendPayout(deps, ID)).status).toBe(502);
    expect(verifies()).toBe(0);
  });

  it("a 2xx reply we could not read is checked the same way (Paystack may have created the transfer)", async () => {
    const { deps, calls, verifies } = await setup({ code: "bad_response", retryable: false }, true);
    expect((await sendPayout(deps, ID)).status).toBe(200);
    expect(verifies()).toBe(1);
    expect(calls.find((c) => c.fn === "payout_record_send")!.args["p_status"]).toBe("pending");
  });

  it("a 5xx marked retryable is checked the same way", async () => {
    const { deps, verifies } = await setup({ code: "vendor_error", retryable: true }, true);
    expect((await sendPayout(deps, ID)).status).toBe(200);
    expect(verifies()).toBe(1);
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

describe("sendPayout and bank lookups: the remaining refusals", () => {
  it("a reused reference whose lookup then fails is recorded as an error, not guessed", async () => {
    const { deps, calls, payment } = make();
    (payment as { initiateTransfer: PayoutDeps["payment"]["initiateTransfer"] }).initiateTransfer = async () => ({ ok: false, error: { code: "conflict", message: "already exists", retryable: false } });
    (payment as { verifyTransfer: PayoutDeps["payment"]["verifyTransfer"] }).verifyTransfer = async () => ({ ok: false, error: { code: "not_found", message: "no such transfer", retryable: false } });
    const r = await sendPayout(deps, ID);
    expect(r.status).toBe(502);
    expect(calls.find((c) => c.fn === "payout_record_send")!.args).toMatchObject({ p_status: "error", p_error: "no such transfer" });
  });

  it("a failed record of what Paystack said is a 500, never a silent success", async () => {
    const { deps, payment } = make();
    const code = await recipient(payment);
    const asUser: PayoutDeps["asUser"] = async () => ({ data: { reference: REF, amount_kobo: 181_000, recipient_code: code, reason: "x" }, error: null });
    const asService: PayoutDeps["asService"] = async () => ({ data: null, error: { message: "boom" } });
    expect(await sendPayout({ ...deps, asUser, asService }, ID)).toEqual({ status: 500, body: { error: "record_failed" } });
  });

  it("verifyBank: an unknown bank, an account that cannot be resolved, a recipient that fails, an attach that is refused", async () => {
    const base = make();
    expect((await verifyBank(base.deps, { bankCode: "999", accountNumber: "0123456789" })).body).toEqual({ error: "unknown_bank" });
    const unresolved = make();
    (unresolved.payment as { resolveAccount: PayoutDeps["payment"]["resolveAccount"] }).resolveAccount = async () => ({ ok: false, error: { code: "not_found", message: "x", retryable: false } });
    expect((await verifyBank(unresolved.deps, { bankCode: "044", accountNumber: "0123456789" })).status).toBe(422);
    (unresolved.payment as { resolveAccount: PayoutDeps["payment"]["resolveAccount"] }).resolveAccount = async () => ({ ok: false, error: { code: "network", message: "x", retryable: true } });
    expect((await verifyBank(unresolved.deps, { bankCode: "044", accountNumber: "0123456789" })).status).toBe(502);
    const matched = (over: (p: ReturnType<typeof createMockPayment>) => void, service?: PayoutDeps["asService"]) => {
      const m = make();
      const real = m.payment.resolveAccount.bind(m.payment);
      (m.payment as { resolveAccount: typeof real }).resolveAccount = async (i) => {
        const r = await real(i);
        return r.ok ? { ok: true, data: { ...r.data, accountName: "OKAFOR ADA CHINWE" } } : r;
      };
      over(m.payment);
      return { ...m, deps: service ? { ...m.deps, asService: service } : m.deps };
    };
    const noRecipient = matched((p) => { (p as { createTransferRecipient: PayoutDeps["payment"]["createTransferRecipient"] }).createTransferRecipient = async () => ({ ok: false, error: { code: "vendor_error", message: "x", retryable: true } }); });
    expect((await verifyBank(noRecipient.deps, { bankCode: "044", accountNumber: "0123456789" })).body).toEqual({ error: "recipient_failed", retryable: true });
    const inner = make().deps.asService;
    const refusedAttach = matched(() => undefined, async (fn, args) => (fn === "attach_bank_recipient" ? { data: null, error: { message: "payout_bank_changed" } } : inner(fn, args)));
    expect((await verifyBank(refusedAttach.deps, { bankCode: "044", accountNumber: "0123456789" })).status).toBe(409);
    const refusedRecord = matched(() => undefined, async (fn, args) => (fn === "record_bank_resolution" ? { data: null, error: { message: "payout_bank_too_many_lookups" } } : inner(fn, args)));
    expect((await verifyBank(refusedRecord.deps, { bankCode: "044", accountNumber: "0123456789" })).status).toBe(429);
  });

  it("listBanks: the list for a signed-in person, a refusal, and Paystack being down", async () => {
    const { deps } = make();
    const ok = await listBanks(deps);
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body["banks"])).toBe(true);
    expect((await listBanks({ ...deps, asUser: async () => ({ data: null, error: { message: "payout_not_a_contracted_clinician" } }) })).status).toBe(403);
    const down = make();
    down.payment.failNextCall();
    expect((await listBanks(down.deps)).body).toEqual({ error: "banks_unavailable" });
  });
});
