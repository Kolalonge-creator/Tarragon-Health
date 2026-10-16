import { describe, expect, it } from "@jest/globals";
import { minutesLeft, parseCheckInPending, parseCheckInRequest, parseOpenAlerts, parsePreview, parseUnanswered } from "./model";

describe("S29e: supporters abroad and the check-in window (web parsers)", () => {
  it("the preview carries whether the supporter is across organisations", () => {
    const p = parsePreview({ ok: true, inviter_first_name: "Ada", relationship: "Daughter", permissions: ["adherence_summary"], grant_days: 365, expires_at: "t", cross_organisation: true });
    expect(p.ok && p.cross_organisation).toBe(true);
    const same = parsePreview({ ok: true, inviter_first_name: "Ada", relationship: "Daughter", permissions: ["red_alerts"], grant_days: 365, expires_at: "t" });
    expect(same.ok && same.cross_organisation).toBeUndefined();
    expect(parsePreview({ ok: false })).toEqual({ ok: false });
  });

  it("a check-in request is a success, a known refusal, or not understood", () => {
    expect(parseCheckInRequest({ ok: true, window_ends_at: "t" })).toEqual({ ok: true, window_ends_at: "t" });
    expect(parseCheckInRequest({ ok: false, reason: "limit" })).toEqual({ ok: false, reason: "limit" });
    expect(parseCheckInRequest({ ok: false, reason: "already_waiting" })).toEqual({ ok: false, reason: "already_waiting" });
    expect(parseCheckInRequest({ ok: false, reason: "other" })).toBeNull();
    expect(parseCheckInRequest(null)).toBeNull();
  });

  it("a question is waiting only when the database says so", () => {
    expect(parseCheckInPending({ waiting: true })).toBe(true);
    expect(parseCheckInPending({ waiting: false })).toBe(false);
    expect(parseCheckInPending({})).toBe(false);
    expect(parseCheckInPending(undefined)).toBe(false);
  });

  it("the nav badge counts only requests nobody has marked as called", () => {
    const alerts = parseOpenAlerts([
      { patient_id: "a", name: "Mum", since: "t", called: false },
      { patient_id: "b", name: "Dad", since: "t", called: true },
    ]);
    expect(alerts.filter((a) => !a.called)).toHaveLength(1);
  });

  it("people who did not answer are name and time only; a malformed row is dropped", () => {
    expect(parseUnanswered([{ patient_id: "a", name: "Mum", since: "t", reading: "182/112" }, { nope: 1 }])).toEqual([{ patient_id: "a", name: "Mum", since: "t" }]);
    expect(parseUnanswered(null)).toEqual([]);
  });

  it("minutes left come from the end time, never below one", () => {
    const now = Date.parse("2026-10-16T10:00:00Z");
    expect(minutesLeft("2026-10-16T10:10:00Z", now)).toBe(10);
    expect(minutesLeft("2026-10-16T10:00:10Z", now)).toBe(1);
    expect(minutesLeft("2026-10-16T09:00:00Z", now)).toBe(1);
    expect(minutesLeft("garbage", now)).toBe(5);
  });
});
