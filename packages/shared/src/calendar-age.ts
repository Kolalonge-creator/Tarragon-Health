/**
 * Whole years between a YYYY-MM-DD date of birth and `now`, by calendar date in Africa/Lagos; null when the date is
 * missing, malformed or in the future. Unlike ageFromDateOfBirth (365.25-day division), it is never a year out on the
 * days around a birthday, which matters where age is shown as an identifier or near dosing context.
 */
export function calendarAgeInYears(dateOfBirth: string | null | undefined, now: Date): number | null {
  const m = dateOfBirth ? /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now)
    .split("-")
    .map(Number);
  const [ty, tm, td] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  const age = ty - y - (tm < mo || (tm === mo && td < d) ? 1 : 0);
  return age >= 0 && age < 150 ? age : null;
}
