import { fhirImportRequestSchema } from "./bundle-schema";

function validBundle(entryCount = 1) {
  return {
    resourceType: "Bundle" as const,
    type: "collection",
    entry: Array.from({ length: entryCount }, (_, i) => ({
      resource: { resourceType: "Observation", id: `obs-${i}` },
    })),
  };
}

describe("fhirImportRequestSchema", () => {
  it("accepts a well-formed envelope", () => {
    const result = fhirImportRequestSchema.safeParse({
      patient_number: "TH-000123",
      bundle: validBundle(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a patient_number that doesn't match the TH-###### shape", () => {
    const result = fhirImportRequestSchema.safeParse({ patient_number: "12345", bundle: validBundle() });
    expect(result.success).toBe(false);
  });

  it("rejects a bundle with no entries", () => {
    const result = fhirImportRequestSchema.safeParse({
      patient_number: "TH-000123",
      bundle: { resourceType: "Bundle", type: "collection", entry: [] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a bundle over the entry cap so a huge Bundle can't dump an unreviewable backlog", () => {
    const result = fhirImportRequestSchema.safeParse({
      patient_number: "TH-000123",
      bundle: validBundle(201),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a resourceType other than 'Bundle'", () => {
    const result = fhirImportRequestSchema.safeParse({
      patient_number: "TH-000123",
      bundle: { resourceType: "Observation", type: "collection", entry: [{ resource: { resourceType: "Observation" } }] },
    });
    expect(result.success).toBe(false);
  });

  it("passes through unknown fields on a resource rather than stripping them", () => {
    const result = fhirImportRequestSchema.safeParse({
      patient_number: "TH-000123",
      bundle: {
        resourceType: "Bundle",
        type: "collection",
        entry: [{ resource: { resourceType: "Observation", effectiveDateTime: "2026-01-01", valueQuantity: { value: 70 } } }],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const resource = result.data.bundle.entry[0].resource as Record<string, unknown>;
      expect(resource.effectiveDateTime).toBe("2026-01-01");
    }
  });
});
