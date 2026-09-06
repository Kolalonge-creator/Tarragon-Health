import { describe, expect, it } from "@jest/globals";
import { classifyPaediatricSymptom, shouldOfferPaediatricSymptomTypes } from "./pediatric-symptom-triage";

describe("classifyPaediatricSymptom", () => {
  it("escalates severity >= 8 for anyone, any age", () => {
    expect(classifyPaediatricSymptom({ symptomType: "pain", severity: 8, ageYears: 30 })).toBe("emergency");
    expect(classifyPaediatricSymptom({ symptomType: "pain", severity: 8, ageYears: null })).toBe("emergency");
  });

  it("keeps the adult low-threshold bucket unchanged", () => {
    expect(classifyPaediatricSymptom({ symptomType: "breathlessness", severity: 6, ageYears: 40 })).toBe(
      "emergency"
    );
    expect(classifyPaediatricSymptom({ symptomType: "breathlessness", severity: 5, ageYears: 40 })).toBe(
      "clinician_review"
    );
  });

  it("escalates a paediatric danger sign at severity 4 for a child under 5", () => {
    expect(classifyPaediatricSymptom({ symptomType: "lethargy", severity: 4, ageYears: 2 })).toBe("emergency");
    expect(classifyPaediatricSymptom({ symptomType: "poor_feeding", severity: 4, ageYears: 4.9 })).toBe(
      "emergency"
    );
  });

  it("does NOT apply the paediatric threshold at 5 or over", () => {
    expect(classifyPaediatricSymptom({ symptomType: "lethargy", severity: 4, ageYears: 5 })).toBe("none");
  });

  it("does NOT apply the paediatric threshold when age is unknown", () => {
    expect(classifyPaediatricSymptom({ symptomType: "lethargy", severity: 4, ageYears: null })).toBe("none");
  });

  it("falls through to the general severity >= 5 review tier", () => {
    expect(classifyPaediatricSymptom({ symptomType: "fatigue", severity: 5, ageYears: 3 })).toBe(
      "clinician_review"
    );
  });

  it("raises nothing below every threshold", () => {
    expect(classifyPaediatricSymptom({ symptomType: "fatigue", severity: 2, ageYears: 3 })).toBe("none");
    expect(classifyPaediatricSymptom({ symptomType: "lethargy", severity: 3, ageYears: 2 })).toBe("none");
  });
});

describe("shouldOfferPaediatricSymptomTypes", () => {
  it("offers them only under 5 with a known age", () => {
    expect(shouldOfferPaediatricSymptomTypes(4.9)).toBe(true);
    expect(shouldOfferPaediatricSymptomTypes(5)).toBe(false);
    expect(shouldOfferPaediatricSymptomTypes(null)).toBe(false);
  });
});
