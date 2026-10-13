const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { loadDashboard } from "./load";

const good = {
  viewer: "ops", generated_at: "2026-10-06T10:00:00Z", window_days: 90,
  tasks: { waiting: [], claimed: 0, claimed_past_due: 0 },
  pages: { window_minutes: 5, total: 0, acknowledged: 0, acknowledged_in_window: 0, no_cover: 0, median_ack_seconds: null, p90_ack_seconds: null, unacknowledged: [] },
  cover: { covered_now: true, primary_on_call: true, backup_on_call: true, gap_days: 7, gaps: [] },
  handbacks: {}, distribution: { clinicians: 0, min_group: 5, suppressed: false, scores: [] },
};

beforeEach(() => rpc.mockReset());

describe("loadDashboard", () => {
  it("passes the registry's gap days and minimum group", async () => {
    rpc.mockResolvedValue({ data: good, error: null });
    const r = await loadDashboard();
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("reliability_dashboard", { p_gap_days: 7, p_min_group: 5 });
  });
  it("a database error is a load failure, not an empty dashboard", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    expect(await loadDashboard()).toEqual({ ok: false, denied: false });
  });
  it("a refusal is reported as denied", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "no", code: "42501" } });
    expect(await loadDashboard()).toEqual({ ok: false, denied: true });
  });
  it("an answer that does not parse is a load failure", async () => {
    rpc.mockResolvedValue({ data: { viewer: "ops" }, error: null });
    expect(await loadDashboard()).toEqual({ ok: false, denied: false });
  });
});
