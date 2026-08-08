import {
  parseObservationResource,
  parseAllergyIntoleranceResource,
  parseMedicationStatementResource,
  parseImmunizationResource,
} from "./parsers";

describe("parseObservationResource", () => {
  it("parses a blood-pressure panel from its systolic/diastolic components", () => {
    const { normalized, warnings } = parseObservationResource({
      resourceType: "Observation",
      effectiveDateTime: "2026-01-01T08:00:00Z",
      code: { coding: [{ system: "http://loinc.org", code: "85354-9" }] },
      component: [
        { code: { coding: [{ system: "http://loinc.org", code: "8480-6" }] }, valueQuantity: { value: 130 } },
        { code: { coding: [{ system: "http://loinc.org", code: "8462-4" }] }, valueQuantity: { value: 85 } },
      ],
    });
    expect(warnings).toEqual([]);
    expect(normalized).toEqual({ vital_type: "blood_pressure", taken_at: "2026-01-01T08:00:00Z", systolic: 130, diastolic: 85 });
  });

  it("parses a simple vital by LOINC code", () => {
    const { normalized } = parseObservationResource({
      resourceType: "Observation",
      effectiveDateTime: "2026-01-01T08:00:00Z",
      code: { coding: [{ system: "http://loinc.org", code: "29463-7" }] },
      valueQuantity: { value: 70.2 },
    });
    expect(normalized).toEqual({ vital_type: "weight", taken_at: "2026-01-01T08:00:00Z", weight_kg: 70.2 });
  });

  it("skips with a warning rather than guessing when the code is unrecognised", () => {
    const { normalized, warnings } = parseObservationResource({
      resourceType: "Observation",
      effectiveDateTime: "2026-01-01T08:00:00Z",
      code: { coding: [{ system: "http://loinc.org", code: "99999-9" }] },
      valueQuantity: { value: 1 },
    });
    expect(normalized).toBeNull();
    expect(warnings[0]).toMatch(/does not match a vital type/);
  });

  it("skips with a warning when there is no effectiveDateTime", () => {
    const { normalized, warnings } = parseObservationResource({ resourceType: "Observation" });
    expect(normalized).toBeNull();
    expect(warnings[0]).toMatch(/effectiveDateTime/);
  });
});

describe("parseAllergyIntoleranceResource", () => {
  it("maps criticality high/low to severe/mild", () => {
    expect(
      parseAllergyIntoleranceResource({ resourceType: "AllergyIntolerance", code: { text: "Penicillin" }, criticality: "high" })
        .normalized?.severity
    ).toBe("severe");
    expect(
      parseAllergyIntoleranceResource({ resourceType: "AllergyIntolerance", code: { text: "Penicillin" }, criticality: "low" })
        .normalized?.severity
    ).toBe("mild");
  });

  it("leaves severity blank with a warning for an unrecognised criticality rather than guessing", () => {
    const { normalized, warnings } = parseAllergyIntoleranceResource({
      resourceType: "AllergyIntolerance",
      code: { text: "Penicillin" },
      criticality: "sort-of-bad",
    });
    expect(normalized?.severity).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it("skips with a warning when there is no allergen text or display", () => {
    const { normalized, warnings } = parseAllergyIntoleranceResource({ resourceType: "AllergyIntolerance" });
    expect(normalized).toBeNull();
    expect(warnings[0]).toMatch(/allergen/);
  });
});

describe("parseMedicationStatementResource", () => {
  it("parses a MedicationStatement's `dosage` field", () => {
    const { normalized } = parseMedicationStatementResource({
      resourceType: "MedicationStatement",
      status: "active",
      medicationCodeableConcept: { text: "Metformin" },
      dosage: [{ text: "500mg twice daily" }],
    });
    expect(normalized).toEqual({ drug_name: "Metformin", dose: "500mg twice daily", frequency: null, is_active: true });
  });

  it("parses a MedicationRequest's `dosageInstruction` field the same way", () => {
    const { normalized } = parseMedicationStatementResource({
      resourceType: "MedicationRequest",
      status: "active",
      medicationCodeableConcept: { text: "Metformin" },
      dosageInstruction: [{ text: "500mg twice daily" }],
    });
    expect(normalized?.dose).toBe("500mg twice daily");
  });

  it("maps a completed/stopped status to is_active: false", () => {
    const { normalized } = parseMedicationStatementResource({
      resourceType: "MedicationStatement",
      status: "stopped",
      medicationCodeableConcept: { text: "Metformin" },
    });
    expect(normalized?.is_active).toBe(false);
  });

  it("skips a medicationReference-only resource (no medicationCodeableConcept) rather than guessing a drug name", () => {
    const { normalized, warnings } = parseMedicationStatementResource({ resourceType: "MedicationStatement" });
    expect(normalized).toBeNull();
    expect(warnings[0]).toMatch(/medicationReference/);
  });
});

describe("parseImmunizationResource", () => {
  const catalog = [{ id: "cat-1", name: "Yellow Fever" }];

  it("matches the vaccine by text against the catalogue", () => {
    const { normalized, warnings } = parseImmunizationResource(
      { resourceType: "Immunization", occurrenceDateTime: "2026-01-01", vaccineCode: { text: "Yellow Fever" } },
      catalog
    );
    expect(normalized?.vaccination_catalog_id).toBe("cat-1");
    expect(warnings).toEqual([]);
  });

  it("leaves vaccination_catalog_id null with a warning when nothing matches, rather than guessing", () => {
    const { normalized, warnings } = parseImmunizationResource(
      { resourceType: "Immunization", occurrenceDateTime: "2026-01-01", vaccineCode: { text: "Some Unknown Shot" } },
      catalog
    );
    expect(normalized?.vaccination_catalog_id).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it("skips with a warning when there is no occurrenceDateTime", () => {
    const { normalized, warnings } = parseImmunizationResource({ resourceType: "Immunization" }, catalog);
    expect(normalized).toBeNull();
    expect(warnings[0]).toMatch(/occurrenceDateTime/);
  });
});
