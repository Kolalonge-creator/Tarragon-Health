/**
 * "Add to my calendar" files (RFC 5545). Pure functions, no server-only imports, so the routes and the tests read one
 * definition. A calendar file usually ends up synced to a phone or a Google or Apple account, so it carries no clinical
 * detail: no reason for the visit, no test names, no results. Only when, where and a link back to the app.
 *
 * Lagos keeps UTC+1 all year (no daylight saving), so a local date and time converts with a fixed offset.
 */

export type CalendarEvent = {
  /** Stable across downloads, so re-importing updates the event rather than adding a second copy. */
  uid: string;
  summary: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
} & ({ allDay: true; date: string } | { allDay?: false; start: Date; end: Date });

/** Only a confirmed booking goes into a calendar: a held slot may lapse, and "booked" can still be waiting for payment. */
export const CALENDAR_APPOINTMENT_STATUSES = ["confirmed", "checked_in", "in_progress"] as const;

const PRODID = "-//Tarragon Health//Bookings//EN";
const LAGOS_OFFSET = "+01:00";

/** "2026-11-20" + "09:30[:00]" in Lagos → the exact instant. Returns null for anything malformed. */
export function lagosDateTime(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return null;
  const d = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}${LAGOS_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A testing day's calendar event: timed when the day has an opening time, otherwise all day. */
export function testingDayEvent(booking: {
  booking_id: string;
  event_date: string;
  starts_at: string | null;
  ends_at?: string | null;
  venue_name: string;
  address: string;
  city: string;
  state_name?: string | null;
  directions?: string | null;
}, appUrl: string): CalendarEvent {
  const location = [booking.venue_name, booking.address, booking.city, booking.state_name].filter(Boolean).join(", ");
  const description = [
    booking.directions ? `Directions: ${booking.directions}` : null,
    "Please ask for the registration desk when you arrive.",
    `Your booking: ${appUrl}/patient/testing-days`,
  ]
    .filter(Boolean)
    .join("\n");
  const base = {
    uid: `testing-booking-${booking.booking_id}@tarragonhealth.ng`,
    summary: "Tarragon Health testing day",
    location,
    description,
    url: `${appUrl}/patient/testing-days`,
  };
  const start = booking.starts_at ? lagosDateTime(booking.event_date, booking.starts_at) : null;
  if (!start) return { ...base, allDay: true, date: booking.event_date };
  const endFromDay = booking.ends_at ? lagosDateTime(booking.event_date, booking.ends_at) : null;
  // No closing time: hold two hours, roughly how long the stations take.
  const end = endFromDay && endFromDay > start ? endFromDay : new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return { ...base, start, end };
}

/** A booked consultation's calendar event. The summary names the kind of meeting, never the reason for it. */
export function appointmentEvent(appointment: {
  id: string;
  scheduled_for: string;
  ends_at: string;
  label: string;
  clinicianName?: string | null;
}, appUrl: string): CalendarEvent | null {
  const start = new Date(appointment.scheduled_for);
  const end = new Date(appointment.ends_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
  return {
    uid: `appointment-${appointment.id}@tarragonhealth.ng`,
    summary: `Tarragon Health: ${appointment.label}`,
    location: "Online, in the Tarragon Health app",
    description: [
      appointment.clinicianName ? `With Dr. ${appointment.clinicianName}.` : null,
      `Join from your appointments page a few minutes early: ${appUrl}/patient/appointments`,
    ]
      .filter(Boolean)
      .join("\n"),
    url: `${appUrl}/patient/appointments`,
    start,
    end,
  };
}

/** Escape a TEXT value: backslash, semicolon, comma and line breaks. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold a content line at 75 octets, continuing with a space, without splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (currentBytes + size > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
    }
    current += ch;
    currentBytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/** One VCALENDAR holding every event. `now` is passed in so the output is testable. */
export function buildIcs(events: CalendarEvent[], now: Date = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${PRODID}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${utcStamp(now)}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${e.date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${nextDay(e.date)}`);
    } else {
      lines.push(`DTSTART:${utcStamp(e.start)}`, `DTEND:${utcStamp(e.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    // A reminder the day before, in the calendar app itself; the platform's own reminders are separate.
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "TRIGGER:-P1D", "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/**
 * The address the person reached the app on, for links inside a calendar file. Read from the Host header (what proxy.ts
 * routes on), not request.url, which Next can normalise to a different host than the one the browser used.
 */
export function requestAppOrigin(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return new URL(request.url).origin;
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return `${proto.split(",")[0]!.trim()}://${host.split(",")[0]!.trim()}`;
}

/** The response every calendar route sends: a download, never cached (it is the person's own schedule). */
export function icsResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
