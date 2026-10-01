import { describe, expect, it } from "@jest/globals";
import {
  CHART_SECTIONS,
  CHART_SECTION_CATEGORY,
  PRESCRIPTION_STATES,
  canTransitionPrescription,
  isValidAuditReason,
  observationTypeFromVitalType,
  prescriptionStateRequiresSignature,
  vitalTypeFromObservationType,
} from "./health-record";

describe("prescription states (INV-02)", () => {
  it("only moves forward and cancelled/dispensed are terminal", () => {
    expect(canTransitionPrescription("draft", "signed")).toBe(true);
    expect(canTransitionPrescription("signed", "sent")).toBe(true);
    expect(canTransitionPrescription("sent", "dispensed")).toBe(true);
    expect(canTransitionPrescription("draft", "sent")).toBe(false);
    expect(canTransitionPrescription("signed", "draft")).toBe(false);
    expect(canTransitionPrescription("cancelled", "draft")).toBe(false);
    expect(canTransitionPrescription("dispensed", "cancelled")).toBe(false);
  });

  it("requires a signature everywhere except draft and cancelled", () => {
    const needing = PRESCRIPTION_STATES.filter(prescriptionStateRequiresSignature);
    expect(needing).toEqual(["signed", "sent", "dispensed"]);
  });
});

describe("observation types", () => {
  it("maps the live vital types to the v5 names and back", () => {
    expect(observationTypeFromVitalType("blood_pressure")).toBe("bp");
    expect(observationTypeFromVitalType("glucose")).toBe("glucose");
    const known = ["blood_pressure", "glucose", "waist_circumference"];
    expect(vitalTypeFromObservationType("bp", known)).toBe("blood_pressure");
    expect(vitalTypeFromObservationType("waist", known)).toBe("waist_circumference");
    expect(vitalTypeFromObservationType("hba1c", known)).toBeNull();
  });
});

describe("chart sections", () => {
  it("gives every section a care-access category and never reaches reproductive_health", () => {
    for (const s of CHART_SECTIONS) {
      expect(CHART_SECTION_CATEGORY[s]).toBeTruthy();
      expect(CHART_SECTION_CATEGORY[s]).not.toBe("reproductive_health");
    }
  });
});

describe("audit reason", () => {
  it("needs 10 non-space characters", () => {
    expect(isValidAuditReason("short")).toBe(false);
    expect(isValidAuditReason("          ")).toBe(false);
    expect(isValidAuditReason("Reviewing a red BP alert")).toBe(true);
    expect(isValidAuditReason(null)).toBe(false);
  });
});
