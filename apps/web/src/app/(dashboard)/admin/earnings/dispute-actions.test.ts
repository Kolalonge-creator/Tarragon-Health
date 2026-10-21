const rpc = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

import { decideTopupHold, resolveEarningsDispute, setPayoutWithholding } from "./dispute-actions";

const id = "11111111-1111-4111-8111-111111111111";
const form = (entries: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

beforeEach(() => rpc.mockReset());

describe("resolveEarningsDispute", () => {
  it("adds a positive correction in kobo", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const r = await resolveEarningsDispute(undefined, form({ resolution: "adjusted", dispute_id: id, direction: "add", amount: "400", note: "Agreed, the fee was short" }));
    expect(r?.message).toMatch(/Answered/);
    expect(rpc).toHaveBeenCalledWith("resolve_earnings_dispute", { p_id: id, p_resolution: "adjusted", p_amount_kobo: 40000, p_note: "Agreed, the fee was short" });
  });
  it("takes money away as a negative amount", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await resolveEarningsDispute(undefined, form({ resolution: "adjusted", dispute_id: id, direction: "take_away", amount: "12.50", note: "Counted twice by mistake" }));
    expect(rpc).toHaveBeenCalledWith("resolve_earnings_dispute", expect.objectContaining({ p_amount_kobo: -1250 }));
  });
  it("rejects with no amount", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await resolveEarningsDispute(undefined, form({ resolution: "rejected", dispute_id: id, note: "Checked and it stands" }));
    expect(rpc).toHaveBeenCalledWith("resolve_earnings_dispute", { p_id: id, p_resolution: "rejected", p_note: "Checked and it stands" });
  });
  it("refuses a missing or zero amount and a short reason without calling the database", async () => {
    expect((await resolveEarningsDispute(undefined, form({ resolution: "adjusted", dispute_id: id, direction: "add", amount: "0", note: "Agreed, the fee was short" })))?.error).toMatch(/more than zero/);
    expect((await resolveEarningsDispute(undefined, form({ resolution: "rejected", dispute_id: id, note: "no" })))?.error).toMatch(/at least 10/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("shows the database's refusal in plain words", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "dispute_not_open" } });
    const r = await resolveEarningsDispute(undefined, form({ resolution: "rejected", dispute_id: id, note: "Checked and it stands" }));
    expect(r?.error).toMatch(/already been answered/);
  });
});

describe("decideTopupHold", () => {
  it("passes the decision and the reason", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await decideTopupHold(undefined, form({ hold_id: id, decision: "denied", note: "Claims timed out and nothing finished" }));
    expect(r?.message).toMatch(/Denied/);
    expect(rpc).toHaveBeenCalledWith("decide_topup_hold", { p_id: id, p_decision: "denied", p_note: "Claims timed out and nothing finished" });
  });
  it("refuses a decision that is not release or deny", async () => {
    const r = await decideTopupHold(undefined, form({ hold_id: id, decision: "paid", note: "Claims timed out and nothing finished" }));
    expect(r?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("setPayoutWithholding", () => {
  it("stores exactly the typed naira amount as kobo and calculates nothing", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await setPayoutWithholding(undefined, form({ payout_id: id, withholding: "50", note: "Entered by finance" }));
    expect(rpc).toHaveBeenCalledWith("set_payout_withholding", { p_id: id, p_withholding_kobo: 5000, p_note: "Entered by finance" });
  });
  it("a blank amount clears it to zero", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await setPayoutWithholding(undefined, form({ payout_id: id, withholding: "" }));
    expect(r?.message).toMatch(/cleared/);
    expect(rpc).toHaveBeenCalledWith("set_payout_withholding", { p_id: id, p_withholding_kobo: 0 });
  });
  it("refuses a garbage amount and a bad id", async () => {
    expect((await setPayoutWithholding(undefined, form({ payout_id: id, withholding: "abc" })))?.error).toMatch(/naira/);
    expect((await setPayoutWithholding(undefined, form({ payout_id: "x", withholding: "5" })))?.error).toMatch(/could not be found/);
    expect(rpc).not.toHaveBeenCalled();
  });
});
