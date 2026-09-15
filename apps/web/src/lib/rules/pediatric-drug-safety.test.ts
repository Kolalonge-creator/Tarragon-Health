import { describe, expect, it } from "@jest/globals";
import { assessPediatricDosing, findPediatricFormularyEntry } from "./pediatric-drug-safety";

describe("findPediatricFormularyEntry", () => {
  it("matches known drugs case-insensitively", () => {
    expect(findPediatricFormularyEntry("Paracetamol")?.drugName).toBe("Paracetamol (acetaminophen)");
    expect(findPediatricFormularyEntry("ibuprofen")?.drugName).toBe("Ibuprofen");
    expect(findPediatricFormularyEntry("Amoxicillin 250mg")?.drugName).toBe("Amoxicillin");
  });

  it("returns null for a drug not in the small starter formulary", () => {
    expect(findPediatricFormularyEntry("Metformin")).toBeNull();
  });
});

describe("assessPediatricDosing", () => {
  it("returns nothing for a drug outside the formulary", () => {
    expect(
      assessPediatricDosing({
        drugName: "Metformin",
        doseMgPerAdministration: 500,
        dosesPerDay: 2,
        weightKg: 20,
        ageMonths: 96,
      })
    ).toEqual([]);
  });

  it("flags a contraindicated finding when weight is missing", () => {
    const findings = assessPediatricDosing({
      drugName: "Paracetamol",
      doseMgPerAdministration: 120,
      dosesPerDay: 3,
      weightKg: null,
      ageMonths: 24,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("caution");
    expect(findings[0].title).toMatch(/weight required/i);
  });

  it("passes a dose within the usual range with no findings", () => {
    // 10kg child, 100mg per dose = 10 mg/kg, within 10-15 mg/kg; 3x/day = 30 mg/kg/day, under 60 max.
    const findings = assessPediatricDosing({
      drugName: "Paracetamol",
      doseMgPerAdministration: 100,
      dosesPerDay: 3,
      weightKg: 10,
      ageMonths: 24,
    });
    expect(findings).toEqual([]);
  });

  it("flags a dose above the usual mg/kg range", () => {
    // 10kg child, 250mg per dose = 25 mg/kg, above the 10-15 mg/kg range.
    const findings = assessPediatricDosing({
      drugName: "Paracetamol",
      doseMgPerAdministration: 250,
      dosesPerDay: 1,
      weightKg: 10,
      ageMonths: 24,
    });
    expect(findings.some((f) => f.severity === "contraindicated" && /exceeds the usual/i.test(f.title))).toBe(
      true
    );
  });

  it("flags a daily total above the usual mg/kg/day maximum", () => {
    // 10kg child, 100mg per dose (10 mg/kg, in range) x 8 doses/day = 80 mg/kg/day, above the 60 max.
    const findings = assessPediatricDosing({
      drugName: "Paracetamol",
      doseMgPerAdministration: 100,
      dosesPerDay: 8,
      weightKg: 10,
      ageMonths: 24,
    });
    expect(findings.some((f) => /daily total exceeds/i.test(f.title))).toBe(true);
  });

  it("flags ibuprofen as contraindicated under the minimum age", () => {
    const findings = assessPediatricDosing({
      drugName: "Ibuprofen",
      doseMgPerAdministration: null,
      dosesPerDay: null,
      weightKg: 6,
      ageMonths: 2,
    });
    expect(findings.some((f) => f.severity === "contraindicated" && /age/i.test(f.title))).toBe(true);
  });

  it("flags ibuprofen as contraindicated under the minimum weight", () => {
    const findings = assessPediatricDosing({
      drugName: "Ibuprofen",
      doseMgPerAdministration: null,
      dosesPerDay: null,
      weightKg: 4,
      ageMonths: 6,
    });
    expect(findings.some((f) => f.severity === "contraindicated" && /weight/i.test(f.title))).toBe(true);
  });

  it("includes the medicationId on every finding when supplied", () => {
    const findings = assessPediatricDosing({
      medicationId: "med-123",
      drugName: "Paracetamol",
      doseMgPerAdministration: 250,
      dosesPerDay: 1,
      weightKg: 10,
      ageMonths: 24,
    });
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.medicationIds).toEqual(["med-123"]);
    }
  });
});
