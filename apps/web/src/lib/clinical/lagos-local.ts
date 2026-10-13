/**
 * A datetime-local form value has no timezone. The platform's timezone is Africa/Lagos (UTC+1, no daylight saving) and the server runs in UTC, so reading it
 * with `new Date(value)` would put a reading taken at 14:00 in Lagos at 15:00 Lagos, an hour in the future. Returns null when it is not a real date and time.
 */
export function parseLagosLocal(value: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3] ?? "00"}+01:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
