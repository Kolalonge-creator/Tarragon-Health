/**
 * Reporting periods for the finance console. Every widget on a page reads the
 * same resolved period from the URL, so the KPIs, the chart and the tables can
 * never disagree about which dates they cover.
 *
 * All dates are Lagos calendar dates as `YYYY-MM-DD` strings. Pure functions:
 * `today` is passed in so tests do not depend on the clock.
 */

export const PERIOD_KEYS = [
  "today",
  "this_week",
  "this_month",
  "last_month",
  "this_quarter",
  "this_year",
  "year_to_date",
  "custom",
] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  today: "Today",
  this_week: "This week",
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
  this_year: "This year",
  year_to_date: "Year to date",
  custom: "Custom period",
};

export const COMPARE_KEYS = ["previous_period", "previous_year", "none"] as const;
export type CompareKey = (typeof COMPARE_KEYS)[number];

export const COMPARE_LABEL: Record<CompareKey, string> = {
  previous_period: "Previous period",
  previous_year: "Same period last year",
  none: "No comparison",
};

export type Granularity = "day" | "week" | "month";

export interface ResolvedPeriod {
  key: PeriodKey;
  from: string;
  to: string;
  compare: CompareKey;
  compareFrom: string | null;
  compareTo: string | null;
  granularity: Granularity;
  /** "1 Nov to 7 Nov 2026" style, for headings and exports. */
  label: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a `YYYY-MM-DD` string as a UTC date, refusing anything that is not a real calendar date. */
export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value || !ISO.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || toIso(d) !== value) return null;
  return d;
}

export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

/** Shift a date by whole years, clamping 29 February to 28 February. */
function addYears(d: Date, years: number): Date {
  const y = d.getUTCFullYear() + years;
  const m = d.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay)));
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Today's date in Lagos (UTC+1, no daylight saving). */
export function lagosToday(now: Date = new Date()): string {
  return toIso(new Date(now.getTime() + 60 * 60 * 1000));
}

function formatDay(d: Date, withYear: boolean): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

export function periodLabel(from: string, to: string): string {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (!a || !b) return `${from} to ${to}`;
  if (from === to) return formatDay(a, true);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  return `${formatDay(a, !sameYear)} to ${formatDay(b, true)}`;
}

/** Day buckets up to two months, weeks up to about six months, months beyond. */
export function granularityFor(from: string, to: string): Granularity {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (!a || !b) return "day";
  const span = daysBetween(a, b) + 1;
  if (span <= 62) return "day";
  if (span <= 186) return "week";
  return "month";
}

/** The longest custom range the overview RPC accepts (it refuses more than ten years). */
export const MAX_RANGE_DAYS = 3650;

function baseRange(key: PeriodKey, today: Date, custom: { from?: string | null; to?: string | null }): [Date, Date] | null {
  switch (key) {
    case "today":
      return [today, today];
    case "this_week": {
      // Weeks start on Monday.
      const dow = (today.getUTCDay() + 6) % 7;
      return [addDays(today, -dow), today];
    }
    case "this_month":
      return [startOfMonth(today), today];
    case "last_month": {
      const prev = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      return [prev, endOfMonth(prev)];
    }
    case "this_quarter": {
      const q = Math.floor(today.getUTCMonth() / 3) * 3;
      return [new Date(Date.UTC(today.getUTCFullYear(), q, 1)), today];
    }
    case "this_year":
      // The whole calendar year, so a later period of the year shows as empty days rather than being cut off.
      return [new Date(Date.UTC(today.getUTCFullYear(), 0, 1)), new Date(Date.UTC(today.getUTCFullYear(), 11, 31))];
    case "year_to_date":
      return [new Date(Date.UTC(today.getUTCFullYear(), 0, 1)), today];
    case "custom": {
      const a = parseIsoDate(custom.from);
      const b = parseIsoDate(custom.to);
      if (!a || !b || a > b || daysBetween(a, b) > MAX_RANGE_DAYS) return null;
      return [a, b];
    }
  }
}

function compareRange(compare: CompareKey, from: Date, to: Date): [Date, Date] | null {
  if (compare === "none") return null;
  if (compare === "previous_year") return [addYears(from, -1), addYears(to, -1)];
  // Previous period: the same number of days immediately before.
  const span = daysBetween(from, to) + 1;
  return [addDays(from, -span), addDays(from, -1)];
}

export interface PeriodParams {
  period?: string | null;
  from?: string | null;
  to?: string | null;
  compare?: string | null;
}

/**
 * Resolve URL parameters to a period. Anything unreadable (an unknown key, a
 * custom range with a bad date) falls back to this month with the previous
 * period, rather than silently showing some other range under a custom label.
 */
export function resolvePeriod(params: PeriodParams, todayIso: string): ResolvedPeriod {
  const today = parseIsoDate(todayIso);
  if (!today) throw new Error(`resolvePeriod: today must be YYYY-MM-DD, got ${todayIso}`);

  const requested = (PERIOD_KEYS as readonly string[]).includes(params.period ?? "")
    ? (params.period as PeriodKey)
    : "this_month";
  const compare = (COMPARE_KEYS as readonly string[]).includes(params.compare ?? "")
    ? (params.compare as CompareKey)
    : "previous_period";

  let key: PeriodKey = requested;
  let range = baseRange(key, today, params);
  if (!range) {
    key = "this_month";
    range = baseRange(key, today, params) as [Date, Date];
  }
  const [from, to] = range;
  const cmp = compareRange(compare, from, to);
  const fromIso = toIso(from);
  const toIsoStr = toIso(to);

  return {
    key,
    from: fromIso,
    to: toIsoStr,
    compare,
    compareFrom: cmp ? toIso(cmp[0]) : null,
    compareTo: cmp ? toIso(cmp[1]) : null,
    granularity: granularityFor(fromIso, toIsoStr),
    label: periodLabel(fromIso, toIsoStr),
  };
}

/** URL search parameters for a period choice; drops the custom dates when they are not needed. */
export function periodSearchParams(choice: { period: PeriodKey; compare: CompareKey; from?: string; to?: string }): URLSearchParams {
  const p = new URLSearchParams();
  p.set("period", choice.period);
  p.set("compare", choice.compare);
  if (choice.period === "custom" && choice.from && choice.to) {
    p.set("from", choice.from);
    p.set("to", choice.to);
  }
  return p;
}
