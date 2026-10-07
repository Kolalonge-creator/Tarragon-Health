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
