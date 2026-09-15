import { describe as describeNotification } from "./notification-bell";
import type { InAppNotification } from "@/lib/queries/notifications";
import type { Json } from "@tarragon/shared";

/**
 * Guards the escalation-notification rendering fixed on 2026-09-05.
 *
 * Two separate defects, both of which made the abnormal-screening-result
 * pipeline's backstops unreadable or unreachable:
 *
 * 1. The three `clinician_alert_ack_timeout_*` templates had no case, so they
 *    hit the generic fallback and rendered to a doctor as "You have an
 *    update" linking to /patient — discarding the fully-resolved
 *    payload.message that names the alert, its severity and how long it has
 *    been open. 33 unread rows of exactly this shape existed live.
 * 2. Four alert-backed templates linked to /clinician/escalations, which
 *    renders EscalationWorklist over `public.escalations`. The pipeline only
 *    ever writes `clinician_alerts`; an escalations row appears only once a
 *    human clicks "escalate". The alerts are worked on /clinician.
 */

function notification(template: string, payload: { [key: string]: Json } = {}): InAppNotification {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    status: "pending",
    template,
    payload,
    created_at: new Date().toISOString(),
    priority: "critical",
    response_options: null,
    responded_at: null,
    response_value: null,
  };
}

const ACK_TIMEOUT_TEMPLATES = [
  "clinician_alert_ack_timeout_backup",
  "clinician_alert_ack_timeout_senior",
  "clinician_alert_ack_timeout_admin",
] as const;

describe("unacknowledged-alert escalation templates", () => {
  const liveMessage =
    'Alert "Priority 1: abnormal screening result" (severity 4) has been open 90 minutes, past its 30-minute acknowledgement target.';

  it.each(ACK_TIMEOUT_TEMPLATES)("renders %s's own message, not the fallback", (template) => {
    const rendered = describeNotification(notification(template, { message: liveMessage }));
    expect(rendered.text).toBe(liveMessage);
    expect(rendered.text).not.toBe("You have an update");
    expect(rendered.href).toBe("/clinician");
  });

  it.each(ACK_TIMEOUT_TEMPLATES)(
    "%s still routes a doctor to the worklist when the payload has no message",
    (template) => {
      const rendered = describeNotification(notification(template));
      expect(rendered.href).toBe("/clinician");
      expect(rendered.text).not.toBe("You have an update");
    }
  );
});

describe("alert-backed notifications point at the queue that actually holds them", () => {
  it("clinician_alert_sla_breach -> /clinician", () => {
    expect(describeNotification(notification("clinician_alert_sla_breach")).href).toBe("/clinician");
  });

  it("critical_notification_escalation_exhausted splits on source_table", () => {
    expect(
      describeNotification(
        notification("critical_notification_escalation_exhausted", {
          source_table: "clinician_alerts",
        })
      ).href
    ).toBe("/clinician");
    // Anything else is an admin-visibility matter, unchanged.
    expect(
      describeNotification(
        notification("critical_notification_escalation_exhausted", {
          source_table: "emergency_events",
        })
      ).href
    ).toBe("/admin");
  });

  it("care_message_safety_flag and clinician_unread_care_message_alert -> /clinician", () => {
    expect(describeNotification(notification("care_message_safety_flag")).href).toBe("/clinician");
    expect(describeNotification(notification("clinician_unread_care_message_alert")).href).toBe(
      "/clinician"
    );
  });

  it("no clinician_alerts-backed template still points at the escalations queue", () => {
    const alertBacked = [
      ...ACK_TIMEOUT_TEMPLATES,
      "clinician_alert_sla_breach",
      "care_message_safety_flag",
      "clinician_unread_care_message_alert",
    ];
    for (const template of alertBacked) {
      expect(`${template}:${describeNotification(notification(template)).href}`).not.toContain(
        "/clinician/escalations"
      );
    }
  });
});

describe("patient abnormal-result follow-up", () => {
  it("renders the in-app fallback the edge function now always writes", () => {
    const rendered = describeNotification(
      notification("abnormal_result_patient_followup", { condition: "diabetes" })
    );
    expect(rendered.text).toBe("Your result needs a follow-up. Your care team will be in touch");
    expect(rendered.href).toBe("/patient/labs");
    // Never the finding itself, only that a follow-up is needed.
    expect(rendered.text.toLowerCase()).not.toContain("diabetes");
  });
});

describe("the generic fallback is still there for anything unmapped", () => {
  it("does not swallow an unknown template", () => {
    const rendered = describeNotification(notification("some_template_added_later"));
    expect(rendered.text).toBe("You have an update");
    expect(rendered.href).toBe("/patient");
  });
});
