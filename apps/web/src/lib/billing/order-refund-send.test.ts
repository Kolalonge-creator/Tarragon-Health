import { classifyRefundError, sendApprovedOrderRefund } from "./order-refund-send";

type Call = { fn: string; args: Record<string, unknown> };

function client(claim: unknown, recordError: { message: string } | null = null) {
  const calls: Call[] = [];
  return {
    calls,
    supabase: {
      rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        if (fn === "claim_refund_for_provider") return Promise.resolve({ data: claim, error: null });
        if (fn === "record_refund_provider_result") return Promise.resolve({ data: { result: "x" }, error: args["p_success"] === true ? recordError : null });
        return Promise.resolve({ data: null, error: null });
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

const CLAIMED = {
  result: "claimed",
  refund_id: "r1",
  order_id: "o1",
  organisation_id: "org1",
  amount_kobo: 1_200_000,
  charge_reference: "tho_abc",
};

const posted = jest.fn(() => Promise.resolve({ posted: true }));

beforeEach(() => posted.mockClear());

describe("sendApprovedOrderRefund", () => {
  it("claims before it calls the provider, then records success and posts the cash entry", async () => {
    const { supabase, calls } = client(CLAIMED);
    const order: string[] = [];
    const refundTransaction = jest.fn(() => {
      order.push("provider");
      return Promise.resolve({ ok: true as const, data: { refundId: 77, status: "pending" } });
    });
    const out = await sendApprovedOrderRefund({ supabase, refundTransaction, recordRefundLedgerEntry: posted }, "r1");
    expect(out).toBe("processed");
    expect(calls[0]?.fn).toBe("claim_refund_for_provider");
    expect(refundTransaction).toHaveBeenCalledWith({ reference: "tho_abc", amountKobo: 1_200_000 });
    expect(calls[1]).toEqual({ fn: "record_refund_provider_result", args: expect.objectContaining({ p_success: true, p_reference: "77" }) });
    expect(posted).toHaveBeenCalledTimes(1);
  });

  it("a clear refusal from Paystack is recorded as failed (retryable by an admin) and nothing is posted", async () => {
    const { supabase, calls } = client(CLAIMED);
    const refundTransaction = jest.fn(() => Promise.resolve({ ok: false as const, error: "Transaction reference not found" }));
    const out = await sendApprovedOrderRefund({ supabase, refundTransaction, recordRefundLedgerEntry: posted }, "r1");
    expect(out).toBe("failed");
    const rec = calls.find((c) => c.fn === "record_refund_provider_result");
    expect(rec?.args).toEqual(expect.objectContaining({ p_success: false, p_response: expect.objectContaining({ error_code: "provider_error" }) }));
    expect(posted).not.toHaveBeenCalled();
  });

  it("'already reversed' means the money moved: it is NOT recorded as a retryable failure, it is raised and left in processing", async () => {
    const { supabase, calls } = client(CLAIMED);
    const refundTransaction = jest.fn(() => Promise.resolve({ ok: false as const, error: "Transaction has already been reversed" }));
    const out = await sendApprovedOrderRefund({ supabase, refundTransaction, recordRefundLedgerEntry: posted }, "r1");
    expect(out).toBe("unknown");
    expect(calls.some((c) => c.fn === "record_refund_provider_result")).toBe(false);
    expect(calls.find((c) => c.fn === "service_refund_incident")?.args).toEqual(expect.objectContaining({ p_what: "ambiguous_provider_outcome" }));
  });

  it("a provider call that throws or times out is unknown, never a failure that an admin could retry into a second refund", async () => {
    const { supabase, calls } = client(CLAIMED);
    const refundTransaction = jest.fn(() => Promise.reject(new Error("network down")));
    const out = await sendApprovedOrderRefund({ supabase, refundTransaction, recordRefundLedgerEntry: posted }, "r1");
    expect(out).toBe("unknown");
    expect(calls.some((c) => c.fn === "record_refund_provider_result")).toBe(false);
    expect(calls.some((c) => c.fn === "service_refund_incident")).toBe(true);
  });

  it("does not call the provider when the claim is refused (already claimed by another run)", async () => {
    const { supabase } = client({ result: "not_claimable", state: "processing" });
    const refundTransaction = jest.fn();
    const out = await sendApprovedOrderRefund({ supabase, refundTransaction, recordRefundLedgerEntry: posted }, "r1");
    expect(out).toBe("skipped");
    expect(refundTransaction).not.toHaveBeenCalled();
  });

  it("does not call the provider when the claim answer is malformed", async () => {
    const { supabase } = client(null);
    const refundTransaction = jest.fn();
    expect(await sendApprovedOrderRefund({ supabase, refundTransaction, recordRefundLedgerEntry: posted }, "r1")).toBe("skipped");
    expect(refundTransaction).not.toHaveBeenCalled();
  });

  it("retries the write when the provider took the refund but the database errored, then raises an incident with the right title", async () => {
    const { supabase, calls } = client(CLAIMED, { message: "db down" });
    const refundTransaction = jest.fn(() => Promise.resolve({ ok: true as const, data: { refundId: 5, status: "pending" } }));
    const out = await sendApprovedOrderRefund({ supabase, refundTransaction, recordRefundLedgerEntry: posted }, "r1");
    expect(out).toBe("unknown");
    expect(calls.filter((c) => c.fn === "record_refund_provider_result")).toHaveLength(3);
    expect(calls.find((c) => c.fn === "service_refund_incident")?.args).toEqual(expect.objectContaining({ p_what: "record_failed" }));
    expect(refundTransaction).toHaveBeenCalledTimes(1);
    expect(posted).not.toHaveBeenCalled();
  });

  it("raises an incident when the cash posting fails after a recorded refund, and does not hide it", async () => {
    const { supabase, calls } = client(CLAIMED);
    const refundTransaction = jest.fn(() => Promise.resolve({ ok: true as const, data: { refundId: 5, status: "pending" } }));
    const failing = jest.fn(() => Promise.resolve({ posted: false, error: "period closed" }));
    const out = await sendApprovedOrderRefund({ supabase, refundTransaction, recordRefundLedgerEntry: failing }, "r1");
    expect(out).toBe("processed");
    expect(calls.find((c) => c.fn === "service_refund_incident")?.args).toEqual(expect.objectContaining({ p_what: "period closed" }));
  });

  it("an already-posted cash entry (the webhook got there first) is not an incident", async () => {
    const { supabase, calls } = client(CLAIMED);
    const refundTransaction = jest.fn(() => Promise.resolve({ ok: true as const, data: { refundId: 5, status: "pending" } }));
    const already = jest.fn(() => Promise.resolve({ posted: false, alreadyPosted: true }));
    expect(await sendApprovedOrderRefund({ supabase, refundTransaction, recordRefundLedgerEntry: already }, "r1")).toBe("processed");
    expect(calls.some((c) => c.fn === "service_refund_incident")).toBe(false);
  });
});

describe("classifyRefundError", () => {
  it("treats timeouts, network errors, 5xx and 'already reversed' as unclear", () => {
    for (const m of ["The operation was aborted", "fetch failed", "Paystack request failed with status 502", "Transaction has already been reversed", "ECONNRESET", "Unknown Paystack request failure"]) {
      expect(classifyRefundError(m).kind).toBe("ambiguous");
    }
  });
  it("treats a plain rejection as definitive", () => {
    expect(classifyRefundError("Transaction reference not found")).toEqual({ kind: "definitive", code: "provider_error" });
    expect(classifyRefundError("Insufficient balance to process refund")).toEqual({ kind: "definitive", code: "insufficient_balance" });
  });
});
