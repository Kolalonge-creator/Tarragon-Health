import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBpMonthlySummary } from "./bp-monthly-summary";

const payload = (month: string, adherence: number | null, enough = true) => ({
  month,
  readings: 20,
  days_logged: 10,
  enough_readings: enough,
  minimum_readings: 8,
  target: { systolic: 135, diastolic: 85, source: "default" },
  average: enough ? { systolic: 128, diastolic: 80, versus_target: "under" } : null,
  weeks: [{ week_start: `${month.slice(0, 8)}01`, readings: 5, avg_systolic: 128, avg_diastolic: 80 }],
  direction_vs_last_month: "similar",
  adherence_pct: adherence,
});
const rows = [{ payload: payload("2026-09-01", 86) }, { payload: payload("2026-08-01", null, false) }];
const check = { window_end: "2026-09-12", mean_systolic: 131, mean_diastolic: 82, readings: 14, days: 7 };

describe("monthly blood pressure and medicines summary", () => {
  it("picks the newest month by default and the named month otherwise", () => {
    expect(buildBpMonthlySummary({ patientName: "Ada", reportRows: rows, month: null, checks: [] })?.month).toBe("2026-09-01");
    expect(buildBpMonthlySummary({ patientName: "Ada", reportRows: rows, month: "2026-08-01", checks: [] })?.month).toBe("2026-08-01");
    expect(buildBpMonthlySummary({ patientName: "Ada", reportRows: rows, month: "2026-07-01", checks: [] })).toBeNull();
  });

  it("returns null for anything that is not a list of reports", () => {
    expect(buildBpMonthlySummary({ patientName: "Ada", reportRows: null, month: null, checks: [] })).toBeNull();
    expect(buildBpMonthlySummary({ patientName: "Ada", reportRows: [null, { payload: { bad: true } }], month: null, checks: [] })).toBeNull();
  });

  it("labels adherence as doses the patient marked taken, not as a clinical measure, and never repeats the report's own adherence sentence", () => {
    const s = buildBpMonthlySummary({ patientName: "Ada", reportRows: rows, month: null, checks: [] })!;
    expect(s.adherence).toContain("Doses you marked taken");
    expect(s.adherence).toContain("86 percent");
    expect(s.adherence).toContain("not a clinical measure");
    expect(s.bpLines.join(" ")).not.toMatch(/taken as planned/i);
    expect(s.bpLines.length).toBeGreaterThanOrEqual(3);
  });

  it("says plainly when there is no adherence to show, and shows no average when there are too few readings", () => {
    const s = buildBpMonthlySummary({ patientName: "Ada", reportRows: rows, month: "2026-08-01", checks: [] })!;
    expect(s.adherence).toContain("nothing to show");
    expect(s.bpLines.join(" ")).toMatch(/not enough readings/i);
    expect(s.bpLines.join(" ")).not.toMatch(/Your average was/);
  });

  it("lists only the home checks finished in that month", () => {
    const s = buildBpMonthlySummary({
      patientName: "Ada",
      reportRows: rows,
      month: null,
      checks: [check, { ...check, window_end: "2026-10-01" }, { ...check, window_end: "2026-08-31" }],
    })!;
    expect(s.homeChecks).toHaveLength(1);
    expect(s.homeChecks[0]).toContain("131 over 82");
    expect(s.homeChecks[0]).toContain("14 readings on 7 days");
  });

  it("carries no clinician-only word and no grade", () => {
    const s = buildBpMonthlySummary({ patientName: "Ada", reportRows: rows, month: null, checks: [check] })!;
    expect(JSON.stringify(s)).not.toMatch(/masked|white.?coat|pattern for review|clinic reading|uncontrolled/i);
    expect(s.footer).toContain("no laboratory results");
  });

  it("the data route reads only the caller's profile, her monthly reports and her home checks (never a laboratory, clinic or pattern table)", () => {
    const route = readFileSync(join(__dirname, "../../app/api/patient/bp-monthly-summary/pdf/route.ts"), "utf8");
    const tables = [...route.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
    const rpcs = [...route.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual(["home_bp_checks", "profiles"]);
    expect(rpcs).toEqual(["my_monthly_reports"]);
  });
});
