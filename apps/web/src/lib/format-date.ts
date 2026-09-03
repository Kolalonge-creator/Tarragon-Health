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
