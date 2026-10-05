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
