import { buildCalendarEntries, groupByMonth, parseYear, type CalendarInput } from "./patient-calendar";

const EMPTY: CalendarInput = { appointments: [], testingBookings: [], openDays: [], screenings: [] };

describe("buildCalendarEntries", () => {
  it("brings consultations, testing days and screenings into one year, in date order", () => {
    const entries = buildCalendarEntries(
      {
        appointments: [
          { id: "a1", scheduled_for: "2026-03-10T08:00:00Z", ends_at: "2026-03-10T08:20:00Z", status: "confirmed", label: "Video or audio visit", clinicianName: "Ada" },
        ],
        testingBookings: [
          { booking_id: "b1", state: "confirmed", event_date: "2026-02-05", starts_at: "09:00:00", ends_at: "15:00:00", venue_name: "Hall", city: "Lagos" },
        ],
        openDays: [{ id: "d1", event_date: "2026-06-01", starts_at: null, ends_at: null, venue_name: "Centre", city: "Abuja", state: "FCT", full: false }],
        screenings: [{ id: "s1", due_date: "2026-01-15", status: "pending", name: "Cervical screening" }],
      },
      2026,
    );
    expect(entries.map((e) => e.kind)).toEqual(["screening", "testing_booked", "appointment", "testing_open"]);
    expect(entries[1]).toMatchObject({ time: "09:00 to 15:00", icsHref: "/api/calendar/testing/b1" });
    // 08:00Z is 09:00 in Lagos
    expect(entries[2]).toMatchObject({ date: "2026-03-10", time: "09:00 to 09:20", icsHref: "/api/calendar/appointment/a1" });
    expect(entries[3]).toMatchObject({ href: "/patient/testing-days?city=Abuja", icsHref: null });
  });

  it("puts a visit just after midnight Lagos time on the Lagos date, even across the year edge", () => {
    const [e] = buildCalendarEntries(
      { ...EMPTY, appointments: [{ id: "a", scheduled_for: "2026-12-31T23:30:00Z", ends_at: "2026-12-31T23:50:00Z", status: "confirmed", label: "x", clinicianName: null }] },
      2027,
    );
    expect(e?.date).toBe("2027-01-01");
  });

  it("leaves out cancelled items, other years, and an open day the patient already booked", () => {
    const entries = buildCalendarEntries(
      {
        appointments: [{ id: "a", scheduled_for: "2026-03-10T08:00:00Z", ends_at: "2026-03-10T08:20:00Z", status: "cancelled", label: "x", clinicianName: null }],
        testingBookings: [
          { booking_id: "b", state: "cancelled", event_date: "2026-02-05", starts_at: null, venue_name: "Hall", city: "Lagos" },
          { booking_id: "c", state: "waitlisted", event_date: "2026-04-05", starts_at: null, venue_name: "Hall", city: "Lagos" },
        ],
        openDays: [
          { id: "d", event_date: "2026-04-05", starts_at: null, venue_name: "Hall", city: "Lagos", state: null, full: true },
          { id: "e", event_date: "2027-01-05", starts_at: null, venue_name: "Hall", city: "Lagos", state: null, full: false },
        ],
        screenings: [{ id: "s", due_date: "2026-01-15", status: "declined", name: "x" }],
      },
      2026,
    );
    expect(entries.map((e) => e.id)).toEqual(["testing-c"]);
    // a waiting-list place is shown but is not yet something to put in a calendar
    expect(entries[0]?.icsHref).toBeNull();
  });

  it("offers a calendar file only for confirmed consultations, not one still waiting for payment", () => {
    const entries = buildCalendarEntries(
      { ...EMPTY, appointments: [{ id: "a", scheduled_for: "2026-03-10T08:00:00Z", ends_at: "2026-03-10T08:20:00Z", status: "booked", label: "x", clinicianName: null }] },
      2026,
    );
    expect(entries[0]?.icsHref).toBeNull();
  });
});

describe("groupByMonth and parseYear", () => {
  it("always returns twelve months", () => {
    const months = groupByMonth(buildCalendarEntries({ ...EMPTY, screenings: [{ id: "s", due_date: "2026-12-01", status: "pending", name: "x" }] }, 2026));
    expect(months).toHaveLength(12);
    expect(months[11]).toHaveLength(1);
  });
  it("keeps the year in range", () => {
    expect(parseYear("2027", 2026)).toBe(2027);
    expect(parseYear("1999", 2026)).toBe(2026);
    expect(parseYear("abc", 2026)).toBe(2026);
    expect(parseYear(undefined, 2026)).toBe(2026);
  });
});
