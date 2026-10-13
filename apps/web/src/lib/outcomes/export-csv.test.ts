import { describe, expect, it } from "@jest/globals";
import { parseReport } from "./bp-report";
import { reportToCsv } from "./export-csv";

const shown = { suppressed: false, n: 40, controlled: 20, uncontrolled: 10, insufficient_data: 10, rate_strict_pct: 50, rate_among_measured_pct: 66.7, missing_pct: 25 };
const base = {
  measure: "bp_control_90d", config_version: 2, minimum_cell: 20,
  cohort_all_due: shown,
  cohort_baseline_uncontrolled: { suppressed: true, reason: "small_cell", minimum: 20 },
  change_among_measured: { suppressed: true, reason: "under_minimum", minimum: 20 },
  adherence_separate: { n: 30, mean_pct: 71.5 },
  by_enrolment_month: [{ enrolment_month: "2026-07-01", ...shown }],
  months_withheld: 0,
  data_quality: { enrolled_total: 55, not_yet_due: 15, baseline_missing_pct: 5, day90_no_reading_pct: 25, default_target_used_pct: 60, readings_arriving_after_snapshot_pct: 3 },
  definition: "=cmd|' whose average", limitations: "Descriptive only, with a \"quote\", and a comma.",
  range: { from: "2026-07-01", to: "2026-07-31" }, not_a_causal_claim: true, generated_at: "2026-10-07T00:00:00Z",
};

describe("report CSV", () => {
  const r = parseReport(base)!;
  const csv = reportToCsv(r);
  it("carries the shown figures and the minimum group size", () => {
    expect(csv).toContain("everyone_day_90_due,controlled_pct_of_everyone_due,50");
    expect(csv).toContain("report,minimum_group_size,20");
  });
  it("writes a withheld figure as 'withheld', never blank or zero", () => {
    expect(csv).toContain("started_above_target,status,withheld");
    expect(csv).toContain("change_from_day_0,status,withheld");
    expect(csv).not.toMatch(/started_above_target,people,/);
  });
  it("neutralises a spreadsheet formula and quotes commas and quotes", () => {
    expect(csv).toContain("'=cmd|'");
    expect(csv).toContain('"Descriptive only, with a ""quote"", and a comma."');
  });
  it("lists no individual and states there is no causal claim", () => {
    expect(csv).toContain("causal_claim,none");
    expect(csv).not.toMatch(/patient_id|subject_key|full_name|phone/i);
  });
  it("leaves out the by-month list when a month is withheld", () => {
    const withheld = reportToCsv(parseReport({ ...base, months_withheld: 2, by_enrolment_month: [] })!);
    expect(withheld).toContain("by_month_joined,status,withheld (2 month(s)");
    expect(withheld).not.toContain("month_joined_2026-07");
  });
});
