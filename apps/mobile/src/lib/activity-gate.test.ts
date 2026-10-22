/**
 * The activity safety gate on the phone (S48a). public.activity_gate() is the enforcing answer; these tests pin that the app reads it faithfully
 * and, when it cannot, falls back to the fail-closed answer (gentle only) - never to a permissive guess. Same minimal-stub pattern as
 * prescription-renewal.test.ts: the RPC itself is proven in packages/db/tests/s48a_activity_safety_gate.sql.
 */
import { supabase } from "./supabase";
import { loadActivityGate, loadWorkoutPlans } from "./exercise";

jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn() } }));

const mockRpc = supabase.rpc as unknown as jest.Mock;

describe("loadActivityGate", () => {
  it("shows rest when the database says rest (a red event in the last 48 hours)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { decision: "rest", reason: "recent_red_event", reasons: ["recent_red_event"], max_intensity: "none", blocked_kinds: [], signed: false },
      error: null,
    });
    const r = await loadActivityGate();
    expect(mockRpc).toHaveBeenCalledWith("activity_gate");
    expect(r.unavailable).toBe(false);
    expect(r.gate.decision).toBe("rest");
    expect(r.gate.maxIntensity).toBe("none");
  });

  it("falls back to gentle-only, flagged unavailable, when the question fails", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    const r = await loadActivityGate();
    expect(r.unavailable).toBe(true);
    expect(r.gate.decision).toBe("restrict");
    expect(r.gate.maxIntensity).toBe("gentle");
  });

  it("falls back to gentle-only on an answer it cannot read, and never to allow", async () => {
    mockRpc.mockResolvedValueOnce({ data: { decision: "allow" }, error: null });
    const r = await loadActivityGate();
    expect(r.gate.decision).toBe("restrict");
    expect(r.gate.reason).toBe("rules_unavailable");
  });
});

describe("loadWorkoutPlans", () => {
  it("returns the plans the database allows", async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ code: "x", title: "T", level: "gentle", format: "home", sessions: [] }], error: null });
    expect(await loadWorkoutPlans()).toHaveLength(1);
    expect(mockRpc).toHaveBeenLastCalledWith("my_workout_plans");
  });

  it("shows no plans on an error or an unexpected shape, never a made-up one", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await loadWorkoutPlans()).toEqual([]);
    mockRpc.mockResolvedValueOnce({ data: { not: "an array" }, error: null });
    expect(await loadWorkoutPlans()).toEqual([]);
  });
});
