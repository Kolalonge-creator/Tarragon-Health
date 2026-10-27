/**
 * S58b on the phone: the one-shot support hand-off, and the three loaders behind the pending list and the milestone card.
 * A failed call shows nothing (an empty list or no card), never an error on the points screen.
 */
import { setSupportPrefill, takeSupportPrefill } from "./support-prefill";

const mockRpc = jest.fn();
jest.mock("./supabase", () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a), from: jest.fn() } }));

import { dismissMilestone, loadMyPendingMilestone, loadMyPointsPending } from "./wellness";

beforeEach(() => mockRpc.mockReset());

describe("support prefill", () => {
  it("is taken once and then gone", () => {
    expect(takeSupportPrefill()).toBeNull();
    setSupportPrefill({ subject: "s", description: "d" });
    expect(takeSupportPrefill()).toEqual({ subject: "s", description: "d" });
    expect(takeSupportPrefill()).toBeNull();
  });
});

describe("loadMyPointsPending", () => {
  it("returns the parsed items", async () => {
    mockRpc.mockResolvedValue({
      data: [{ event_id: "e", rule_codes: ["meal_logged"], since: "2026-10-22T09:00:00Z", expected_by: "2026-10-22T09:15:00Z", ask_support: false }],
      error: null,
    });
    const items = await loadMyPointsPending();
    expect(mockRpc).toHaveBeenCalledWith("my_points_pending");
    expect(items).toHaveLength(1);
  });
  it("returns an empty list on an error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await loadMyPointsPending()).toEqual([]);
  });
});

describe("milestone card loaders", () => {
  it("returns the card, or null when there is none or the call fails", async () => {
    mockRpc.mockResolvedValueOnce({ data: { id: "m", code: "first_lab_done", achieved_at: "2026-10-22T09:00:00Z" }, error: null });
    expect(await loadMyPendingMilestone()).toEqual({ id: "m", code: "first_lab_done", achieved_at: "2026-10-22T09:00:00Z" });
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await loadMyPendingMilestone()).toBeNull();
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await loadMyPendingMilestone()).toBeNull();
  });
  it("dismisses by id and reports success", async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await dismissMilestone("m")).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("dismiss_milestone", { p_id: "m" });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await dismissMilestone("m")).toBe(false);
  });
});
