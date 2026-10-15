import { isBpShown, isMeasureShown, measureWithheldText, MEASURE_REQUESTS, parseBp180, parseMeasureReport } from "./measures-report";

const shown = { suppressed: false, n: 40, reached: 14, not_reached: 16, insufficient_data: 10, rate_strict_pct: 35, rate_among_measured_pct: 46.7, missing_pct: 25 };
const withheld = { suppressed: true, reason: "small_cell", minimum: 20, n: 33 };
const base = {
  measure: "hba1c", day: 90, config_version: 3, minimum_cell: 20, goal: "under 7.0 percent, or at the care-plan target",
  cohort_all_due: shown, change_among_measured: { suppressed: false, n: 30, mean_change_percentage_points: -0.8 },
  data_quality: { baseline_missing_pct: 5, care_plan_target_used_pct: 60 },
  definition: "HbA1c, as a percentage.", limitations: "No comparison group.", comparison_group: "none", not_a_causal_claim: true, generated_at: "2026-10-07T00:00:00Z",
};

describe("parseMeasureReport", () => {
  it("reads a shown report and a withheld one", () => {
    expect(parseMeasureReport(base)).not.toBeNull();
    const quiet = { ...base, cohort_all_due: withheld, change_among_measured: { suppressed: true, reason: "under_minimum", minimum: 20 }, data_quality: { suppressed: true, reason: "under_minimum", minimum: 20 } };
    const r = parseMeasureReport(quiet);
    expect(r).not.toBeNull();
    expect(isMeasureShown(r!.cohort_all_due)).toBe(false);
  });
  it("reads a weight report with percent change", () => {
    const w = { ...base, measure: "weight", change_among_measured: { suppressed: false, n: 30, mean_change_percent: -3.2, mean_change_kg: -2.9 } };
    expect(parseMeasureReport(w)).not.toBeNull();
  });
  it("refuses anything else, never half-rendering it, and anything that is a mental health measure or claims a cause", () => {
    for (const bad of [null, "x", {}, { ...base, measure: "phq9" }, { ...base, measure: "gad7" }, { ...base, not_a_causal_claim: false }, { ...base, comparison_group: "matched" }, { ...base, cohort_all_due: { suppressed: false, n: 3 } }]) {
      expect(parseMeasureReport(bad)).toBeNull();
    }
  });
});

describe("withheld text and requests", () => {
  it("says why a group is hidden", () => {
    expect(measureWithheldText({ suppressed: true, reason: "under_minimum", minimum: 20 })).toBe("Fewer than 20 people, so nothing is shown.");
    expect(measureWithheldText({ suppressed: true, reason: "small_cell", minimum: 20 })).toContain("smaller than 20");
  });
  it("asks only for HbA1c and weight, never a mental health measure", () => {
    expect(MEASURE_REQUESTS.map((r) => r.measure).sort()).toEqual(["hba1c", "hba1c", "weight", "weight"]);
  });
});

describe("parseBp180", () => {
  const bp = {
    measure: "bp_control_180d", day: 180, config_version: 2, minimum_cell: 20,
    cohort_all_due: { suppressed: false, n: 40, controlled: 15, uncontrolled: 15, insufficient_data: 10, rate_strict_pct: 37.5, rate_among_measured_pct: 50, missing_pct: 25 },
    cohort_baseline_uncontrolled: withheld, change_among_measured: { n: 30, mean_systolic_change: -10, mean_diastolic_change: -6 },
    definition: "d", limitations: "l", comparison_group: "none", not_a_causal_claim: true,
  };
  it("reads the day-180 report and refuses the day-90 one", () => {
    const r = parseBp180(bp);
    expect(r).not.toBeNull();
    expect(isBpShown(r!.cohort_all_due)).toBe(true);
    expect(parseBp180({ ...bp, measure: "bp_control_90d" })).toBeNull();
  });
});
