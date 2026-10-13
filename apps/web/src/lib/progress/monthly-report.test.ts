import { describe, expect, it } from "@jest/globals";
import { buildMonthlyView, monthLabel, parseMonthlyList, type MonthlyPayload } from "./monthly-report";

const base: MonthlyPayload = {
  month: "2026-09-01",
  readings: 9,
  days_logged: 6,
  enough_readings: true,
  minimum_readings: 3,
  target: { systolic: 140, diastolic: 90, source: "default" },
  average: { systolic: 134.5, diastolic: 84, versus_target: "under" },
  weeks: [
    { week_start: "2026-09-01", readings: 4, avg_systolic: 136, avg_diastolic: 85 },
    { week_start: "2026-09-08", readings: 1, avg_systolic: null, avg_diastolic: null },
  ],
  direction_vs_last_month: "lower",
  adherence_pct: 85,
};

describe("monthly report view", () => {
  it("labels the month in words", () => {
    expect(monthLabel("2026-09-01")).toBe("September 2026");
  });

  it("shows the average, the target source and the direction when there are enough readings", () => {
    const v = buildMonthlyView(base, "en");
    expect(v.lines).toContain("Your average was 134.5 over 84.");
    expect(v.lines).toContain("Your average was under your target.");
    expect(v.lines).toContain("Lower than last month.");
    expect(v.lines.some((l) => l.includes("starting suggestion"))).toBe(true);
  });

  it("says 'not enough readings' instead of showing an average or a trend", () => {
    const v = buildMonthlyView({ ...base, readings: 2, enough_readings: false, average: null, direction_vs_last_month: "not_enough_data" }, "en");
    expect(v.lines.join(" ")).not.toMatch(/Your average was/);
    expect(v.lines.some((l) => l.startsWith("There are not enough readings"))).toBe(true);
    expect(v.lines).toContain("There is not enough from both months to compare.");
  });

  it("keeps adherence in its own sentence, apart from blood pressure", () => {
    const v = buildMonthlyView(base, "en");
    const adh = v.lines.filter((l) => l.startsWith("Medicines"));
    expect(adh).toEqual(["Medicines taken as planned: 85 percent. This is shown on its own and does not change your blood pressure figures."]);
    expect(buildMonthlyView({ ...base, adherence_pct: null }, "en").lines).toContain("Medicines: nothing to show for this month.");
  });

  it("describes a week with too few readings without an average", () => {
    const v = buildMonthlyView(base, "en");
    expect(v.weeks[0]).toBe("Week of 1 Sept: 136 over 85 (4 logged)");
    expect(v.weeks[1]).toBe("Week of 8 Sept: 1 logged, not enough for an average");
  });

  it("uses the person's own target when their care team set one", () => {
    const v = buildMonthlyView({ ...base, target: { systolic: 130, diastolic: 80, source: "patient" } }, "en");
    expect(v.lines).toContain("Your target is under 130 over 80, set by your care team.");
  });

  it("never mentions risk, ranking or other people", () => {
    const all = buildMonthlyView(base, "en").lines.join(" ");
    expect(all).not.toMatch(/risk|rank|other patients|other people|diagnos(is|ed) you/i);
  });

  it("drops a payload that does not match instead of half-rendering it", () => {
    expect(parseMonthlyList([{ month: "2026-09-01", payload: { month: "2026-09-01" } }], "en")).toEqual([]);
    expect(parseMonthlyList("nonsense", "en")).toEqual([]);
    expect(parseMonthlyList([{ month: "2026-09-01", payload: base }], "en")).toHaveLength(1);
  });
});
