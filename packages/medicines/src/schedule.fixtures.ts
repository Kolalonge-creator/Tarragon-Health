import type { ScheduleSpec } from "./types";

/**
 * Cases shared by the TypeScript expansion (schedule.ts) and the SQL one
 * (`private.medication_slots_on`). The database proof
 * packages/db/tests/s08_medicines_schedule_adherence_refill.sql repeats these
 * exact specs and dates; change one side, change both.
 */
const base = { startDate: null, endDate: null, foodNote: null } as const;

export interface ScheduleCase {
  name: string;
  spec: ScheduleSpec;
  date: string;
  /** Expected "HH:MM" times, in order. */
  times: string[];
}

export const SCHEDULE_CASES: ScheduleCase[] = [
  { name: "daily twice", spec: { ...base, kind: "daily", times: ["08:00", "20:00"] }, date: "2026-10-05", times: ["08:00", "20:00"] },
  {
    name: "every 2 days on anchor",
    spec: { ...base, kind: "every_n_days", times: ["09:00"], intervalDays: 2, anchorDate: "2026-10-01" },
    date: "2026-10-05",
    times: ["09:00"],
  },
  {
    name: "every 2 days off anchor",
    spec: { ...base, kind: "every_n_days", times: ["09:00"], intervalDays: 2, anchorDate: "2026-10-01" },
    date: "2026-10-04",
    times: [],
  },
  {
    name: "every 2 days before anchor",
    spec: { ...base, kind: "every_n_days", times: ["09:00"], intervalDays: 2, anchorDate: "2026-10-10" },
    date: "2026-10-08",
    times: [],
  },
  {
    name: "weekdays Monday and Thursday, a Monday",
    spec: { ...base, kind: "weekdays", times: ["07:30"], days: [1, 4] },
    date: "2026-10-05",
    times: ["07:30"],
  },
  {
    name: "weekdays Monday and Thursday, a Tuesday",
    spec: { ...base, kind: "weekdays", times: ["07:30"], days: [1, 4] },
    date: "2026-10-06",
    times: [],
  },
  {
    name: "taper step 1",
    spec: {
      ...base,
      startDate: "2026-10-01",
      kind: "taper",
      steps: [
        { days: 3, times: ["08:00", "20:00"], doseText: "2 tablets" },
        { days: 3, times: ["08:00"], doseText: "1 tablet" },
      ],
    },
    date: "2026-10-03",
    times: ["08:00", "20:00"],
  },
  {
    name: "taper step 2",
    spec: {
      ...base,
      startDate: "2026-10-01",
      kind: "taper",
      steps: [
        { days: 3, times: ["08:00", "20:00"], doseText: "2 tablets" },
        { days: 3, times: ["08:00"], doseText: "1 tablet" },
      ],
    },
    date: "2026-10-05",
    times: ["08:00"],
  },
  {
    name: "taper finished",
    spec: {
      ...base,
      startDate: "2026-10-01",
      kind: "taper",
      steps: [
        { days: 3, times: ["08:00", "20:00"], doseText: "2 tablets" },
        { days: 3, times: ["08:00"], doseText: "1 tablet" },
      ],
    },
    date: "2026-10-07",
    times: [],
  },
  { name: "as needed", spec: { ...base, kind: "as_needed", maxPerDay: 3 }, date: "2026-10-05", times: [] },
  {
    name: "before start date",
    spec: { ...base, startDate: "2026-10-06", kind: "daily", times: ["08:00"] },
    date: "2026-10-05",
    times: [],
  },
  {
    name: "after end date",
    spec: { ...base, endDate: "2026-10-04", kind: "daily", times: ["08:00"] },
    date: "2026-10-05",
    times: [],
  },
  {
    name: "leap day",
    spec: { ...base, kind: "every_n_days", times: ["06:00"], intervalDays: 2, anchorDate: "2028-02-27" },
    date: "2028-02-29",
    times: ["06:00"],
  },
  {
    name: "month boundary",
    spec: { ...base, kind: "every_n_days", times: ["06:00"], intervalDays: 3, anchorDate: "2026-10-29" },
    date: "2026-11-01",
    times: ["06:00"],
  },
];

export interface SpecValidityCase {
  name: string;
  /** Raw JSON as a patient could write it straight to the database. */
  spec: unknown;
  valid: boolean;
}

