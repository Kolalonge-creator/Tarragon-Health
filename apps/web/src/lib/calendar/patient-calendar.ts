/**
 * The patient's year at a glance: booked consultations, testing-day places, testing days still open to book, and
 * screenings that are due. Pure, so the page and the tests share one definition. Dates are Lagos calendar dates.
 */

export type CalendarEntryKind = "appointment" | "testing_booked" | "testing_open" | "screening";

export type CalendarEntry = {
  id: string;
  kind: CalendarEntryKind;
  /** Lagos calendar date, YYYY-MM-DD */
  date: string;
  /** "09:30" or "09:30 to 15:00"; empty for an all-day item */
  time: string;
  title: string;
  detail: string;
  status: string;
  /** Where the item is managed in the app */
  href: string;
  /** A downloadable calendar file, only for confirmed bookings */
  icsHref: string | null;
};

export const ENTRY_KIND_LABEL: Record<CalendarEntryKind, string> = {
  appointment: "Consultation",
  testing_booked: "Testing day, booked",
  testing_open: "Testing day, open to book",
  screening: "Screening due",
};

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const LAGOS_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" });
const LAGOS_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: false });

export function lagosDate(iso: string): string {
  return LAGOS_DATE.format(new Date(iso));
}
export function lagosTime(iso: string): string {
  return LAGOS_TIME.format(new Date(iso));
}

function hours(from: string | null | undefined, to: string | null | undefined): string {
  const f = from ? from.slice(0, 5) : "";
  const t = to ? to.slice(0, 5) : "";
  return f && t ? `${f} to ${t}` : f;
}

export type CalendarInput = {
  appointments: { id: string; scheduled_for: string; ends_at: string; status: string; label: string; clinicianName: string | null }[];
  testingBookings: {
    booking_id: string;
    state: string;
    event_date: string;
    starts_at: string | null;
    ends_at?: string | null;
    venue_name: string;
    city: string;
  }[];
  openDays: { id: string; event_date: string; starts_at: string | null; ends_at?: string | null; venue_name: string; city: string; state: string | null; full: boolean }[];
  screenings: { id: string; due_date: string | null; status: string; name: string }[];
};

const CONFIRMED_APPOINTMENT = new Set(["confirmed", "checked_in", "in_progress"]);
const HIDDEN_TESTING = new Set(["cancelled"]);
const HIDDEN_SCREENING = new Set(["cancelled", "declined"]);

/** Everything in the given year, sorted by date then time. Cancelled items are left out. */
export function buildCalendarEntries(input: CalendarInput, year: number): CalendarEntry[] {
  const inYear = (date: string) => date.startsWith(`${year}-`);
  const entries: CalendarEntry[] = [];

  for (const a of input.appointments) {
    const date = lagosDate(a.scheduled_for);
    if (!inYear(date) || a.status === "cancelled") continue;
    entries.push({
      id: `appointment-${a.id}`,
      kind: "appointment",
      date,
      time: `${lagosTime(a.scheduled_for)} to ${lagosTime(a.ends_at)}`,
      title: a.label,
      detail: a.clinicianName ? `With Dr. ${a.clinicianName}, online` : "Online",
      status: a.status,
      href: "/patient/appointments",
      icsHref: CONFIRMED_APPOINTMENT.has(a.status) ? `/api/calendar/appointment/${a.id}` : null,
    });
  }

  const bookedDays = new Set<string>();
  for (const b of input.testingBookings) {
    if (!inYear(b.event_date) || HIDDEN_TESTING.has(b.state)) continue;
    bookedDays.add(`${b.event_date}|${b.venue_name}`);
    entries.push({
      id: `testing-${b.booking_id}`,
      kind: "testing_booked",
      date: b.event_date,
      time: hours(b.starts_at, b.ends_at),
      title: "Testing day",
      detail: `${b.venue_name}, ${b.city}`,
      status: b.state,
      href: "/patient/testing-days",
      icsHref: b.state === "confirmed" ? `/api/calendar/testing/${b.booking_id}` : null,
    });
  }

  for (const d of input.openDays) {
    if (!inYear(d.event_date) || bookedDays.has(`${d.event_date}|${d.venue_name}`)) continue;
    entries.push({
      id: `open-${d.id}`,
      kind: "testing_open",
      date: d.event_date,
      time: hours(d.starts_at, d.ends_at),
      title: "Testing day you can book",
      detail: `${d.venue_name}, ${d.city}${d.state ? `, ${d.state}` : ""}`,
      status: d.full ? "full" : "open",
      href: `/patient/testing-days?city=${encodeURIComponent(d.city)}`,
      icsHref: null,
    });
  }

  for (const s of input.screenings) {
    if (!s.due_date || !inYear(s.due_date) || HIDDEN_SCREENING.has(s.status)) continue;
    entries.push({
      id: `screening-${s.id}`,
      kind: "screening",
      date: s.due_date,
      time: "",
      title: s.name,
      detail: "Due around this date",
      status: s.status,
      href: "/patient/prevention",
      icsHref: null,
    });
  }

  return entries.sort((x, y) => (x.date === y.date ? x.time.localeCompare(y.time) : x.date.localeCompare(y.date)));
}

/** Twelve buckets, January first, so the page can show every month even when it is empty. */
export function groupByMonth(entries: CalendarEntry[]): CalendarEntry[][] {
  const months: CalendarEntry[][] = Array.from({ length: 12 }, () => []);
  for (const e of entries) months[Number(e.date.slice(5, 7)) - 1]?.push(e);
  return months;
}

/** A year from the address bar, kept within a sensible range; anything else falls back to this year. */
export function parseYear(raw: string | undefined, thisYear: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= thisYear - 5 && n <= thisYear + 2 ? n : thisYear;
}
