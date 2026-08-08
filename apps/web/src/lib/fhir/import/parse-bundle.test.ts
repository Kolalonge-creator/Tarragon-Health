import { parseFhirImportBundle } from "./parse-bundle";
import { fhirBundleSchema } from "./bundle-schema";

const catalog = [{ id: "cat-1", name: "Yellow Fever" }];

function bundle(entries: unknown[]) {
  return fhirBundleSchema.parse({ resourceType: "Bundle", type: "collection", entry: entries.map((resource) => ({ resource })) });
}

describe("parseFhirImportBundle", () => {
  it("tallies a mix of parseable, skip-worthy, and out-of-scope entries correctly", () => {
    const result = parseFhirImportBundle(
      bundle([
        {
          resourceType: "Observation",
          id: "obs-1",
          effectiveDateTime: "2026-01-01T00:00:00Z",
          code: { coding: [{ system: "http://loinc.org", code: "29463-7" }] },
          valueQuantity: { value: 68 },
        },
        { resourceType: "Observation", id: "obs-2" }, // no effectiveDateTime -- parse failure
        { resourceType: "Condition", id: "cond-1" }, // out of v1 import scope entirely
        {
          resourceType: "Immunization",
          id: "imm-1",
          occurrenceDateTime: "2026-01-01",
          vaccineCode: { text: "Yellow Fever" },
        },
      ]),
      catalog
    );

    expect(result.proposals).toHaveLength(2);
    expect(result.proposals.map((p) => p.resource_type).sort()).toEqual(["Immunization", "Observation"]);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.find((s) => s.resourceType === "Condition")?.reason).toMatch(/not in the v1 import allow-list/);
    expect(result.skipped.find((s) => s.resourceId === "obs-2")).toBeTruthy();
  });

  it("preserves the raw resource verbatim on every proposal for audit/round-trip", () => {
    const rawObservation = {
      resourceType: "Observation",
      id: "obs-1",
      effectiveDateTime: "2026-01-01T00:00:00Z",
      code: { coding: [{ system: "http://loinc.org", code: "29463-7" }] },
      valueQuantity: { value: 68 },
      extension: [{ url: "http://example.com/some-partner-extension", valueString: "kept" }],
    };
    const [proposal] = parseFhirImportBundle(bundle([rawObservation]), catalog).proposals;
    expect(proposal.raw_resource).toEqual(rawObservation);
  });

  it("carries fhir_resource_id through from the resource's own id", () => {
    const [proposal] = parseFhirImportBundle(
      bundle([
        {
          resourceType: "AllergyIntolerance",
          id: "allergy-42",
          code: { text: "Penicillin" },
        },
      ]),
      catalog
    ).proposals;
    expect(proposal.fhir_resource_id).toBe("allergy-42");
  });
});
