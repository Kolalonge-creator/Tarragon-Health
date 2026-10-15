import { describe, expect, it } from "@jest/globals";
import { emergencyHospitalGuidance, freeRedNoDoctorSentence } from "./emergency-guidance";

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

describe("freeRedNoDoctorSentence (two-tier Free red path, CMO 2026-10-08)", () => {
  it("says in plain words that no doctor was alerted because the patient is on the Free plan", () => {
    expect(freeRedNoDoctorSentence(null)).toBe(
      "A doctor has not been alerted, because you are on the Free plan. Doctor review is part of Membership."
    );
    expect(freeRedNoDoctorSentence(undefined)).toContain("Free plan");
  });

  it("is absent when a clinician alert was raised, so the dialog never says both", () => {
    expect(freeRedNoDoctorSentence("2e3a6b7c-0000-4000-8000-000000000000")).toBeNull();
  });

  it("has no fear wording and no em dash", () => {
    const line = freeRedNoDoctorSentence(null) ?? "";
    expect(line).not.toMatch(/warning|danger|die/i);
    expect(line).not.toContain("—");
  });
});
