import type { PrnBreach, PrnLimits } from "./prn";

/**
 * Shared cases for the as-needed rule. The phone's `checkPrnDose` runs them in `prn.test.ts`; the database
 * proof (packages/db/tests/s08x_prn_limits.sql) inserts the same doses and asserts the same flags, so the
 * two cannot drift. Times are Lagos wall clock, "YYYY-MM-DDTHH:MM".
 */
export interface PrnCase {
  name: string;
  limits: PrnLimits;
  /** Other doses already on file. */
  prior: string[];
  dose: string;
  expect: PrnBreach[];
}

export const PRN_CASES: PrnCase[] = [
  { name: "no limits set is never checked", limits: { minGapMinutes: null, dailyMax: null }, prior: ["2026-10-07T08:00"], dose: "2026-10-07T08:01", expect: [] },
  { name: "first dose of the day is fine", limits: { minGapMinutes: 240, dailyMax: 3 }, prior: [], dose: "2026-10-07T08:00", expect: [] },
  { name: "exactly the gap later is fine", limits: { minGapMinutes: 240, dailyMax: null }, prior: ["2026-10-07T08:00"], dose: "2026-10-07T12:00", expect: [] },
  { name: "one minute short of the gap", limits: { minGapMinutes: 240, dailyMax: null }, prior: ["2026-10-07T08:00"], dose: "2026-10-07T11:59", expect: ["min_gap"] },
  { name: "the most doses in a day is fine", limits: { minGapMinutes: null, dailyMax: 3 }, prior: ["2026-10-07T06:00", "2026-10-07T12:00"], dose: "2026-10-07T18:00", expect: [] },
  { name: "one more than the daily most", limits: { minGapMinutes: null, dailyMax: 3 }, prior: ["2026-10-07T06:00", "2026-10-07T12:00", "2026-10-07T15:00"], dose: "2026-10-07T18:00", expect: ["daily_max"] },
  { name: "both limits broken", limits: { minGapMinutes: 240, dailyMax: 2 }, prior: ["2026-10-07T08:00", "2026-10-07T09:00"], dose: "2026-10-07T09:30", expect: ["min_gap", "daily_max"] },
  { name: "yesterday's doses do not count toward today's most", limits: { minGapMinutes: null, dailyMax: 1 }, prior: ["2026-10-06T22:00"], dose: "2026-10-07T07:00", expect: [] },
  { name: "the gap runs across midnight", limits: { minGapMinutes: 240, dailyMax: null }, prior: ["2026-10-06T23:30"], dose: "2026-10-07T01:00", expect: ["min_gap"] },
  { name: "a dose that came later does not make an earlier one over", limits: { minGapMinutes: 240, dailyMax: 1 }, prior: ["2026-10-07T10:00"], dose: "2026-10-07T08:00", expect: [] },
];
