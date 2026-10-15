const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { loadMyReliabilitySignal } from "./signal";

const good = { score: 87.5, window_days: 90, completed_on_time: 4, completed_late: 1, claims_expired: 0, handed_back: 1 };

beforeEach(() => rpc.mockReset());

describe("loadMyReliabilitySignal", () => {
  it("returns the caller's own signal", async () => {
    rpc.mockResolvedValue({ data: good, error: null });
    expect(await loadMyReliabilitySignal()).toEqual({ ok: true, data: good });
    expect(rpc).toHaveBeenCalledWith("my_reliability_signal", {});
  });
  it("accepts a clinician with no score yet", async () => {
    rpc.mockResolvedValue({ data: { ...good, score: null }, error: null });
    expect((await loadMyReliabilitySignal()).ok).toBe(true);
  });
  it("an error or a malformed answer is a failed read, never a zero", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "no", code: "42501" } });
    expect(await loadMyReliabilitySignal()).toEqual({ ok: false });
    rpc.mockResolvedValue({ data: { score: 1 }, error: null });
    expect(await loadMyReliabilitySignal()).toEqual({ ok: false });
  });
});
