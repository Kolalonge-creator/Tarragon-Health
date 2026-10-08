import { describe, expect, it } from "@jest/globals";
import { classifyExpoReceipt, decide, emailEnvelope, pushEnvelope, quietUntil, type DecideInput, type QuietSettings } from "./index.ts";

const Q: QuietSettings = { enabled: true, start: "21:00", end: "07:00" };
// Africa/Lagos is UTC+1: 22:00 Lagos is 21:00 UTC.
const utc = (h: number, m = 0) => Date.UTC(2026, 9, 6, h, m);
const DAY = 24 * 3600_000;

describe("quietUntil", () => {
  it("is null when disabled or start equals end", () => {
    expect(quietUntil(utc(21), { ...Q, enabled: false })).toBeNull();
    expect(quietUntil(utc(21), { ...Q, start: "08:00", end: "08:00" })).toBeNull();
  });
  it("holds until 07:00 Lagos when it is 22:00 Lagos", () => {
    expect(quietUntil(utc(21), Q)).toBe(utc(6) + DAY); // 07:00 Lagos is 06:00 UTC the next day
  });
  it("holds until 07:00 Lagos from 03:30 Lagos (after midnight)", () => {
    expect(quietUntil(utc(2, 30), Q)).toBe(utc(6));
  });
  it("is null in the daytime", () => {
    expect(quietUntil(utc(10), Q)).toBeNull();
  });
  it("the start is inside and the end is outside", () => {
    expect(quietUntil(utc(20), Q)).not.toBeNull(); // 21:00 Lagos
    expect(quietUntil(utc(6), Q)).toBeNull(); // 07:00 Lagos
  });
  it("handles a window that does not cross midnight", () => {
    const day = { enabled: true, start: "13:00", end: "15:00" };
    expect(quietUntil(utc(12, 30), day)).toBe(utc(14)); // 13:30 Lagos
    expect(quietUntil(utc(15), day)).toBeNull();
  });
  it("lands exactly on the boundary when the clock has seconds", () => {
    expect(quietUntil(utc(21) + 37_000, Q)).toBe(utc(6) + DAY);
  });
  it("accepts a start without minutes", () => {
    expect(quietUntil(utc(21), { enabled: true, start: "21", end: "07" })).toBe(utc(6) + DAY);
  });
});

const base: DecideInput = {
  channel: "push", priority: "routine", nowMs: utc(10), quiet: Q, routinePushSentToday: 0, routinePushPerDay: 4,
  wordingViolations: [], isClinicianPage: false,
};

describe("decide", () => {
  it("sends a routine push in the daytime", () => {
    expect(decide(base)).toEqual({ action: "send" });
  });
  it("blocks clinical wording on any channel and any priority", () => {
    for (const priority of ["routine", "critical"] as const) {
      const d = decide({ ...base, priority, wordingViolations: ["term:diabetes"] });
      expect(d).toEqual({ action: "block", reason: "inv07", violations: ["term:diabetes"] });
    }
  });
  it("defers routine push and email in quiet hours, never drops them", () => {
    for (const channel of ["push", "email"] as const) {
      const d = decide({ ...base, channel, nowMs: utc(21) });
      expect(d.action).toBe("defer");
    }
  });
  it("never defers a critical row or the in-app inbox", () => {
    expect(decide({ ...base, priority: "critical", nowMs: utc(21) })).toEqual({ action: "send" });
    expect(decide({ ...base, channel: "in_app", nowMs: utc(21) })).toEqual({ action: "send" });
  });
  it("caps routine push at the daily limit but not email", () => {
    expect(decide({ ...base, routinePushSentToday: 4 })).toEqual({ action: "suppress", reason: "daily_cap" });
    expect(decide({ ...base, channel: "email", routinePushSentToday: 4 })).toEqual({ action: "send" });
    expect(decide({ ...base, priority: "critical", routinePushSentToday: 99 })).toEqual({ action: "send" });
  });
  it("refuses sms that is not a clinician page (INV-08) and allows a page", () => {
    expect(decide({ ...base, channel: "sms" })).toEqual({ action: "suppress", reason: "sms_not_allowed" });
    expect(decide({ ...base, channel: "sms", isClinicianPage: true, nowMs: utc(21) })).toEqual({ action: "send" });
    expect(decide({ ...base, channel: "voice", nowMs: utc(21) })).toEqual({ action: "send" });
  });
});

describe("pushEnvelope", () => {
  it("shows the brand and the text normally, trimmed to the limit", () => {
    expect(pushEnvelope(false, "hello")).toEqual({ title: "Tarragon Health", body: "hello" });
    expect(pushEnvelope(false, "x".repeat(200), 10).body).toBe(`${"x".repeat(9)}…`);
  });
  it("discreet mode sends fixed words and no brand", () => {
    expect(pushEnvelope(true, "anything here")).toEqual({ title: "New message", body: "Open the app." });
  });
});

describe("emailEnvelope", () => {
  it("passes the template through normally", () => {
    expect(emailEnvelope(false, "Subject", "<p>Hi</p>", "Hi")).toEqual({ subject: "Subject", html: "<p>Hi</p>", text: "Hi" });
  });
  it("discreet mode sends fixed words and nothing from the template", () => {
    const e = emailEnvelope(true, "Your appointment tomorrow", "<p>Clinic details</p>", "Clinic details");
    expect(e.subject).toBe("New message");
    expect(`${e.subject} ${e.html} ${e.text}`).not.toMatch(/appointment|clinic|Tarragon/i);
  });
});

describe("classifyExpoReceipt", () => {
  it("maps ok, dead token, other errors, and not-ready", () => {
    expect(classifyExpoReceipt({ status: "ok" })).toEqual({ event: "delivered" });
    expect(classifyExpoReceipt({ status: "error", details: { error: "DeviceNotRegistered" } })).toEqual({ event: "token_dead" });
    expect(classifyExpoReceipt({ status: "error", details: { error: "MessageRateExceeded" } })).toEqual({ event: "failed", reason: "MessageRateExceeded" });
    expect(classifyExpoReceipt({ status: "error", message: "boom" })).toEqual({ event: "failed", reason: "boom" });
    expect(classifyExpoReceipt({ status: "error" })).toEqual({ event: "failed", reason: "unknown" });
    expect(classifyExpoReceipt(undefined)).toBeNull();
  });
});
