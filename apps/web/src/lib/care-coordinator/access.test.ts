import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canCoordinate, greetingFirstName, isCoveringDoctor } from "./access";

const staff = (doctor_tier: string, employment_type: string, active = true) => ({ doctor_tier, employment_type, active });

describe("canCoordinate (CC-1, mirrors private.is_coordination_actor)", () => {
  it("admits a coordinator, an employed SMO and the CMO however employed", () => {
    expect(canCoordinate("care_coordinator", null)).toBe(true);
    expect(canCoordinate("clinician", staff("senior_medical_officer", "employed"))).toBe(true);
    expect(canCoordinate("clinician", staff("chief_medical_officer", "contracted"))).toBe(true);
  });

  it("refuses a contracted partner specialist, an inactive doctor, a doctor with no staff row and a patient", () => {
    expect(canCoordinate("clinician", staff("senior_medical_officer", "contracted"))).toBe(false);
    expect(canCoordinate("clinician", staff("senior_medical_officer", "employed", false))).toBe(false);
    expect(canCoordinate("clinician", { ...staff("senior_medical_officer", "employed"), status: "suspended" })).toBe(false);
    expect(canCoordinate("clinician", null)).toBe(false);
    expect(canCoordinate("patient", staff("chief_medical_officer", "employed"))).toBe(false);
  });

  it("greets by first name, skipping a title", () => {
    expect(greetingFirstName("Dr Amaka Obi")).toBe("Amaka");
    expect(greetingFirstName("Prof. Tunde Bakare")).toBe("Tunde");
    expect(greetingFirstName("Ngozi Okafor")).toBe("Ngozi");
    expect(greetingFirstName("Dr")).toBeNull();
    expect(greetingFirstName(null)).toBeNull();
  });

  it("calls a doctor in the workspace a covering doctor", () => {
    expect(isCoveringDoctor("clinician")).toBe(true);
    expect(isCoveringDoctor("care_coordinator")).toBe(false);
  });

  it("matches the database rule word for word on who qualifies", () => {
    // The SQL is the real gate; if it changes who qualifies, this app copy must change with it.
    const dir = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations");
    const sql = readFileSync(join(dir, "20261107020049_cc1_coordination_shared_workspace.sql"), "utf8");
    expect(sql).toContain("cs.doctor_tier = 'chief_medical_officer'");
    expect(sql).toContain("(cs.doctor_tier = 'senior_medical_officer' and cs.employment_type = 'employed')");
  });
});
