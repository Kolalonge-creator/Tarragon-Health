/**
 * Patient-facing date/time formatting.
 *
 * A bare toLocaleDateString()/toLocaleString() resolves the server's locale
 * and timezone on first render and the browser's on hydration, which produces
 * two real bugs: an SSR/hydration text mismatch, and SLA deadlines shown in
 * server UTC instead of the patient's own time (an hour early for Lagos).
 * Every patient-facing date goes through these helpers instead: fixed
 * "en-GB" locale plus Africa/Lagos, matching the platform's timezone rule
 * (CLAUDE.md: "Timezone always Africa/Lagos").
 *
 * Pass an options object to keep a call site's own verbosity (e.g.
 * { month: "short", day: "numeric" } for a compact chart axis label); the
 * options replace the defaults rather than merging into them, so a caller
 * that asks for only a weekday gets only a weekday. An explicit
 * options.timeZone (e.g. "UTC" for a calendar date anchored at UTC midnight)
 * wins over Africa/Lagos.
 */

const PATIENT_LOCALE = "en-GB";
const PATIENT_TIME_ZONE = "Africa/Lagos";

type DateInput = string | number | Date;

const DEFAULT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

const DEFAULT_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

const DEFAULT_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
};

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Date only, e.g. "3 Sept 2026". */
export function formatPatientDate(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions
): string {
  return toDate(value).toLocaleDateString(PATIENT_LOCALE, {
    timeZone: PATIENT_TIME_ZONE,
    ...(options ?? DEFAULT_DATE_OPTIONS),
  });
}

/** Date and time, e.g. "3 Sept 2026, 14:05". */
export function formatPatientDateTime(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions
): string {
  return toDate(value).toLocaleString(PATIENT_LOCALE, {
    timeZone: PATIENT_TIME_ZONE,
    ...(options ?? DEFAULT_DATE_TIME_OPTIONS),
  });
}

/** Time only, e.g. "14:05". */
export function formatPatientTime(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions
): string {
  return toDate(value).toLocaleTimeString(PATIENT_LOCALE, {
    timeZone: PATIENT_TIME_ZONE,
    ...(options ?? DEFAULT_TIME_OPTIONS),
  });
}

/* ------------------------------------------------------------------------ *
 * Lagos calendar helpers
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC calendar day, not the
 * Lagos one. Lagos is UTC+1 year round, so between 00:00 and 00:59 local the
 * UTC day is still yesterday — and on the 1st of a month it is still the prior
 * accounting period. Every default date range on a finance, analytics or
 * compliance screen goes through these instead of the raw ISO slice.
 * ------------------------------------------------------------------------ */

/** Lagos has no DST, so the offset back from a wall clock is a constant. */
const LAGOS_UTC_OFFSET = "+01:00";

const MS_PER_DAY = 86_400_000;

/** The Lagos wall clock for an instant, as "YYYY-MM-DD HH:mm:ss" (sv-SE
 * formats dates ISO-shaped, which is what makes the slices below safe). */
function lagosWallClock(now: Date): string {
  return now.toLocaleString("sv-SE", { timeZone: PATIENT_TIME_ZONE });
}

/** Today's date in Lagos as "YYYY-MM-DD". */
export function lagosToday(now: Date = new Date()): string {
  return lagosWallClock(now).slice(0, 10);
}

/** The Lagos date n days before now, as "YYYY-MM-DD". */
export function lagosDaysAgo(days: number, now: Date = new Date()): string {
  return lagosToday(new Date(now.getTime() - days * MS_PER_DAY));
}

/** The current Lagos month as "YYYY-MM". */
export function lagosMonth(now: Date = new Date()): string {
  return lagosToday(now).slice(0, 7);
}

/** The first day of the current Lagos month, as "YYYY-MM-DD". */
export function lagosMonthStart(now: Date = new Date()): string {
  return `${lagosMonth(now)}-01`;
}

/** The current Lagos year. */
export function lagosYear(now: Date = new Date()): number {
  return Number(lagosToday(now).slice(0, 4));
}

/** 1 January of the given Lagos year (the current one by default). */
export function lagosYearStart(year: number = lagosYear()): string {
  return `${year}-01-01`;
}

/** Lagos wall clock as a `datetime-local` input value, "YYYY-MM-DDTHH:mm". */
export function lagosDateTimeInputValue(now: Date = new Date()): string {
  return lagosWallClock(now).replace(/\s+/, "T").slice(0, 16);
}

/**
 * Read a `datetime-local` value back as the instant it names in Lagos.
 *
 * The browser hands back a bare wall clock with no zone, and `new Date(value)`
 * would resolve it against whatever zone the machine is set to. Pinning it to
 * Lagos is what keeps a regulatory clock (the NDPC 72-hour breach window)
 * counting from the moment the operator actually meant. Returns null for a
 * blank or unparseable value so the caller can refuse to save.
 */
export function lagosDateTimeInputToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) return null;
  const withSeconds = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
  const parsed = new Date(`${withSeconds}${LAGOS_UTC_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
