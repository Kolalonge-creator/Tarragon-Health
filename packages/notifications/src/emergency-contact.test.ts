/**
 * The notice to a patient's own consented emergency contact. Since founder decision OQ-333 (2026-10-16) there is NO SMS exception: the
 * text is content-free, goes only by push, in-app and email, and the sender and the delivery rules refuse every SMS.
 */
import "./support/deno.ts";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";
import { decide, describeViolations, lintRenderFn, refusedSmsOutcome, type DecideInput } from "./index.ts";
import { checkFanoutRowConsent, emergencyContactName, emergencyContactText } from "../../../supabase/functions/_shared/notifications/emergency-contact.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";

const ctx = { notificationId: "n", recipientId: "r" };
const base: DecideInput = {
  channel: "push", priority: "routine", nowMs: Date.UTC(2026, 9, 13, 21, 0), quiet: { enabled: true, start: "21:00", end: "07:00" },
  routinePushSentToday: 0, routinePushPerDay: 4, wordingViolations: [],
};

describe("emergency-contact text", () => {
  it("is exactly the agreed words and carries nothing else", () => {
    expect(emergencyContactText("Ada Obi")).toBe("Please call Ada Obi now.");
  });
  it("falls back to a neutral word when there is no usable name (including the database function's own placeholder)", () => {
    expect(emergencyContactText(undefined)).toBe("Please call them now.");
    expect(emergencyContactText("   ")).toBe("Please call them now.");
    expect(emergencyContactName("someone who lists you as their emergency contact")).toBe("them");
  });
  it("the template renders that text for push and email and passes the INV-07 lint", () => {
    const fn = TEMPLATE_MAP.emergency_contact_alert!;
    expect(describeViolations(lintRenderFn((p) => fn(p, ctx)))).toEqual([]);
    const out = fn({ patient_name: "Ada Obi", condition: "hypertension", reading: "182/112", contact_name: "Chidi" }, ctx);
    expect(out.smsText).toBe("Please call Ada Obi now.");
    expect(out.email?.text).toBe(out.smsText);
    expect(JSON.stringify(out)).not.toMatch(/hypertension|182|112|Chidi|emergency|hospital|Tarragon: please/i);
  });
  it("cuts a very long name to 59 characters plus an ellipsis, and leaves a 60 character name alone", () => {
    expect(emergencyContactName("A".repeat(61))).toBe(`${"A".repeat(59)}\u2026`);
    expect(emergencyContactName("B".repeat(60))).toBe("B".repeat(60));
  });
});

describe("no SMS exception remains (OQ-333)", () => {
  it("every sms or voice row is refused by the delivery rules, the emergency-contact template included", () => {
    for (const channel of ["sms", "voice"] as const) {
      expect(decide({ ...base, channel, template: "emergency_contact_alert" })).toEqual({ action: "suppress", reason: "sms_not_allowed" });
      expect(decide({ ...base, channel, priority: "critical", template: "on_call_page" })).toEqual({ action: "suppress", reason: "sms_not_allowed" });
    }
  });
  it("the contact's push is still never held overnight or capped", () => {
    expect(decide({ ...base, template: "emergency_contact_alert", routinePushSentToday: 99 })).toEqual({ action: "send" });
    expect(decide({ ...base, template: "some_routine_notice", routinePushSentToday: 99 }).action).not.toBe("send");
  });
  it("a refused critical row fails (so the ladder alarms), a refused routine row is suppressed", () => {
    expect(refusedSmsOutcome("critical")).toBe("fail");
    expect(refusedSmsOutcome("routine")).toBe("suppress");
  });
  it("the copies for the contact stop if consent was withdrawn", () => {
    expect(checkFanoutRowConsent({ emergency_contact_consent: true })).toBe("ok");
    expect(checkFanoutRowConsent({ emergency_contact_consent: false })).toBe("consent_withdrawn");
    expect(checkFanoutRowConsent(null)).toBe("consent_withdrawn");
  });
  it("the sender and the delivery rules no longer name the exception, its guard, its fan-out or its text", () => {
    for (const f of [
      "../../supabase/functions/send-pending-notifications/index.ts",
      "../../supabase/functions/_shared/notifications/delivery.ts",
      "../../supabase/functions/_shared/notifications/emergency-contact.ts",
      "../../apps/web/src/lib/emergency/alert-contact.ts",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/sms_emergency_contact_enabled|emergencyContactSmsOpen|fanOutToContact|planContactFanout|Tarragon: please call|isClinicianPageRow|smsPurpose/);
    }
  });
});
