const rpc = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

import { openEarningsDispute, withdrawEarningsDispute } from "./actions";

const id = "11111111-1111-4111-8111-111111111111";
const req = "22222222-2222-4222-8222-222222222222";
const form = (entries: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

beforeEach(() => rpc.mockReset());

describe("openEarningsDispute", () => {
  it("sends the line, the reason and the request id that makes a double tap one question", async () => {
    rpc.mockResolvedValue({ data: id, error: null });
    const r = await openEarningsDispute(undefined, form({ ledger_id: id, reason_code: "wrong_amount", request_id: req, note: "Looks short" }));
    expect(r?.message).toMatch(/on hold/);
    expect(rpc).toHaveBeenCalledWith("open_earnings_dispute", { p_ledger: id, p_reason_code: "wrong_amount", p_request_id: req, p_note: "Looks short" });
  });
  it("leaves the note out when there is none", async () => {
    rpc.mockResolvedValue({ data: id, error: null });
    await openEarningsDispute(undefined, form({ ledger_id: id, reason_code: "duplicate", request_id: req, note: "" }));
    expect(rpc).toHaveBeenCalledWith("open_earnings_dispute", { p_ledger: id, p_reason_code: "duplicate", p_request_id: req });
  });
  it("refuses an unknown reason without calling the database", async () => {
    const r = await openEarningsDispute(undefined, form({ ledger_id: id, reason_code: "nope", request_id: req }));
    expect(r?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("says so when the database refuses, and never reports success", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "dispute_already_open" } });
    const r = await openEarningsDispute(undefined, form({ ledger_id: id, reason_code: "other", request_id: req }));
    expect(r?.message).toBeUndefined();
    expect(r?.error).toMatch(/already have a question open/);
  });
});

describe("withdrawEarningsDispute", () => {
  it("withdraws and says the line goes into the next payout", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await withdrawEarningsDispute(undefined, form({ dispute_id: id }));
    expect(r?.message).toMatch(/next payout/);
    expect(rpc).toHaveBeenCalledWith("withdraw_earnings_dispute", { p_id: id });
  });
  it("refuses a bad id", async () => {
    expect((await withdrawEarningsDispute(undefined, form({ dispute_id: "x" })))?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });
});
