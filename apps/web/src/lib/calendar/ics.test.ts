import { appointmentEvent, buildIcs, escapeText, foldLine, lagosDateTime, testingDayEvent } from "./ics";

const APP = "https://app.tarragonhealth.ng";
const NOW = new Date("2026-11-03T10:00:00Z");

describe("lagosDateTime", () => {
  it("reads a Lagos local time as UTC+1 all year", () => {
    expect(lagosDateTime("2026-07-01", "09:30")?.toISOString()).toBe("2026-07-01T08:30:00.000Z");
    expect(lagosDateTime("2026-12-01", "09:30:00")?.toISOString()).toBe("2026-12-01T08:30:00.000Z");
  });
  it("refuses malformed input", () => {
    expect(lagosDateTime("2026-7-1", "09:30")).toBeNull();
    expect(lagosDateTime("2026-07-01", "9am")).toBeNull();
  });
});

describe("testingDayEvent", () => {
  const booking = {
    booking_id: "11111111-1111-4111-8111-111111111111",
    event_date: "2026-11-20",
    starts_at: "09:00:00",
    ends_at: "15:00:00",
    venue_name: "Civic Centre",
    address: "1 Ozumba Mbadiwe Ave",
    city: "Lagos",
    state_name: "Lagos",
    directions: "Main gate, hall B",
  };

  it("uses the opening and closing time", () => {
    const e = testingDayEvent(booking, APP);
    expect(e.allDay).toBeFalsy();
    if (e.allDay) throw new Error("expected timed");
    expect(e.start.toISOString()).toBe("2026-11-20T08:00:00.000Z");
    expect(e.end.toISOString()).toBe("2026-11-20T14:00:00.000Z");
    expect(e.location).toBe("Civic Centre, 1 Ozumba Mbadiwe Ave, Lagos, Lagos");
    expect(e.description).toContain("Directions: Main gate, hall B");
  });

  it("holds two hours when there is no closing time, and is all day when there is no opening time", () => {
    const noEnd = testingDayEvent({ ...booking, ends_at: null }, APP);
    if (noEnd.allDay) throw new Error("expected timed");
    expect(noEnd.end.getTime() - noEnd.start.getTime()).toBe(2 * 60 * 60 * 1000);
    expect(testingDayEvent({ ...booking, starts_at: null }, APP)).toMatchObject({ allDay: true, date: "2026-11-20" });
  });
});

describe("appointmentEvent", () => {
  it("names the kind of meeting, never a reason, and refuses an end before the start", () => {
    const e = appointmentEvent(
      { id: "22222222-2222-4222-8222-222222222222", scheduled_for: "2026-11-21T09:00:00Z", ends_at: "2026-11-21T09:20:00Z", label: "Video or audio visit", clinicianName: "Ada" },
      APP,
    );
    expect(e?.summary).toBe("Tarragon Health: Video or audio visit");
    expect(e?.description).toContain("With Dr. Ada.");
    expect(appointmentEvent({ id: "x", scheduled_for: "2026-11-21T09:00:00Z", ends_at: "2026-11-21T08:00:00Z", label: "x" }, APP)).toBeNull();
  });
});

describe("buildIcs", () => {
  it("writes a valid calendar with CRLF lines, escaped text and a stable UID", () => {
    const body = buildIcs(
      [
        { uid: "a@tarragonhealth.ng", summary: "Hello, world; ok", allDay: true, date: "2026-12-31" },
        { uid: "b@tarragonhealth.ng", summary: "Timed", start: new Date("2026-11-20T08:00:00Z"), end: new Date("2026-11-20T09:00:00Z") },
      ],
      NOW,
    );
    expect(body.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(body.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(body).toContain("SUMMARY:Hello\\, world\\; ok");
    expect(body).toContain("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101");
    expect(body).toContain("DTSTART:20261120T080000Z");
    expect(body).toContain("DTSTAMP:20261103T100000Z");
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(body.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it("writes an empty calendar when there is nothing booked", () => {
    expect(buildIcs([], NOW)).not.toContain("BEGIN:VEVENT");
  });
});

describe("escapeText and foldLine", () => {
  it("escapes backslashes, separators and new lines", () => {
    expect(escapeText("a\\b,c;d\ne")).toBe("a\\\\b\\,c\\;d\\ne");
  });
  it("folds long lines without splitting a multi-byte character", () => {
    const folded = foldLine(`DESCRIPTION:${"₦".repeat(40)}`);
    const parts = folded.split("\r\n ");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join("")).toBe(`DESCRIPTION:${"₦".repeat(40)}`);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
  });
});
