import { describe, expect, it } from "@jest/globals";
import { emergencyHospitalGuidance } from "./emergency-guidance";

/**
 * The emergency dialog asserted, on every plan, that "your care team has also
 * been notified and will follow up". On the free tier no clinician_alerts row
 * is created and nobody is paged, so that sentence was false for the majority
 * of accounts, in the one place on the platform where being wrong costs the
 * most. These lock the two halves of the fix: the claim is made only when the
 * event actually carries an alert, and the hospital instruction survives in
 * both branches.
 */

describe("emergencyHospitalGuidance", () => {
  it("claims the care team was told only when an alert was actually raised", () => {
    expect(emergencyHospitalGuidance("2e3a6b7c-0000-4000-8000-000000000000")).toContain(
      "care team has been told"
    );
  });

  it.each([null, undefined])("makes no care-team claim when clinician_alert_id is %p", (id) => {
    const line = emergencyHospitalGuidance(id);
    expect(line).not.toMatch(/care team/i);
    expect(line).not.toMatch(/notified|been told|follow up/i);
  });

  it("always sends the patient to a hospital now, on either branch", () => {
    for (const id of ["alert-id", null]) {
      const line = emergencyHospitalGuidance(id);
      expect(line).toContain("nearest hospital");
      // Never soften the instruction into "wait and see" on either branch.
      expect(line).not.toMatch(/wait for us|we will call/i);
    }
  });

  it("uses no em dashes (standing copy rule for patient-facing text)", () => {
    for (const id of ["alert-id", null]) {
      expect(emergencyHospitalGuidance(id)).not.toContain("—");
    }
  });
});
