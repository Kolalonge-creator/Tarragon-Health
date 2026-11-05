const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { reviewPreventivePlan } from "./preventive-plan-actions";

const BASELINE = "11111111-1111-4111-8111-111111111111";
function form(v: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, val] of Object.entries(v)) f.set(k, val);
  return f;
}

beforeEach(() => rpc.mockReset());

describe("reviewPreventivePlan (T2 Phase 3)", () => {
  it("authorises through the database function, with the session as the doctor (no identity field is sent)", async () => {
    rpc.mockResolvedValue({ data: BASELINE, error: null });
    const r = await reviewPreventivePlan("p1", undefined, form({ baseline_id: BASELINE, decision: "authorised", reviewer: "someone-else" }));
    expect(r).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("review_preventive_plan", { p_baseline: BASELINE, p_decision: "authorised", p_note: undefined });
  });

  it("refuses an adjusted plan with no real note before calling the database", async () => {
    const r = await reviewPreventivePlan("p1", undefined, form({ baseline_id: BASELINE, decision: "adjusted", note: "short" }));
    expect(r?.error).toMatch(/at least 10 characters/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a decision that is not one of the two", async () => {
    const r = await reviewPreventivePlan("p1", undefined, form({ baseline_id: BASELINE, decision: "approved_everything" }));
    expect(r?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("turns the database's refusal into a plain message, never success", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not_authorised: a doctor reviews the plan" } });
    const r = await reviewPreventivePlan("p1", undefined, form({ baseline_id: BASELINE, decision: "authorised" }));
    expect(r).toEqual({ error: "Only a doctor caring for this patient can review the plan." });
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "already_reviewed" } });
    expect((await reviewPreventivePlan("p1", undefined, form({ baseline_id: BASELINE, decision: "authorised" })))?.error).toMatch(/already been reviewed/);
  });
});
