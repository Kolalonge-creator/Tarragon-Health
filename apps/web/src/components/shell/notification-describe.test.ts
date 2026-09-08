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

/**
 * These 21 in_app templates were found live (inserted by real migrations)
 * with zero case anywhere — every one fell through to "You have an update",
 * discarding a pre-resolved payload.message on several of them. Same failure
 * class as the ack-timeout gap above; one test per template so a future
 * refactor can't silently drop one back into the fallback.
 */
describe("previously-unmapped live templates render their own copy, not the fallback", () => {
  const NOT_FALLBACK = "You have an update";

  it("security.new_device_signin uses the pre-resolved message", () => {
    const rendered = describeNotification(
      notification("security.new_device_signin", { message: "New sign-in from a device we haven't seen." })
    );
    expect(rendered.text).toBe("New sign-in from a device we haven't seen.");
    expect(rendered.href).toBe("/patient/privacy");
  });

  it.each(["vitals_monitoring_due", "vitals_monitoring_overdue", "vitals_monitoring_escalated"])(
    "%s names the vital type and links to /patient/vitals",
    (template) => {
      const rendered = describeNotification(notification(template, { vital_type: "blood_pressure" }));
      expect(rendered.text).toContain("blood pressure");
      expect(rendered.text).not.toBe(NOT_FALLBACK);
      expect(rendered.href).toBe("/patient/vitals");
    }
  );

  it("ai_safety_incident_raised names the system and links to AI governance", () => {
    const rendered = describeNotification(notification("ai_safety_incident_raised", { ai_system: "AI Coach" }));
    expect(rendered.text).toContain("AI Coach");
    expect(rendered.href).toBe("/admin/settings/ai-governance");
  });

  it("ai_system_disabled names the system and links to AI governance", () => {
    const rendered = describeNotification(notification("ai_system_disabled", { ai_system: "AI Coach" }));
    expect(rendered.text).toContain("AI Coach");
    expect(rendered.href).toBe("/admin/settings/ai-governance");
  });

  it("consultation_summary_ready links to the timeline", () => {
    const rendered = describeNotification(notification("consultation_summary_ready"));
    expect(rendered.text).not.toBe(NOT_FALLBACK);
    expect(rendered.href).toBe("/patient/timeline");
  });

  it.each(["engagement_reminder_personalized", "engagement_support_offer"])(
    "%s is not the fallback",
    (template) => {
      expect(describeNotification(notification(template)).text).not.toBe(NOT_FALLBACK);
    }
  );

  it("lab_sample_rejected includes the rejection reason", () => {
    const rendered = describeNotification(
      notification("lab_sample_rejected", { test_name: "FBC", reason: "haemolysed" })
    );
    expect(rendered.text).toContain("haemolysed");
    expect(rendered.href).toBe("/patient/labs");
  });

  it("medication_dose_reminder names the drug", () => {
    const rendered = describeNotification(notification("medication_dose_reminder", { drug_name: "Metformin" }));
    expect(rendered.text).toContain("Metformin");
    expect(rendered.href).toBe("/patient/medications");
  });

  it("medication_lab_monitoring_due names the check and the drug", () => {
    const rendered = describeNotification(
      notification("medication_lab_monitoring_due", { monitoring_label: "U&E", drug_name: "Lisinopril" })
    );
    expect(rendered.text).toContain("U&E");
    expect(rendered.text).toContain("Lisinopril");
  });

  it("navigation_request_resolved is not the fallback", () => {
    expect(describeNotification(notification("navigation_request_resolved")).text).not.toBe(NOT_FALLBACK);
  });

  it("provider_credential_ladder uses the pre-resolved message and links to /admin", () => {
    const rendered = describeNotification(
      notification("provider_credential_ladder", { message: "Dr. X's licence has expired." })
    );
    expect(rendered.text).toBe("Dr. X's licence has expired.");
    expect(rendered.href).toBe("/admin");
  });

  it("provider_credential_ladder_self links to the clinician's own performance page", () => {
    expect(describeNotification(notification("provider_credential_ladder_self")).href).toBe(
      "/clinician/my-performance"
    );
  });

  it("provider_intervention_opened links to the clinician's own performance page", () => {
    expect(describeNotification(notification("provider_intervention_opened")).href).toBe(
      "/clinician/my-performance"
    );
  });

  it.each(["adolescent_shared_access_nudge_13", "adolescent_independence_downgrade_18"])(
    "%s names the child and links to Your people",
    (template) => {
      const rendered = describeNotification(notification(template, { child_name: "Ada" }));
      expect(rendered.text).toContain("Ada");
      expect(rendered.href).toBe("/patient/family");
    }
  );

  it("appointment_reminder_for_dependent is not the fallback", () => {
    const rendered = describeNotification(notification("appointment_reminder_for_dependent"));
    expect(rendered.text).not.toBe(NOT_FALLBACK);
    expect(rendered.href).toBe("/patient/family");
  });

  it("dependent_majority_review uses the pre-resolved message", () => {
    const rendered = describeNotification(
      notification("dependent_majority_review", { message: "Ada just turned 18." })
    );
    expect(rendered.text).toBe("Ada just turned 18.");
    expect(rendered.href).toBe("/patient/family");
  });

  it("caregiver_review_overdue is not the fallback", () => {
    expect(describeNotification(notification("caregiver_review_overdue")).href).toBe("/patient/family");
  });

  it("emergency_access_review_due uses the pre-resolved message and links to the review queue", () => {
    const rendered = describeNotification(
      notification("emergency_access_review_due", { message: "A grant needs review." })
    );
    expect(rendered.text).toBe("A grant needs review.");
    expect(rendered.href).toBe("/clinician/emergency-access-review");
  });
});
