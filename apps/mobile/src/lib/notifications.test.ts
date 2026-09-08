/**
 * Guards the notification-bell copy bug fixed alongside notification-bell.tsx
 * on web: describeNotification()'s old default case leaked the raw `template`
 * string (underscores turned to spaces, everything else left as-is), so an
 * unmapped template like "security.new_device_signin" rendered to a patient
 * as "security.new device signin" instead of a sentence. Reproduced live for
 * "security.new_device_signin", "lab_order_requested_patient",
 * "emergency_followup", "vitals_monitoring_due" and "vitals_monitoring_
 * overdue" — none of these had a case in the old 6-template switch.
 */
import { describeNotification, type InAppNotification } from "./notifications";

function notification(template: string | null, payload: Record<string, unknown> = {}): InAppNotification {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    status: "pending",
    template,
    payload,
    createdAt: new Date().toISOString(),
  };
}

describe("previously-leaking templates now render real copy", () => {
  it("security.new_device_signin uses the pre-resolved message, not the raw key", () => {
    const text = describeNotification(
      notification("security.new_device_signin", { message: "New sign-in from a device we haven't seen." })
    );
    expect(text).toBe("New sign-in from a device we haven't seen.");
    expect(text).not.toContain("security.new");
  });

  it("lab_order_requested_patient names the test, not the raw key", () => {
    const text = describeNotification(notification("lab_order_requested_patient", { test_name: "FBC" }));
    expect(text).toContain("FBC");
    expect(text).not.toContain("lab order");
  });

  it("emergency_followup is a real sentence, not the raw key", () => {
    expect(describeNotification(notification("emergency_followup"))).toBe(
      "Checking in after your recent emergency alert. How are you doing?"
    );
  });

  it.each(["vitals_monitoring_due", "vitals_monitoring_overdue", "vitals_monitoring_escalated"])(
    "%s names the vital type, not the raw key",
    (template) => {
      const text = describeNotification(notification(template, { vital_type: "blood_pressure" }));
      expect(text).toContain("blood pressure");
      expect(text).not.toContain("vitals monitoring");
    }
  );
});

describe("the fallback never leaks a raw template string", () => {
  it("an unmapped template renders a generic line, not a humanised key", () => {
    expect(describeNotification(notification("some_template_added_later"))).toBe(
      "You have a new notification"
    );
  });

  it("a null template renders the generic line", () => {
    expect(describeNotification(notification(null))).toBe("You have a new notification");
  });
});

describe("payload interpolation on a sample of the new mappings", () => {
  it("medication_dose_reminder names the drug", () => {
    expect(describeNotification(notification("medication_dose_reminder", { drug_name: "Metformin" }))).toContain(
      "Metformin"
    );
  });

  it("dependent_majority_review uses the pre-resolved message", () => {
    expect(
      describeNotification(notification("dependent_majority_review", { message: "Ada just turned 18." }))
    ).toBe("Ada just turned 18.");
  });

  it("adolescent_shared_access_nudge_13 names the child", () => {
    expect(
      describeNotification(notification("adolescent_shared_access_nudge_13", { child_name: "Ada" }))
    ).toContain("Ada");
  });
});
