import { minutesText, parseResponseReport, timesText } from "./response-report";

const base = {
  minimum_cell: 20,
  config_version: 2,
  range: { from: "2026-07-01", to: "2026-09-30" },
  tasks: [
    { task_type: "amber_bp_review", priority_class: 4, suppressed: false, time_to_claim_minutes: { median: 11.5, p90: 19.9 }, time_to_complete_minutes: { suppressed: true, reason: "under_minimum" }, overdue_open_now: 3, completed_after_due: 2 },
    { task_type: "amber_bp_review", priority_class: 2, suppressed: true, reason: "under_minimum" },
  ],
  task_groups_withheld: 1,
  pages: [{ page_role: "primary", suppressed: true, reason: "under_minimum" }],
  page_groups_withheld: 1,
  data_quality: { members_with_a_bp_reading_last_30_days_pct: 71.4, members_with_a_bp_reading_suppressed: false, day90_snapshots_insufficient_data_pct: null, day90_snapshots_suppressed: true },
  descriptive_only: true,
  not_for_publication: true,
  generated_at: "2026-10-07T10:00:00Z",
};

describe("parseResponseReport", () => {
  it("reads shown, withheld and partly withheld groups", () => {
    const r = parseResponseReport(base);
    expect(r).not.toBeNull();
    expect(r!.tasks).toHaveLength(2);
  });
  it("refuses anything that is not the report", () => {
    for (const bad of [null, "x", {}, { ...base, descriptive_only: false }, { ...base, not_for_publication: false }, { ...base, tasks: [{ task_type: "a", priority_class: 4, suppressed: false }] }]) {
      expect(parseResponseReport(bad)).toBeNull();
    }
  });
});

describe("text helpers", () => {
  it("formats minutes, hours and days", () => {
    expect(minutesText(11.5)).toBe("11.5 min");
    expect(minutesText(180)).toBe("3.0 hours");
    expect(minutesText(60 * 72)).toBe("3.0 days");
  });
  it("says a withheld measure is withheld and never shows a number for it", () => {
    expect(timesText({ suppressed: true, reason: "under_minimum" }, 20)).toMatch(/Fewer than 20/);
    expect(timesText({ median: 10, p90: 30 }, 20)).toBe("typical 10.0 min, slowest tenth 30.0 min");
  });
});
