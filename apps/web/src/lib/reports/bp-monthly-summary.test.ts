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

  it("the data route reads only the caller's profile, her monthly reports and her home checks (never a laboratory, clinic or pattern table; her own home blood pressure readings for the control line)", () => {
    const route = readFileSync(join(__dirname, "../../app/api/patient/bp-monthly-summary/pdf/route.ts"), "utf8");
    const tables = [...route.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
    const rpcs = [...route.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual(["home_bp_checks", "profiles", "vitals_readings"]);
    expect(rpcs).toEqual(["my_monthly_reports"]);
  });
});

describe("home readings in target (control rate)", () => {
  const GATE = [{ minReadings: 3, minDays: 3, minPerDay: 1 }];
  const reading = (day: string, sys: number, dia: number) => ({ systolic: sys, diastolic: dia, atMs: Date.parse(`2026-09-${day}T08:00:00Z`) });
  const control = (readings: ReturnType<typeof reading>[]) => ({ readings, gateRules: GATE, minGapMinutes: 1 });

  it("says nothing at all when no readings were supplied", () => {
    expect(buildBpMonthlySummary({ patientName: "Ada", reportRows: rows, month: null, checks: [] })?.controlRate).toBeNull();
  });

  it("reports how many home readings were in target once the existing gate is met, against the report's own target", () => {
    const s = buildBpMonthlySummary({
      patientName: "Ada",
      reportRows: rows,
      month: null,
      checks: [],
      control: control([reading("02", 120, 80), reading("05", 130, 82), reading("09", 150, 95)]),
    })!;
    expect(s.controlRate).toContain("2 of 3 (67 percent)");
    expect(s.controlRate).toContain("not a diagnosis");
  });

  it("gives no figure below the gate", () => {
    const s = buildBpMonthlySummary({ patientName: "Ada", reportRows: rows, month: null, checks: [], control: control([reading("02", 120, 80)]) })!;
    expect(s.controlRate).toMatch(/not enough readings/);
    expect(s.controlRate).not.toMatch(/percent/);
  });

  it("counts the month in Lagos days: a reading at 00:30 on the 1st (Lagos) is in, one at 00:30 on the next month's 1st is out", () => {
    const first = { systolic: 120, diastolic: 80, atMs: Date.parse("2026-08-31T23:30:00Z") }; // 00:30 on 1 Sept in Lagos
    const next = { systolic: 150, diastolic: 95, atMs: Date.parse("2026-09-30T23:30:00Z") }; // 00:30 on 1 Oct in Lagos
    const mid = [reading("05", 125, 80), reading("12", 128, 82)];
    const s = buildBpMonthlySummary({ patientName: "Ada", reportRows: rows, month: null, checks: [], control: control([first, ...mid, next]) })!;
    expect(s.controlRate).toContain("3 of 3");
  });
});
