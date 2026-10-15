const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { loadWall } from "./load";
import { evaluatorStale, failurePercent, waitLabel } from "./model";

export const goodWall = {
  generated_at: "2026-10-12T10:00:00Z",
  queue: [{ priority_class: 2, waiting: 3, oldest_minutes: 125, past_due: 1 }],
  tasks_claimed: 2,
  pages: { open: 1, unacknowledged: 1, oldest_unacknowledged_seconds: 125, sent_24h: 4 },
  doctors_online: 7,
  on_call_covered: true,
  calls_in_progress: 2,
  calls_waiting: 1,
  tests_this_week: { orders: 10, results_received: 6, results_held: 2 },
  notifications: [{ channel: "push", sent: 90, failed: 10, pending: 3 }],
  payments: { events: 5, processed: 4, unprocessed: 1, errored: 0, taken_minor: 12000000 },
  alerts: { open: [], rules_on: 11, rules_off: [], rules_failing: 0, last_evaluated_at: "2026-10-12T09:59:30Z", contacts: 2 },
  incidents_open: { sev1: 0, sev2: 1 },
};

beforeEach(() => rpc.mockReset());

describe("loadWall", () => {
  it("parses a good answer", async () => {
    rpc.mockResolvedValue({ data: goodWall, error: null });
    expect((await loadWall()).ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("operations_wall");
  });
  it("a database error is a load failure, not an empty wall", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    expect(await loadWall()).toEqual({ ok: false, denied: false });
  });
  it("a refusal is reported as denied", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "no", code: "42501" } });
    expect(await loadWall()).toEqual({ ok: false, denied: true });
  });
  it("an answer that does not parse is a load failure", async () => {
    rpc.mockResolvedValue({ data: { queue: [] }, error: null });
    expect(await loadWall()).toEqual({ ok: false, denied: false });
  });
});

describe("wall helpers", () => {
  it("failure percent is null when nothing was attempted", () => {
    expect(failurePercent({ sent: 0, failed: 0 })).toBeNull();
    expect(failurePercent({ sent: 90, failed: 10 })).toBe(10);
  });
  it("the evaluator is stale after three minutes or if it never ran", () => {
    const now = new Date("2026-10-12T10:00:00Z");
    expect(evaluatorStale(null, now)).toBe(true);
    expect(evaluatorStale("2026-10-12T09:58:00Z", now)).toBe(false);
    expect(evaluatorStale("2026-10-12T09:56:00Z", now)).toBe(true);
  });
  it("labels waits", () => {
    expect(waitLabel(null)).toBe("none waiting");
    expect(waitLabel(45)).toBe("45 min");
    expect(waitLabel(125)).toBe("2 h 5 min");
  });
});
