import { describe, it, expect } from "@jest/globals";
import { TRIAGE_CATEGORIES } from "../types/index";
import { URGENCY_LEVELS, deriveUrgencyLevel, urgencyMapInForce, urgencyMapProblem, urgencyMapSchema, urgencyRank } from "./levels";

const rows = [
  { category: "emergency", qualifier: "any", level: "emergency_now" },
  { category: "urgent", qualifier: "any", level: "doctor_within_24_hours" },
  { category: "urgent", qualifier: "review_required", level: "doctor_today" },
  { category: "routine", qualifier: "any", level: "doctor_within_days" },
  { category: "self_management", qualifier: "any", level: "self_care" },
  { category: "self_management", qualifier: "review_required", level: "see_pharmacist" },
] as const;
const map = (over: Record<string, unknown> = {}) => ({ status: "signed_off", clinical_sign_off: { by: "Test CMO", at: "2026-10-07" }, rows, ...over });

describe("urgency levels are derived from the four categories", () => {
  it("has the six levels in order", () => {
    expect(URGENCY_LEVELS).toHaveLength(6);
    expect(URGENCY_LEVELS.map(urgencyRank)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("derives a level from a signed, valid map", () => {
    expect(deriveUrgencyLevel("emergency", true, map())).toBe("emergency_now");
    expect(deriveUrgencyLevel("urgent", false, map())).toBe("doctor_within_24_hours");
    expect(deriveUrgencyLevel("urgent", true, map())).toBe("doctor_today");
    expect(deriveUrgencyLevel("routine", true, map())).toBe("doctor_within_days"); // no review row: falls back to "any"
    expect(deriveUrgencyLevel("self_management", true, map())).toBe("see_pharmacist");
  });

  it("an UNSIGNED map yields nothing, so the screen shows only the four-category result", () => {
    for (const c of TRIAGE_CATEGORIES) {
      expect(deriveUrgencyLevel(c, false, map({ status: "draft", clinical_sign_off: null }))).toBeNull();
      expect(deriveUrgencyLevel(c, true, map({ clinical_sign_off: null }))).toBeNull();
      expect(deriveUrgencyLevel(c, false, undefined)).toBeNull();
      expect(deriveUrgencyLevel(c, false, "nonsense")).toBeNull();
    }
  });

  it("refuses a map that softens an emergency, or is not monotone, or is not total", () => {
    const soft = map({ rows: rows.map((r) => (r.category === "emergency" ? { ...r, level: "doctor_today" } : r)) });
    expect(urgencyMapInForce(soft)).toBeNull();
    const inverted = map({ rows: rows.map((r) => (r.category === "routine" ? { ...r, level: "emergency_now" } : r)) });
    expect(urgencyMapProblem(urgencyMapSchema.parse(inverted))).toMatch(/lower level/);
    const partial = map({ rows: rows.filter((r) => r.category !== "routine") });
    expect(urgencyMapProblem(urgencyMapSchema.parse(partial))).toMatch(/no "any" row for routine/);
    const reviewLower = map({ rows: [...rows, { category: "routine", qualifier: "review_required", level: "self_care" }] });
    expect(urgencyMapInForce(reviewLower)).toBeNull();
  });

  it("is monotone in the category for a valid map (a more urgent category never maps lower)", () => {
    const order = ["self_management", "routine", "urgent", "emergency"] as const;
    for (const review of [false, true]) {
      const ranks = order.map((c) => urgencyRank(deriveUrgencyLevel(c, review, map())!));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });
});
