import { describe, expect, it } from "@jest/globals";
import { parseWellbeingCohort } from "./load-wellbeing-cohort-metric";

describe("parseWellbeingCohort", () => {
  it("returns percentages only when the database released the aggregate", () => {
    expect(parseWellbeingCohort({ suppressed: false, responded: 12, total: 30, phq9: { minimal: 75, mild: 25 }, gad7: {} })).toEqual({
      respondedCount: 12, totalCount: 30, phq9: { minimal: 75, mild: 25 }, gad7: {},
    });
  });
  it("a suppressed, malformed or missing answer is null, never a partial figure", () => {
    for (const bad of [null, undefined, "x", {}, { suppressed: true, min_cohort_size: 10 }, { suppressed: false }, { suppressed: false, responded: "3", total: 4 }]) {
      expect(parseWellbeingCohort(bad)).toBeNull();
    }
  });
  it("ignores a non-numeric band value", () => {
    expect(parseWellbeingCohort({ suppressed: false, responded: 10, total: 10, phq9: { minimal: "x", mild: 100 }, gad7: null })?.phq9).toEqual({ mild: 100 });
  });
});