/**
 * Specs the phone (parseScheduleSpec) and the database (`private.is_valid_schedule_spec`, the check
 * constraint `medications_schedule_spec_valid`) must judge the same way. The database proof carries
 * this list as a JSON literal; change one side, change both.
 */
export const SPEC_VALIDITY_CASES: SpecValidityCase[] = [
  { name: "daily", spec: { kind: "daily", times: ["08:00", "20:00"] }, valid: true },
  { name: "daily with all optional fields", spec: { kind: "daily", times: ["08:00"], startDate: "2026-01-01", endDate: "2026-12-31", foodNote: "with_food", windowMinutes: 90 }, valid: true },
  { name: "null optional fields", spec: { kind: "daily", times: ["08:00"], startDate: null, endDate: null, foodNote: null, windowMinutes: null }, valid: true },
  { name: "twelve times", spec: { kind: "daily", times: ["00:00", "01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00", "08:00", "09:00", "10:00", "11:00"] }, valid: true },
  { name: "thirteen times", spec: { kind: "daily", times: ["00:00", "01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00"] }, valid: false },
  { name: "no times", spec: { kind: "daily", times: [] }, valid: false },
  { name: "times missing", spec: { kind: "daily" }, valid: false },
  { name: "times not a list", spec: { kind: "daily", times: "08:00" }, valid: false },
  { name: "time out of range", spec: { kind: "daily", times: ["24:00"] }, valid: false },
  { name: "time without leading zero", spec: { kind: "daily", times: ["8:00"] }, valid: false },
  { name: "time is a number", spec: { kind: "daily", times: [800] }, valid: false },
  { name: "one bad time among good", spec: { kind: "daily", times: ["08:00", "99:99"] }, valid: false },
  { name: "unknown kind", spec: { kind: "hourly", times: ["08:00"] }, valid: false },
  { name: "kind missing", spec: { times: ["08:00"] }, valid: false },
  { name: "kind is a number", spec: { kind: 1, times: ["08:00"] }, valid: false },
  { name: "spec is a list", spec: [{ kind: "daily" }], valid: false },
  { name: "bad start date format", spec: { kind: "daily", times: ["08:00"], startDate: "05/10/2026" }, valid: false },
  { name: "impossible start date", spec: { kind: "daily", times: ["08:00"], startDate: "2026-02-30" }, valid: false },
  { name: "start date is a number", spec: { kind: "daily", times: ["08:00"], startDate: 20261005 }, valid: false },
  { name: "end before start", spec: { kind: "daily", times: ["08:00"], startDate: "2026-10-05", endDate: "2026-10-04" }, valid: false },
  { name: "end equals start", spec: { kind: "daily", times: ["08:00"], startDate: "2026-10-05", endDate: "2026-10-05" }, valid: true },
  { name: "unknown food note", spec: { kind: "daily", times: ["08:00"], foodNote: "with_milk" }, valid: false },
  { name: "window of 360", spec: { kind: "daily", times: ["08:00"], windowMinutes: 360 }, valid: true },
  { name: "window of 361", spec: { kind: "daily", times: ["08:00"], windowMinutes: 361 }, valid: false },
  { name: "window as long as the gap", spec: { kind: "daily", times: ["08:00", "10:00"], windowMinutes: 120 }, valid: false },
  { name: "window shorter than the gap", spec: { kind: "daily", times: ["08:00", "10:00"], windowMinutes: 119 }, valid: true },
  { name: "window overlaps across midnight", spec: { kind: "daily", times: ["23:00", "01:00"], windowMinutes: 120 }, valid: false },
  { name: "duplicate times do not overlap themselves", spec: { kind: "daily", times: ["08:00", "08:00"], windowMinutes: 60 }, valid: true },
  { name: "every 3 days", spec: { kind: "every_n_days", times: ["09:00"], intervalDays: 3, anchorDate: "2026-10-01" }, valid: true },
  { name: "interval of 1", spec: { kind: "every_n_days", times: ["09:00"], intervalDays: 1, anchorDate: "2026-10-01" }, valid: false },
  { name: "interval of 90", spec: { kind: "every_n_days", times: ["09:00"], intervalDays: 90, anchorDate: "2026-10-01" }, valid: true },
  { name: "interval of 91", spec: { kind: "every_n_days", times: ["09:00"], intervalDays: 91, anchorDate: "2026-10-01" }, valid: false },
  { name: "interval is text", spec: { kind: "every_n_days", times: ["09:00"], intervalDays: "3", anchorDate: "2026-10-01" }, valid: false },
  { name: "interval is fractional", spec: { kind: "every_n_days", times: ["09:00"], intervalDays: 2.5, anchorDate: "2026-10-01" }, valid: false },
  { name: "interval missing", spec: { kind: "every_n_days", times: ["09:00"], anchorDate: "2026-10-01" }, valid: false },
  { name: "anchor missing", spec: { kind: "every_n_days", times: ["09:00"], intervalDays: 3 }, valid: false },
  { name: "anchor bad", spec: { kind: "every_n_days", times: ["09:00"], intervalDays: 3, anchorDate: "soon" }, valid: false },
  { name: "weekdays", spec: { kind: "weekdays", times: ["07:00"], days: [1, 3, 5] }, valid: true },
  { name: "weekdays empty", spec: { kind: "weekdays", times: ["07:00"], days: [] }, valid: false },
  { name: "weekdays missing", spec: { kind: "weekdays", times: ["07:00"] }, valid: false },
  { name: "weekday 7", spec: { kind: "weekdays", times: ["07:00"], days: [7] }, valid: false },
  { name: "weekday negative", spec: { kind: "weekdays", times: ["07:00"], days: [-1] }, valid: false },
  { name: "weekday text", spec: { kind: "weekdays", times: ["07:00"], days: ["1"] }, valid: false },
  { name: "weekday fractional", spec: { kind: "weekdays", times: ["07:00"], days: [1.5] }, valid: false },
  { name: "taper", spec: { kind: "taper", startDate: "2026-10-01", steps: [{ days: 7, times: ["08:00"], doseText: "20 mg" }, { days: 7, times: ["08:00"], doseText: "10 mg" }] }, valid: true },
  { name: "taper without start date", spec: { kind: "taper", steps: [{ days: 7, times: ["08:00"], doseText: "20 mg" }] }, valid: false },
  { name: "taper without steps", spec: { kind: "taper", startDate: "2026-10-01", steps: [] }, valid: false },
  { name: "taper step days zero", spec: { kind: "taper", startDate: "2026-10-01", steps: [{ days: 0, times: ["08:00"], doseText: "20 mg" }] }, valid: false },
  { name: "taper step days 367", spec: { kind: "taper", startDate: "2026-10-01", steps: [{ days: 367, times: ["08:00"], doseText: "20 mg" }] }, valid: false },
  { name: "taper step without dose text", spec: { kind: "taper", startDate: "2026-10-01", steps: [{ days: 7, times: ["08:00"] }] }, valid: false },
  { name: "taper step with blank dose text", spec: { kind: "taper", startDate: "2026-10-01", steps: [{ days: 7, times: ["08:00"], doseText: "   " }] }, valid: false },
  { name: "taper step with bad times", spec: { kind: "taper", startDate: "2026-10-01", steps: [{ days: 7, times: ["8am"], doseText: "20 mg" }] }, valid: false },
  { name: "taper step is not an object", spec: { kind: "taper", startDate: "2026-10-01", steps: ["20 mg"] }, valid: false },
  { name: "taper window overlaps inside one step", spec: { kind: "taper", startDate: "2026-10-01", windowMinutes: 60, steps: [{ days: 7, times: ["08:00", "08:30"], doseText: "20 mg" }] }, valid: false },
  { name: "as needed", spec: { kind: "as_needed" }, valid: true },
  { name: "as needed with a daily cap", spec: { kind: "as_needed", maxPerDay: 4 }, valid: true },
  { name: "as needed cap null", spec: { kind: "as_needed", maxPerDay: null }, valid: true },
  { name: "as needed cap zero", spec: { kind: "as_needed", maxPerDay: 0 }, valid: false },
  { name: "as needed cap 25", spec: { kind: "as_needed", maxPerDay: 25 }, valid: false },
  { name: "as needed cap text", spec: { kind: "as_needed", maxPerDay: "4" }, valid: false },
];
