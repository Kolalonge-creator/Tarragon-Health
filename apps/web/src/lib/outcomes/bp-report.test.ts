import { dateParam, isShown, parseReport, pct, withheldText } from "./bp-report";

const shown = { suppressed: false, n: 38, controlled: 12, uncontrolled: 13, insufficient_data: 13, rate_strict_pct: 31.6, rate_among_measured_pct: 48, missing_pct: 34.2 };
const withheld = { suppressed: true, reason: "small_cell", minimum: 11, n: 27 };
const base = {
  measure: "bp_control_90d", config_version: 1, minimum_cell: 11,
  cohort_all_due: shown, cohort_baseline_uncontrolled: withheld,
  change_among_measured: { n: 25, mean_systolic_change: -13.5, mean_diastolic_change: -8 },
  adherence_separate: { suppressed: true, reason: "under_minimum", minimum: 11 },
  by_enrolment_month: [{ enrolment_month: "2026-06-01", ...shown }],
  months_withheld: 1,
  data_quality: { enrolled_total: 40, not_yet_due: 2, baseline_missing_pct: 0, day90_no_reading_pct: 34.2, default_target_used_pct: 97.4, readings_arriving_after_snapshot_pct: 0 },
  definition: "People whose 7-day average is under their own target.", limitations: "Small numbers are withheld.",
  not_a_causal_claim: true, generated_at: "2026-10-06T20:00:00Z",
};

describe("parseReport", () => {
  it("reads a full report, shown and withheld cohorts alike", () => {
    const r = parseReport(base);
    expect(r).not.toBeNull();
    expect(isShown(r!.cohort_all_due)).toBe(true);
    expect(isShown(r!.cohort_baseline_uncontrolled)).toBe(false);
  });
  it("reads a report where nothing is shown", () => {
    const quiet = { ...base, cohort_all_due: { suppressed: true, reason: "under_minimum", minimum: 11 }, by_enrolment_month: [],
      data_quality: { suppressed: true, reason: "under_minimum", minimum: 11, enrolled_total: 3, not_yet_due: 3 } };
    expect(parseReport(quiet)).not.toBeNull();
  });
  it("refuses anything that is not the report, never half-rendering it", () => {
    for (const bad of [null, undefined, "x", {}, { ...base, measure: "other" }, { ...base, not_a_causal_claim: false }, { ...base, cohort_all_due: { suppressed: false, n: 3 } }, { ...base, config_version: "1" }]) {
      expect(parseReport(bad)).toBeNull();
    }
  });
});

describe("formatting", () => {
  it("formats a rate with one decimal and nothing when absent", () => {
    expect(pct(31.6)).toBe("31.6%");
    expect(pct(0)).toBe("0.0%");
    expect(pct(null)).toBeNull();
    expect(pct(undefined)).toBeNull();
  });
  it("explains a withheld cohort in words, naming the minimum", () => {
    expect(withheldText({ suppressed: true, reason: "under_minimum", minimum: 11 })).toBe("Fewer than 11 people, so nothing is shown.");
    expect(withheldText({ suppressed: true, reason: "small_cell", minimum: 11 })).toMatch(/smaller than 11/);
  });
  it("accepts only plain dates from the query string", () => {
    expect(dateParam("2026-06-01")).toBe("2026-06-01");
    expect(dateParam(["2026-06-01", "x"])).toBe("2026-06-01");
    for (const bad of [undefined, "", "06/01/2026", "2026-13-45", "2026-06-01'; drop", "not-a-date"]) expect(dateParam(bad)).toBeNull();
  });
  it("never puts a person in the report: no id, name or date of birth key anywhere", () => {
    expect(JSON.stringify(base)).not.toMatch(/patient_id|full_name|date_of_birth|phone/);
  });
});
