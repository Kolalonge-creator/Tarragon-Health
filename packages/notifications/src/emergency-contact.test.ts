/**
 * S85-D3: the one named SMS exception. The text is signed word for word, carries nothing clinical, and the push and email
 * copies for a reachable contact say the same thing and never route through SMS.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn } from "./index.ts";
import { emergencyContactName, emergencyContactText, planContactFanout } from "../../../supabase/functions/_shared/notifications/emergency-contact.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";

const ctx = { notificationId: "n", recipientId: "r" };

describe("emergency-contact text", () => {
  it("is exactly the signed words", () => {
    expect(emergencyContactText("Ada Obi")).toBe("Tarragon: please call Ada Obi now.");
  });
  it("falls back to a neutral word when there is no usable name (including the trigger's own placeholder)", () => {
    expect(emergencyContactText(undefined)).toBe("Tarragon: please call them now.");
    expect(emergencyContactText("   ")).toBe("Tarragon: please call them now.");
    expect(emergencyContactName("someone who lists you as their emergency contact")).toBe("them");
  });
  it("the template renders that text for SMS and push and passes the INV-07 lint", () => {
    const fn = TEMPLATE_MAP.emergency_contact_alert!;
    expect(describeViolations(lintRenderFn((p) => fn(p, ctx)))).toEqual([]);
    const out = fn({ patient_name: "Ada Obi", condition: "hypertension", reading: "182/112", contact_name: "Chidi" }, ctx);
    expect(out.smsText).toBe("Tarragon: please call Ada Obi now.");
    expect(out.email?.text).toBe(out.smsText);
    expect(JSON.stringify(out)).not.toMatch(/hypertension|182|112|Chidi|emergency|hospital/i);
  });
});

describe("planContactFanout", () => {
  const input = { sourceNotificationId: "src-1", organisationId: "org-1", patientName: "Ada Obi", patientId: "pat-1" };
  it("makes push and in-app, plus email when the contact has an address, and never an sms row", () => {
    const rows = planContactFanout({ ...input, contact: { id: "c-1", email: "c@example.com" } });
    expect(rows.map((r) => r.channel).sort()).toEqual(["email", "in_app", "push"]);
    expect(rows.every((r) => r.recipient_id === "c-1" && r.priority === "routine")).toBe(true);
    expect(rows.find((r) => r.channel === "email")?.payload.to_email).toBe("c@example.com");
    expect(rows.every((r) => r.payload.source_notification_id === "src-1")).toBe(true);
  });
  it("omits email when there is no address, and does nothing for no contact or for the patient themselves", () => {
    expect(planContactFanout({ ...input, contact: { id: "c-1", email: null } }).map((r) => r.channel).sort()).toEqual(["in_app", "push"]);
    expect(planContactFanout({ ...input, contact: null })).toEqual([]);
    expect(planContactFanout({ ...input, contact: { id: "pat-1", email: "a@b.c" } })).toEqual([]);
  });
});

import { checkEmergencyContactRow, checkFanoutRowConsent, confirmedPhoneMatches, guardIsOpen } from "../../../supabase/functions/_shared/notifications/emergency-contact.ts";
import { refusedSmsOutcome } from "./index.ts";

describe("send-time gates", () => {
  it("the guard is open only on a clean read of is_on true (an error or a missing row is closed)", () => {
    expect(guardIsOpen(null, { is_on: true })).toBe(true);
    expect(guardIsOpen(null, { is_on: false })).toBe(false);
    expect(guardIsOpen(null, null)).toBe(false);
    expect(guardIsOpen(new Error("boom"), { is_on: true })).toBe(false);
  });
  it("consent and the number on file are re-checked; an unreadable profile refuses", () => {
    const owner = { emergency_contact_consent: true, emergency_contact_phone: "+2348011111111" };
    expect(checkEmergencyContactRow(owner, "+2348011111111")).toBe("ok");
    expect(checkEmergencyContactRow({ ...owner, emergency_contact_consent: false }, "+2348011111111")).not.toBe("ok");
    expect(checkEmergencyContactRow({ ...owner, emergency_contact_consent: null }, "+2348011111111")).not.toBe("ok");
    expect(checkEmergencyContactRow(owner, "+2348022222222")).not.toBe("ok");
    expect(checkEmergencyContactRow(owner, null)).not.toBe("ok");
    expect(checkEmergencyContactRow(null, "+2348011111111")).not.toBe("ok");
  });
  it("the copies for the contact stop if consent was withdrawn", () => {
    expect(checkFanoutRowConsent({ emergency_contact_consent: true })).toBe("ok");
    expect(checkFanoutRowConsent({ emergency_contact_consent: false })).toBe("consent_withdrawn");
    expect(checkFanoutRowConsent(null)).toBe("consent_withdrawn");
  });
  it("only a confirmed phone matches a contact to an account", () => {
    expect(confirmedPhoneMatches({ phone: "2348011111111", phone_confirmed_at: "2026-10-01T00:00:00Z" }, "+2348011111111")).toBe(true);
    expect(confirmedPhoneMatches({ phone: "+2348011111111", phone_confirmed_at: null }, "+2348011111111")).toBe(false);
    expect(confirmedPhoneMatches({ phone: "2348022222222", phone_confirmed_at: "2026-10-01T00:00:00Z" }, "+2348011111111")).toBe(false);
    expect(confirmedPhoneMatches(null, "+2348011111111")).toBe(false);
  });
  it("a refused critical row fails (so the ladder alarms), a refused routine row is suppressed", () => {
    expect(refusedSmsOutcome("critical")).toBe("fail");
    expect(refusedSmsOutcome("routine")).toBe("suppress");
  });
  it("fan-out copies carry the patient id so consent can be re-checked at their own send time", () => {
    const rows = planContactFanout({ sourceNotificationId: "s", organisationId: null, patientName: "Ada", patientId: "p1", contact: { id: "c1", email: null } });
    expect(rows.every((r) => r.payload.patient_id === "p1")).toBe(true);
  });
});
