import { describe, expect, it } from "@jest/globals";
import { canReportLost, clearedCounts, phoneState, sortPhones, type PhoneLeaseRow } from "./my-phones";

const NOW = Date.parse("2026-10-20T10:00:00Z");
const DAY = 86_400_000;
const row = (over: Partial<PhoneLeaseRow> = {}): PhoneLeaseRow => ({
  device_id: "d1",
  platform: "android",
  registered_at: "2026-09-01T00:00:00Z",
  last_checkin_at: "2026-10-19T00:00:00Z",
  lease_expires_at: new Date(NOW + 20 * DAY).toISOString(),
  revoked_at: null,
  revoke_reason: null,
  wipe_confirmed_at: null,
  wipe_reason: null,
  unsent_at_wipe: null,
  danger_at_wipe: null,
  retired_at: null,
  ...over,
});

describe("phoneState", () => {
  it("is active well inside the lease", () => expect(phoneState(row(), NOW)).toBe("active"));
  it("says the lease is ending in its last week, without alarm", () =>
    expect(phoneState(row({ lease_expires_at: new Date(NOW + 3 * DAY).toISOString() }), NOW)).toBe("lease_ending"));
  it("lapsed once the lease date has passed", () =>
    expect(phoneState(row({ lease_expires_at: new Date(NOW - DAY).toISOString() }), NOW)).toBe("lease_lapsed"));
  it("a reported phone waits to be cleared", () => expect(phoneState(row({ revoked_at: "2026-10-20T09:00:00Z" }), NOW)).toBe("lost_reported"));
  it("a cleared phone is cleared even though it was also reported", () =>
    expect(phoneState(row({ revoked_at: "2026-10-19T09:00:00Z", wipe_confirmed_at: "2026-10-19T10:00:00Z" }), NOW)).toBe("cleared"));
  it("a long-silent retired phone is quiet", () => expect(phoneState(row({ retired_at: "2026-10-01T00:00:00Z" }), NOW)).toBe("quiet"));
  it("an unreadable lease date is treated as active, never as lost", () => expect(phoneState(row({ lease_expires_at: "nonsense" }), NOW)).toBe("active"));
});

describe("canReportLost", () => {
  it("is offered for live and quiet phones, not once reported or cleared", () => {
    expect(canReportLost("active")).toBe(true);
    expect(canReportLost("lease_lapsed")).toBe(true);
    expect(canReportLost("quiet")).toBe(true);
    expect(canReportLost("lost_reported")).toBe(false);
    expect(canReportLost("cleared")).toBe(false);
  });
});

describe("sortPhones and clearedCounts", () => {
  it("lists live phones first, newest check-in first, cleared last", () => {
    const rows = [row({ device_id: "cleared", wipe_confirmed_at: "x" }), row({ device_id: "old", last_checkin_at: "2026-10-01T00:00:00Z" }), row({ device_id: "new" })];
    expect(sortPhones(rows, NOW).map((r) => r.device_id)).toEqual(["new", "old", "cleared"]);
  });
  it("never reports more urgent entries than unsent ones, nor a negative or fractional count", () => {
    expect(clearedCounts(row({ unsent_at_wipe: 3, danger_at_wipe: 9 }))).toEqual({ unsent: 3, urgent: 3 });
    expect(clearedCounts(row({ unsent_at_wipe: -2, danger_at_wipe: null }))).toEqual({ unsent: 0, urgent: 0 });
    expect(clearedCounts(row({ unsent_at_wipe: 2.7, danger_at_wipe: 1 }))).toEqual({ unsent: 2, urgent: 1 });
  });
});
