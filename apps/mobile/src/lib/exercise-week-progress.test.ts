/** The weekly progress on the Exercise screen reads the database function faithfully; a failed or malformed answer is never zero. */
import { supabase } from "./supabase";
import { loadWeekProgress } from "./exercise";

jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn() } }));
const mockRpc = supabase.rpc as unknown as jest.Mock;

describe("loadWeekProgress", () => {
  it("returns the minutes and goal", async () => {
    mockRpc.mockResolvedValueOnce({ data: { active_minutes: 45, weekly_active_minutes_goal: 150 }, error: null });
    expect(await loadWeekProgress()).toEqual({ ok: true, activeMinutes: 45, goalMinutes: 150 });
    expect(mockRpc).toHaveBeenCalledWith("activity_week_progress");
  });
  it("is not ok on an error", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await loadWeekProgress()).toEqual({ ok: false });
  });
  it("is not ok on a malformed answer (missing numbers, array, null)", async () => {
    for (const data of [{ active_minutes: "45" }, [], null, { active_minutes: 10 }]) {
      mockRpc.mockResolvedValueOnce({ data, error: null });
      expect(await loadWeekProgress()).toEqual({ ok: false });
    }
  });
});
