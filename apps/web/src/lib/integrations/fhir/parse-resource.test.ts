import { describe, expect, it } from "@jest/globals";
import { parseFhirResourceEntry, isSupportedResourceType } from "./parse-resource";
import type { FhirResource } from "./bundle-schema";

/**
 * Pure-parser coverage for the FHIR import pipeline's Phase 1 route
 * (docs/DATA_ARCHITECTURE_GAPS_BUILD_PLAN.md §1). Immunization is excluded
 * here — it is the one resource type that needs a live vaccination_catalog
 * lookup, so it is exercised against the real DB by
 * packages/db/tests instead (same split this codebase already uses
 * elsewhere between pure-function unit tests and DB-backed proof scripts).
 */

// Not used by any of the resource types covered here — parseFhirResourceEntry
// only touches its `supabase` argument on the Immunization branch.
const unusedSupabase = {} as Parameters<typeof parseFhirResourceEntry>[1];

describe("isSupportedResourceType", () => {
  it("accepts exactly the 5 v1 import resource types", () => {
    expect(isSupportedResourceType("Observation")).toBe(true);
    expect(isSupportedResourceType("AllergyIntolerance")).toBe(true);
    expect(isSupportedResourceType("MedicationStatement")).toBe(true);
    expect(isSupportedResourceType("MedicationRequest")).toBe(true);
    expect(isSupportedResourceType("Immunization")).toBe(true);
  });

  it("rejects anything outside the allow-list", () => {
    expect(isSupportedResourceType("Patient")).toBe(false);
    expect(isSupportedResourceType("Condition")).toBe(false);
    expect(isSupportedResourceType("DiagnosticReport")).toBe(false);
  });
});

describe("parseFhirResourceEntry — Observation", () => {
  it("maps a blood-pressure panel (systolic/diastolic components) correctly", async () => {
    const resource: FhirResource = {
      resourceType: "Observation",
      id: "obs-1",
      effectiveDateTime: "2026-09-01T10:00:00Z",
      code: { coding: [{ code: "85354-9" }] },
      component: [
        { code: { coding: [{ code: "8480-6" }] }, valueQuantity: { value: 128 } },
        { code: { coding: [{ code: "8462-4" }] }, valueQuantity: { value: 82 } },
      ],
    };
    const result = await parseFhirResourceEntry(resource, unusedSupabase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.resourceType).toBe("Observation");
    expect(result.proposal.normalizedPayload).toMatchObject({
      vital_type: "blood_pressure",
      systolic: 128,
      diastolic: 82,
    });
  });

  it("maps a glucose Observation and flags the defaulted glucose_context", async () => {
    const resource: FhirResource = {
      resourceType: "Observation",
      effectiveDateTime: "2026-09-01T10:00:00Z",
      code: { coding: [{ code: "2339-0" }] },
      valueQuantity: { value: 5.6 },
    };
    const result = await parseFhirResourceEntry(resource, unusedSupabase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.normalizedPayload.glucose_mmol_l).toBe(5.6);
    expect(result.proposal.normalizedPayload.glucose_context).toBe("random");
    expect(result.proposal.parseWarnings.length).toBeGreaterThan(0);
  });

  it("skips (never guesses) an Observation with an unrecognised LOINC code", async () => {
    const resource: FhirResource = {
      resourceType: "Observation",
      effectiveDateTime: "2026-09-01T10:00:00Z",
      code: { coding: [{ code: "99999-9" }] },
      valueQuantity: { value: 1 },
    };
    const result = await parseFhirResourceEntry(resource, unusedSupabase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.skip.reason).toMatch(/Unrecognised LOINC/);
  });

  it("skips an Observation with no effectiveDateTime/issued", async () => {
    const resource: FhirResource = { resourceType: "Observation", code: { coding: [{ code: "8867-4" }] } };
    const result = await parseFhirResourceEntry(resource, unusedSupabase);
    expect(result.ok).toBe(false);
  });
});

describe("parseFhirResourceEntry — AllergyIntolerance", () => {
  it("maps allergen/reaction/severity and preserves a known severity", async () => {
    const resource: FhirResource = {
      resourceType: "AllergyIntolerance",
      code: { text: "Penicillin" },
      reaction: [{ manifestation: [{ text: "Rash" }], severity: "severe" }],
      onsetDateTime: "2020-01-01",
    };
    const result = await parseFhirResourceEntry(resource, unusedSupabase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.normalizedPayload).toMatchObject({
      allergen: "Penicillin",
      reaction: "Rash",
      severity: "severe",
      noted_at: "2020-01-01",
    });
    expect(result.proposal.parseWarnings).toHaveLength(0);
  });

  it("defaults severity to moderate and flags it when the source severity is unrecognised", async () => {
    const resource: FhirResource = { resourceType: "AllergyIntolerance", code: { text: "Latex" } };
    const result = await parseFhirResourceEntry(resource, unusedSupabase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.normalizedPayload.severity).toBe("moderate");
    expect(result.proposal.parseWarnings[0]).toMatch(/severity defaulted/);
  });

  it("skips an AllergyIntolerance with no identifiable allergen", async () => {
    const resource: FhirResource = { resourceType: "AllergyIntolerance" };
    const result = await parseFhirResourceEntry(resource, unusedSupabase);
    expect(result.ok).toBe(false);
  });
});

describe("parseFhirResourceEntry — MedicationStatement / MedicationRequest", () => {
  it("maps drug name and dosage text for a MedicationStatement", async () => {
    const resource: FhirResource = {
      resourceType: "MedicationStatement",
      status: "active",
      medicationCodeableConcept: { text: "Amlodipine 5mg" },
      dosage: [{ text: "Once daily" }],
    };
    const result = await parseFhirResourceEntry(resource, unusedSupabase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.normalizedPayload).toMatchObject({
      drug_name: "Amlodipine 5mg",
      dose: "Once daily",
      is_active: true,
    });
  });

  it("treats a MedicationRequest with status 'stopped' as inactive", async () => {
    const resource: FhirResource = {
      resourceType: "MedicationRequest",
      status: "stopped",
      medicationCodeableConcept: { text: "Metformin" },
    };
    const result = await parseFhirResourceEntry(resource, unusedSupabase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.normalizedPayload.is_active).toBe(false);
  });

  it("skips a medication resource with no identifiable drug", async () => {
    const resource: FhirResource = { resourceType: "MedicationRequest" };
    const result = await parseFhirResourceEntry(resource, unusedSupabase);
    expect(result.ok).toBe(false);
  });
});

describe("parseFhirResourceEntry — unsupported resourceType", () => {
  it("skips a Patient resource with a clear reason instead of erroring", async () => {
    const resource: FhirResource = { resourceType: "Patient" };
    const result = await parseFhirResourceEntry(resource, unusedSupabase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.skip.reason).toMatch(/outside the v1 import allow-list/);
  });
});
