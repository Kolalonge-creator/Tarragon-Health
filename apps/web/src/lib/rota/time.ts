/** Lagos has no daylight saving (UTC+1 all year), so a datetime typed on the form is converted with a fixed offset. */
const LAGOS = "Africa/Lagos";

/** "2026-10-07T08:00" from a datetime-local input becomes an ISO instant, or null when it is not a real local time. */
export function lagosLocalToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00+01:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function formatLagos(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: LAGOS, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function formatLagosRange(startIso: string, endIso: string): string {
  const end = new Intl.DateTimeFormat("en-GB", { timeZone: LAGOS, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(endIso));
  return `${formatLagos(startIso)} to ${end}`;
}

/** The value a datetime-local input needs for "an hour from now, on the hour", in Lagos time. */
export function defaultStartInput(now: Date): string {
  const next = new Date(Math.ceil((now.getTime() + 60 * 60 * 1000) / (60 * 60 * 1000)) * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: LAGOS, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(next);
  return parts.replace(" ", "T");
}
