import { adminActionsFor, describePayoutError, overviewSchema, stateVariant } from "./payouts";

describe("adminActionsFor", () => {
  it("a draft with no verified bank can only be discarded", () => {
    expect(adminActionsFor({ state: "draft", bank_ready: false })).toEqual(["discard"]);
    expect(adminActionsFor({ state: "draft", bank_ready: true })).toEqual(["approve", "discard"]);
  });
  it("only approved can be sent and only failed or returned can be retried", () => {
    expect(adminActionsFor({ state: "approved", bank_ready: true })).toEqual(["send"]);
    expect(adminActionsFor({ state: "failed", bank_ready: true })).toEqual(["retry"]);
    expect(adminActionsFor({ state: "reversed", bank_ready: true })).toEqual(["retry"]);
    for (const s of ["sent", "succeeded", "cancelled"]) expect(adminActionsFor({ state: s, bank_ready: true })).toEqual([]);
  });
});

describe("describePayoutError", () => {
  it("never shows a raw code", () => {
    expect(describePayoutError("payout_self_approval")).toMatch(/person it is for/);
    expect(describePayoutError("something odd")).toBe("Something went wrong. Please try again.");
  });
});

describe("stateVariant", () => {
  it("is green only when paid and red when it needs a person", () => {
    expect(stateVariant("succeeded")).toBe("green");
    expect(stateVariant("failed")).toBe("red");
    expect(stateVariant("draft")).toBe("grey");
  });
});

describe("overviewSchema", () => {
  it("accepts a statement and carries no patient field", () => {
    const parsed = overviewSchema.parse({
      bank: null,
      tax: null,
      payouts: [{ id: "11111111-1111-4111-8111-111111111111", period_start: "2026-09-28", period_end: "2026-10-04", amount_kobo: 181000, line_count: 1, state: "succeeded", approved_at: null, reference: "tpo-x", lines: [{ id: "11111111-1111-4111-8111-111111111112", kind: "task", earned_at: "2026-09-29T10:00:00Z", amount_kobo: 181000, task_type: "symptom_review" }] }],
      next_payout_kobo: 0,
      minimum_payout_kobo: 100000,
    });
    expect(Object.keys(parsed.payouts[0]!.lines[0]!).sort()).toEqual(["amount_kobo", "earned_at", "id", "kind", "task_type"]);
  });
});
