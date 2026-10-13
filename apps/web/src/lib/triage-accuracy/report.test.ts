import { describe, expect, it } from "@jest/globals";
import { allowedAgreements, isShownCell, parseAccuracy, parseReviewList } from "./report";

const id = "11111111-1111-4111-8111-111111111111";
const report = {
  range: { from: "2026-07-09", to: "2026-10-07" }, minimum_cell: 20, capture_switched_on: true,
  coverage: { suppressed: false, completed_tasks_from_a_grade: 100, reviewed: 40, reviewed_pct: 40, low_coverage: true },
  overall: { suppressed: false, reviewed: 40, agree_pct: 80, should_have_been_higher_pct: 12.5, should_have_been_lower_pct: 7.5 },
  by_grade: [{ graded_as: "green", suppressed: false, reviewed: 20, right: 15, should_have_been_higher: 5, should_have_been_lower: 0, agree_pct: 75 }, { graded_as: "red", suppressed: true, minimum: 20 }],
  by: { sex: [], age_band: [], state: [{ key: "Lagos", reviewed: 30, agree_pct: 80, should_have_been_higher_pct: 10 }, { key: "Kano", suppressed: true }] },
  draft_rule_set_reviews: null, what_this_is: "x", limitations: "y", not_a_causal_claim: true, generated_at: "2026-10-07T00:00:00Z",
};

describe("triage review list", () => {
  it("parses ok and not_available, rejects the rest", () => {
    expect(parseReviewList({ status: "ok", rows: [{ task_id: id, task_type: "amber_bp_review", completed_at: "2026-10-07T10:00:00Z", graded_as: "amber" }] })?.rows).toHaveLength(1);
    expect(parseReviewList({ status: "not_available", rows: [] })?.status).toBe("not_available");
    expect(parseReviewList({ status: "weird", rows: [] })).toBeNull();
  });
  it("offers only the answers that can be true for a grade", () => {
    expect(allowedAgreements("green")).toEqual(["right", "should_have_been_higher"]);
    expect(allowedAgreements("red")).toEqual(["right", "should_have_been_lower"]);
    expect(allowedAgreements("amber")).toHaveLength(3);
  });
});

describe("accuracy report", () => {
  it("parses a good report and tells shown cells from withheld ones", () => {
    const r = parseAccuracy(report);
    expect(r?.by.state.map(isShownCell)).toEqual([true, false]);
    expect(r?.coverage.suppressed === false && r.coverage.low_coverage).toBe(true);
  });
  it("rejects a malformed report instead of half-rendering it", () => {
    expect(parseAccuracy({ ...report, by: {} })).toBeNull();
    expect(parseAccuracy(null)).toBeNull();
  });
});
