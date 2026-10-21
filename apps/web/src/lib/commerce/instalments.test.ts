import { collapseRefundGroups } from "./refund-groups";
import { nextPart, openPlans, parseInstalmentPlans, parseInstalmentPolicy, splitIntoParts } from "./instalments";

describe("splitIntoParts (S25b)", () => {
  it("adds up to the price exactly, in whole kobo, with the leftover on the first part", () => {
    for (const [price, parts] of [[10_000_000, 3], [8_400_001, 3], [99, 2], [7, 3], [1_000_003, 12]] as const) {
      const split = splitIntoParts(price, parts);
      expect(split).toHaveLength(parts);
      expect(split.reduce((a, b) => a + b, 0)).toBe(price);
      expect(split.every((n) => Number.isInteger(n) && n >= 0)).toBe(true);
      expect(split[0]!).toBeGreaterThanOrEqual(split[parts - 1]!);
    }
    expect(splitIntoParts(10_000_000, 3)).toEqual([3_333_334, 3_333_333, 3_333_333]);
  });
  it("shows nothing for a price or a count that makes no sense", () => {
    expect(splitIntoParts(0, 3)).toEqual([]);
    expect(splitIntoParts(100.5, 3)).toEqual([]);
    expect(splitIntoParts(100, 0)).toEqual([]);
  });
});

describe("parseInstalmentPolicy", () => {
  const ok = { parts: 3, due_offsets_days: [0, 30, 60], grace_days: 5, reminder_days_before: [3, 0], open: true };
  it("reads a good reply and refuses a reply it cannot describe (so nothing is offered)", () => {
    expect(parseInstalmentPolicy(ok)).toEqual(ok);
    expect(parseInstalmentPolicy(null)).toBeNull();
    expect(parseInstalmentPolicy({ ...ok, parts: 1 })).toBeNull();
    expect(parseInstalmentPolicy({ ...ok, due_offsets_days: [0, 30] })).toBeNull();
    expect(parseInstalmentPolicy({ ...ok, open: "yes" })).toBeNull();
  });
});

describe("plans", () => {
  const row = (seq: number, state: string) => ({ id: `p${seq}`, seq, amount_kobo: 100, due_at: null, state, paid_at: state === "paid" ? "2026-10-01" : null });
  const plan = (over: Record<string, unknown> = {}) => ({
    plan_id: "pl", order_id: "o", state: "active", parts: 2, price_kobo: 200, paid_kobo: 100, name_key: "k", is_buyer: true, next_instalment_id: "p2",
    instalments: [row(1, "paid"), row(2, "pending")], ...over,
  });
  it("drops a bad plan and keeps the rest", () => {
    expect(parseInstalmentPlans([plan(), { nope: 1 }, plan({ state: "weird" })])).toHaveLength(1);
    expect(parseInstalmentPlans("x")).toEqual([]);
  });
  it("treats missing parts as an empty schedule rather than crashing", () => {
    const [p] = parseInstalmentPlans([plan({ instalments: null })]);
    expect(p!.instalments).toEqual([]);
  });
  it("keeps only the plans a person still has something to do about", () => {
    const all = parseInstalmentPlans([plan(), plan({ plan_id: "b", state: "lapsed" }), plan({ plan_id: "c", state: "completed" }), plan({ plan_id: "d", state: "cancelled" }), plan({ plan_id: "e", state: "awaiting_first" })]);
    expect(openPlans(all).map((p) => p.plan_id)).toEqual(["pl", "b", "e"]);
  });
  it("offers the next part only to the buyer, and only while it is pending", () => {
    const [p] = parseInstalmentPlans([plan()]);
    expect(nextPart(p!)?.id).toBe("p2");
    const [other] = parseInstalmentPlans([plan({ is_buyer: false })]);
    expect(nextPart(other!)).toBeNull();
    const [none] = parseInstalmentPlans([plan({ next_instalment_id: null })]);
    expect(nextPart(none!)).toBeNull();
    const [paid] = parseInstalmentPlans([plan({ next_instalment_id: "p1" })]);
    expect(nextPart(paid!)).toBeNull();
  });
});

describe("collapseRefundGroups (S25b)", () => {
  it("shows a grouped refund once, on the group's first row, with the whole amount", () => {
    const rows = [
      { id: "g", amount_kobo: 3_333_334, refund_group: "g" },
      { id: "x", amount_kobo: 3_333_333, refund_group: "g" },
      { id: "y", amount_kobo: 3_333_333, refund_group: "g" },
      { id: "solo", amount_kobo: 500, refund_group: null },
      { id: "old", amount_kobo: 700 },
    ];
    const out = collapseRefundGroups(rows);
    expect(out.map((r) => [r.id, r.amount_kobo])).toEqual([["g", 10_000_000], ["solo", 500], ["old", 700]]);
  });
  it("shows the group as completed only when every part is, and never hides a failed or still-sending part behind one that succeeded", () => {
    const g = (states: string[]) => collapseRefundGroups(states.map((state, i) => ({ id: i === 0 ? "g" : `x${i}`, amount_kobo: 100, refund_group: "g", state })))[0]!.state;
    expect(g(["completed", "completed"])).toBe("completed");
    expect(g(["completed", "processing"])).toBe("processing");
    expect(g(["completed", "failed", "processing"])).toBe("failed");
    expect(g(["approved", "completed"])).toBe("approved");
    expect(g(["pending", "pending"])).toBe("pending");
    expect(g(["pending", "approved"])).toBe("pending");
    expect(g(["rejected", "rejected"])).toBe("rejected");
    // a state this build does not know can never mask a finished one
    expect(g(["completed", "somethingnew"])).toBe("somethingnew");
  });
  it("does not let the first part's completion date stand in for a group that is not finished", () => {
    const done = collapseRefundGroups([
      { id: "g", amount_kobo: 1, refund_group: "g", state: "completed", completed_at: "2026-10-01" },
      { id: "x", amount_kobo: 1, refund_group: "g", state: "processing", completed_at: null },
    ]);
    expect(done[0]).toMatchObject({ state: "processing", completed_at: null });
    const all = collapseRefundGroups([
      { id: "g", amount_kobo: 1, refund_group: "g", state: "completed", completed_at: "2026-10-01" },
      { id: "x", amount_kobo: 1, refund_group: "g", state: "completed", completed_at: "2026-10-02" },
    ]);
    expect(all[0]).toMatchObject({ state: "completed", completed_at: "2026-10-01" });
  });
  it("leaves a lone group row alone", () => {
    expect(collapseRefundGroups([{ id: "g", amount_kobo: 10, refund_group: "g" }])).toEqual([{ id: "g", amount_kobo: 10, refund_group: "g" }]);
  });
});
