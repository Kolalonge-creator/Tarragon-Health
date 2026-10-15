import { adminActionsFor, describePayoutError, overviewSchema, returnedNote, stateVariant } from "./payouts";

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

describe("returnedNote (S31x: the clinician statement says when the bank returned a payout)", () => {
  it("says nothing for any state but reversed", () => {
    for (const state of ["draft", "approved", "sent", "succeeded", "failed", "cancelled"]) expect(returnedNote({ state })).toBeNull();
  });
  it("tells a clinician who saw 'Paid' that the money came back, with nothing for them to do", () => {
    const note = returnedNote({ state: "reversed", paid_then_returned: true });
    expect(note).toContain("paid and then returned");
    expect(note).toContain("nothing for you to do");
  });
  it("uses the plainer sentence when it was never paid", () => {
    expect(returnedNote({ state: "reversed", paid_then_returned: false })).toContain("before it reached you");
    expect(returnedNote({ state: "reversed" })).toContain("before it reached you");
  });
  it("accepts an old reply with no reversal fields and a new one with them", () => {
    const base = { id: "6f1d7a2e-3b44-4c8e-9a51-0c2d1e8f7a10", period_start: "2026-10-05", period_end: "2026-10-11", amount_kobo: 120000, line_count: 1, state: "reversed", approved_at: null, reference: null, lines: [] };
    const reply = (p: object) => ({ bank: null, tax: null, payouts: [p], next_payout_kobo: 0, minimum_payout_kobo: 100000 });
    expect(overviewSchema.safeParse(reply(base)).success).toBe(true);
    expect(overviewSchema.safeParse(reply({ ...base, reversed_at: "2026-10-13T10:00:00Z", paid_then_returned: true })).success).toBe(true);
  });
});

describe("describePayoutError for the S31x batch controls", () => {
  it.each([
    ["payout_batch_required", "released batch"],
    ["payout_limit_payout", "per-payout limit"],
    ["payout_limit_clinician", "this clinician"],
    ["payout_limit_batch_total", "batch total"],
    ["payout_limit_batch_count", "too many payouts"],
    ["payout_batch_self_release", "different person"],
    ["payout_batch_pays_the_checker", "pays the person"],
    ["payout_batch_changed", "changed since"],
    ["payout_already_in_a_batch", "already in a batch"],
    ["payout_batch_control_off", "not switched on"],
  ])("%s has plain words", (code, fragment) => {
    expect(describePayoutError(code)).toContain(fragment);
  });
});
