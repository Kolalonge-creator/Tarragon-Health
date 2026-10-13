/**
 * S04b-3: quiet hours and discreet mode in the one sender. The sender's decision is the pure `decide` plus the
 * envelope helpers, so these tests cover the whole rule: a reminder is held then released, a red event never is,
 * and discreet mode produces generic words on push and email.
 */
import { describe, expect, it } from "@jest/globals";
import { decide, discreetEmail, FALLBACK_QUIET, isSafetyCritical, pushEnvelope, type DecideInput, type QuietSettings } from "./index.ts";

const Q: QuietSettings = { enabled: true, start: "21:00", end: "07:00" };
const utc = (h: number, m = 0) => Date.UTC(2026, 9, 6, h, m); // Africa/Lagos is UTC+1
const DAY = 24 * 3600_000;
const night = utc(21); // 22:00 Lagos
const reminder: DecideInput = {
  channel: "push", priority: "routine", nowMs: night, quiet: Q, routinePushSentToday: 0, routinePushPerDay: 4,
  wordingViolations: [], isClinicianPage: false, safetyCritical: false,
};

describe("quiet hours", () => {
  it("are off when nothing says otherwise", () => {
    expect(FALLBACK_QUIET.enabled).toBe(false);
    expect(decide({ ...reminder, quiet: FALLBACK_QUIET })).toEqual({ action: "send" });
  });

  it("hold a reminder, then release it once the window ends (held, not dropped)", () => {
    const held = decide(reminder);
    expect(held.action).toBe("defer");
    const until = (held as { until: number }).until;
    expect(until).toBe(utc(6) + DAY); // 07:00 Lagos
    expect(decide({ ...reminder, nowMs: until - 1 }).action).toBe("defer");
    expect(decide({ ...reminder, nowMs: until })).toEqual({ action: "send" });
  });

  it("hold email the same way", () => {
    expect(decide({ ...reminder, channel: "email" }).action).toBe("defer");
  });

  it("never hold a red event, by priority or by template, nor count it against the push cap", () => {
    expect(decide({ ...reminder, priority: "critical" })).toEqual({ action: "send" });
    expect(decide({ ...reminder, safetyCritical: true })).toEqual({ action: "send" });
    expect(decide({ ...reminder, nowMs: utc(10), safetyCritical: true, routinePushSentToday: 99 })).toEqual({ action: "send" });
    expect(decide({ ...reminder, channel: "email", safetyCritical: true })).toEqual({ action: "send" });
  });
});

describe("safety templates", () => {
  it("are recognised, and ordinary reminders are not", () => {
    for (const t of ["emergency_followup", "emergency_contact_alert", "vitals_monitoring_escalated", "on_call_page", "on_call_escalation",
      "vitals_red_flag_clinician_alert", "abnormal_result_clinician_alert", "critical_notification_escalation_exhausted", "screening_escalated"]) {
      expect(isSafetyCritical(t)).toBe(true);
    }
    for (const t of ["booking_reminder", "daily_digest", "credential_notice", "emergency_card_viewed", "emergency_card_expiring_soon", "", null, undefined]) expect(isSafetyCritical(t)).toBe(false);
  });
});

describe("discreet mode", () => {
  it("sends a push with no brand or topic, and an urgent one says only that it is urgent", () => {
    expect(pushEnvelope(true, "Your blood pressure is high")).toEqual({ title: "New message", body: "Open the app." });
    expect(pushEnvelope(true, "anything", 160, true)).toEqual({ title: "Urgent message", body: "Open the app now." });
    expect(pushEnvelope(false, "Hello", 160, true)).toEqual({ title: "Tarragon Health", body: "Hello" });
  });

  it("sends an email with no brand, topic or link", () => {
    expect(discreetEmail(false).subject).toBe("New message");
    expect(discreetEmail(true).subject).toBe("Urgent message");
    for (const m of [discreetEmail(false), discreetEmail(true)]) {
      expect(`${m.subject} ${m.html} ${m.text}`).not.toMatch(/tarragon|http|result|medic|test|pressure|sugar|—/i);
    }
  });
});
