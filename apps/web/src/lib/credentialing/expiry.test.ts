import { describe, expect, it } from "@jest/globals";
import { daysUntil, describeDays, expiryBand, lagosDate } from "./expiry";

describe("lagosDate", () => {
  it("uses the Lagos calendar day, not UTC", () => {
    // 23:30 UTC on the 5th is 00:30 on the 6th in Lagos (UTC+1)
    expect(lagosDate(new Date("2026-10-05T23:30:00Z"))).toBe("2026-10-06");
    expect(lagosDate(new Date("2026-10-05T22:30:00Z"))).toBe("2026-10-05");
  });
});

describe("daysUntil", () => {
  const now = new Date("2026-10-06T09:00:00Z");

  it("is 0 on the expiry day whatever the time on the licence", () => {
    expect(daysUntil("2026-10-06T00:00:00+01:00", now)).toBe(0);
    expect(daysUntil("2026-10-06T23:59:00+01:00", now)).toBe(0);
  });

  it("counts whole Lagos days ahead and behind", () => {
    expect(daysUntil("2026-10-07T12:00:00+01:00", now)).toBe(1);
    expect(daysUntil("2027-01-04T12:00:00+01:00", now)).toBe(90);
    expect(daysUntil("2026-10-05T12:00:00+01:00", now)).toBe(-1);
  });

  it("returns null for a missing or unreadable date", () => {
    expect(daysUntil(null, now)).toBeNull();
    expect(daysUntil(undefined, now)).toBeNull();
    expect(daysUntil("not a date", now)).toBeNull();
  });
});

describe("expiryBand and describeDays", () => {
  it("follows the 90, 30 and 0 day windows exactly", () => {
    expect(expiryBand(null)).toBe("not_recorded");
    expect(expiryBand(-1)).toBe("expired");
    expect(expiryBand(0)).toBe("today");
    expect(expiryBand(1)).toBe("month");
    expect(expiryBand(30)).toBe("month");
    expect(expiryBand(31)).toBe("quarter");
    expect(expiryBand(90)).toBe("quarter");
    expect(expiryBand(91)).toBe("ok");
  });

  it("words the days plainly", () => {
    expect(describeDays(null)).toBe("No date on file");
    expect(describeDays(0)).toBe("Expires today");
    expect(describeDays(1)).toBe("1 day left");
    expect(describeDays(12)).toBe("12 days left");
    expect(describeDays(-1)).toBe("Expired 1 day ago");
    expect(describeDays(-9)).toBe("Expired 9 days ago");
  });
});
