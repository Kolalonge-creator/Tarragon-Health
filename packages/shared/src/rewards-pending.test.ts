import { describe, expect, it } from "@jest/globals";
import { describePending, lagosClock, parsePendingCredit, parsePendingMilestone } from "./rewards-pending";

const item = {
  event_id: "e1",
  rule_codes: ["meal_logged"],
  since: "2026-10-22T09:00:00Z",
  expected_by: "2026-10-22T09:15:00Z",
  ask_support: false,
};

describe("parsePendingCredit", () => {
  it("keeps well-formed items and drops anything else", () => {
    expect(parsePendingCredit([item, { event_id: "x" }, null, "nope", { ...item, since: 5 }])).toEqual([item]);
  });
  it("never throws on an unexpected answer", () => {
    expect(parsePendingCredit(null)).toEqual([]);
    expect(parsePendingCredit({ error: "42501" })).toEqual([]);
    expect(parsePendingCredit(undefined)).toEqual([]);
  });
  it("treats a missing ask flag as not asking", () => {
    expect(parsePendingCredit([{ ...item, ask_support: "yes" }])[0]?.ask_support).toBe(false);
  });
});

describe("parsePendingMilestone", () => {
  it("returns the card or null", () => {
    expect(parsePendingMilestone({ id: "m", code: "first_lab_done", achieved_at: "2026-10-22T09:00:00Z" })).toEqual({ id: "m", code: "first_lab_done", achieved_at: "2026-10-22T09:00:00Z" });
    expect(parsePendingMilestone(null)).toBeNull();
    expect(parsePendingMilestone({ id: "m" })).toBeNull();
    expect(parsePendingMilestone({ error: "x" })).toBeNull();
  });
});

describe("describePending", () => {
  it("shows the Lagos clock time (UTC+1) and 'expected' while it is still ahead", () => {
    expect(lagosClock("2026-10-22T09:15:00Z")).toBe("10:15");
    expect(describePending(item, new Date("2026-10-22T09:05:00Z"))).toEqual({ state: "expected", time: "10:15", askSupport: false });
  });
  it("turns calm 'later' once the time has passed, with no deadline wording and the support offer when the database says so", () => {
    expect(describePending({ ...item, ask_support: true }, new Date("2026-10-22T12:00:00Z"))).toEqual({ state: "later", time: "10:15", askSupport: true });
  });
  it("a bad date reads as 'later' rather than throwing", () => {
    expect(describePending({ ...item, expected_by: "garbage" }, new Date()).state).toBe("later");
  });
});
