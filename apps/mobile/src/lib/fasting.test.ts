/**
 * Fasting on the phone (S50b). The RPCs are proven in packages/db/tests/s50b_fasting_safety.sql; these tests pin that the phone reads the answer
 * faithfully and, when it cannot, shows the unavailable answer, and that it refuses a malformed date before asking the database.
 */
import { supabase } from "./supabase";
import { endFastingPlan, loadFastingDetails, startFastingPlan } from "./fasting";

jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn() } }));
const mockRpc = supabase.rpc as unknown as jest.Mock;

beforeEach(() => mockRpc.mockReset());

describe("loadFastingDetails", () => {
  it("asks for the chosen fast and reads the answer", async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: { state: "ok", decision: "needs_clinician_plan", reason: "medicine_timing_plan_needed", blocks: ["medicine_timing_plan_needed"], has_timing_plan: false },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    const d = await loadFastingDetails("ramadan");
    expect(mockRpc).toHaveBeenCalledWith("my_fasting_gate", { p_fast: "ramadan", p_starts_on: null, p_ends_on: null });
    expect(d.answer).toMatchObject({ state: "ok", decision: "needs_clinician_plan" });
  });

  it("is unavailable on an error, and on a reply it cannot read, never permissive", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "offline" } }).mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    expect((await loadFastingDetails("lent")).answer).toEqual({ state: "unavailable" });
    mockRpc
      .mockResolvedValueOnce({ data: { state: "ok", decision: "may_fast_with_guidance", reason: "recent_red_event", blocks: [] }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    expect((await loadFastingDetails("lent")).answer).toEqual({ state: "unavailable" });
  });

  it("still shows a plan the person started when the gate has turned unavailable, marked paused", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: { state: "unavailable" }, error: null })
      .mockResolvedValueOnce({ data: { id: "p1", fast: "lent", starts_on: "2027-02-10", ends_on: "2027-03-27" }, error: null });
    const d = await loadFastingDetails("lent");
    expect(d.plan?.id).toBe("p1");
    expect(d.planPaused).toBe(true);
  });
});

describe("startFastingPlan and endFastingPlan", () => {
  it("refuses a malformed or reversed date without calling the database", async () => {
    expect(await startFastingPlan("ramadan", "8 Feb", "2027-03-09")).toEqual({ ok: false });
    expect(await startFastingPlan("ramadan", "2027-03-09", "2027-02-08")).toEqual({ ok: false });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("passes good dates through and reports the database's refusal as a plain failure", async () => {
    mockRpc.mockResolvedValueOnce({ data: "id", error: null });
    expect(await startFastingPlan("lent", "2027-02-10", "2027-03-27")).toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith("start_fasting_plan", { p_fast: "lent", p_starts_on: "2027-02-10", p_ends_on: "2027-03-27" });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "We cannot start a fasting plan here." } });
    expect(await startFastingPlan("lent", "2027-02-10", "2027-03-27")).toEqual({ ok: false });
  });

  it("ends a plan with a reason", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await endFastingPlan("finished")).toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith("end_fasting_plan", { p_reason: "finished" });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await endFastingPlan("stopped_by_person")).toEqual({ ok: false });
  });
});
