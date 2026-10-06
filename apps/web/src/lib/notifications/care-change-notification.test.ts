import { describe as describeInApp } from "./describe-in-app";

describe("care change notifications (in-app bell)", () => {
  it("the patient notice is neutral and opens the Medicines area", () => {
    expect(describeInApp({ template: "care_change_ready_patient", payload: { care_plan_change_id: "x", drug_name: "secret-drug" } })).toEqual({
      text: "Your care team has a change for you",
      href: "/patient/medications",
    });
  });
  it("the staff notices are mapped, not the generic fallback, and name nothing about the patient", () => {
    const generic = describeInApp({ template: "zzz_unknown", payload: {} }).text;
    for (const template of ["care_change_declined_staff", "care_change_expired_staff"]) {
      const out = describeInApp({ template, payload: { care_plan_change_id: "x", patient_name: "Ada" } });
      expect(out.text).not.toBe(generic);
      expect(out.text).not.toMatch(/Ada/);
      expect(out.href).toBe("/clinician/patients");
    }
  });
});
