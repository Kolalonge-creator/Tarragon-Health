const rpc = jest.fn();
const invoke = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => rpc(...args),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  }),
}));

import { approvePayout, buildPayoutDrafts, discardPayoutDraft, retryPayout, sendPayout } from "./actions";

const id = "11111111-1111-4111-8111-111111111111";
const form = (entries: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

beforeEach(() => {
  rpc.mockReset();
  invoke.mockReset();
});

describe("payout actions", () => {
  it("refuses a bad id before asking the database", async () => {
    for (const act of [approvePayout, discardPayoutDraft, sendPayout, retryPayout]) {
      expect((await act(undefined, form({ payout_id: "not-a-uuid" })))?.error).toMatch(/could not be found/);
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("says plainly that payouts are off when the guard refuses approval", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "payout_guard_off" } });
    const r = await approvePayout(undefined, form({ payout_id: id }));
    expect(r?.error).toMatch(/not switched on/);
    expect(rpc).toHaveBeenCalledWith("approve_payout", { p_id: id });
  });

  it("explains a changed ledger and a missing bank in words", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "payout_ledger_changed" } });
    expect((await approvePayout(undefined, form({ payout_id: id })))?.error).toMatch(/changed after this draft/);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "payout_no_verified_bank" } });
    expect((await approvePayout(undefined, form({ payout_id: id })))?.error).toMatch(/no verified bank/);
  });

  it("builds drafts, optionally replacing drafts, and reports none made without alarm", async () => {
    rpc.mockResolvedValueOnce({ data: 0, error: null });
    expect((await buildPayoutDrafts(undefined, form({})))?.message).toMatch(/No new drafts/);
    expect(rpc).toHaveBeenLastCalledWith("build_payout_drafts_now", { p_force: false });
    rpc.mockResolvedValueOnce({ data: 2, error: null });
    expect((await buildPayoutDrafts(undefined, form({ rebuild: "1" })))?.message).toBe("2 drafts made.");
    expect(rpc).toHaveBeenLastCalledWith("build_payout_drafts_now", { p_force: true });
  });

  it("sends through the payouts function and does not claim Paid until the bank confirms", async () => {
    invoke.mockResolvedValue({ data: { transfer_status: "pending" }, error: null });
    const r = await sendPayout(undefined, form({ payout_id: id }));
    expect(invoke).toHaveBeenCalledWith("payouts", { body: { action: "send", payout_id: id } });
    expect(r?.message).toMatch(/Sent to Paystack/);
    expect(r?.message).not.toMatch(/^Paid/);
  });

  it("reads the function's error body when sending is refused", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: { json: async () => ({ error: "payout_guard_off" }) } } });
    expect((await sendPayout(undefined, form({ payout_id: id })))?.error).toMatch(/not switched on/);
    invoke.mockResolvedValue({ data: null, error: { message: "x", context: { json: async () => ({ error: "send_failed" }) } } });
    expect((await sendPayout(undefined, form({ payout_id: id })))?.error).toMatch(/Nothing was paid/);
  });

  it("retry goes through the database only", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect((await retryPayout(undefined, form({ payout_id: id })))?.message).toMatch(/Press Send/);
    expect(invoke).not.toHaveBeenCalled();
  });
});
