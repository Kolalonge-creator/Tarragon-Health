import { describe, expect, it } from "@jest/globals";
import { parseFhirResourceEntry, isSupportedResourceType } from "./parse-resource";
import type { FhirResource } from "./bundle-schema";

/**
 * Pure-parser coverage for the FHIR import pipeline's Phase 1 route
 * (docs/DATA_ARCHITECTURE_GAPS_BUILD_PLAN.md §1). Immunization is covered
 * with a mocked Supabase client further down (an earlier version of this
 * file claimed it was covered by a `packages/db/tests` proof script instead
 * — that script was never written, a real gap a /code-review high pass
 * caught; this mock closes it rather than leaving the false claim in place).
 */

// Not used by any of the resource types covered here — parseFhirResourceEntry
// only touches its `supabase` argument on the Immunization branch.
const unusedSupabase = {} as Parameters<typeof parseFhirResourceEntry>[1];

/**
 * A minimal stand-in for the PostgREST builder chain parseImmunization
 * actually calls: an exact-match lookup (`.ilike("name", text)` with no
 * wildcard, resolved via `.maybeSingle()`) and, only if that misses, a
 * substring fallback (`.ilike("name", "%text%")`, resolved as an array via
 * `.order().limit()`). Distinguishes the two by whether the last `ilike`
 * pattern contains a `%`, since that's the one thing that differs between
 * the two calls in parseImmunization's own code.
 */
function stubCatalogClient(opts: {
  exactMatch?: { id: string } | null;
  fuzzyMatches?: { id: string; name: string }[];
}): Parameters<typeof parseFhirResourceEntry>[1] {
  let lastPatternWasFuzzy = false;
  const builder: Record<string, unknown> = {
    then: (resolve: (value: { data: unknown; error: null }) => unknown) => {
      const data = lastPatternWasFuzzy ? (opts.fuzzyMatches ?? []) : (opts.exactMatch ?? null);
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  for (const method of ["from", "select", "eq", "order", "limit"]) {
    builder[method] = () => builder;
  }
  builder.ilike = (_col: string, pattern: string) => {
    lastPatternWasFuzzy = pattern.includes("%");
    return builder;
  };
  builder.maybeSingle = () => Promise.resolve({ data: opts.exactMatch ?? null, error: null });
  return builder as unknown as Parameters<typeof parseFhirResourceEntry>[1];
}

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
    // The source instruction isn't split into dose vs frequency — it lands
    // in `dose` only, with `frequency` left for the reviewing clinician
    // (never duplicated into both columns, which is what an earlier
    // version of this parser did).
    expect(result.proposal.normalizedPayload).toMatchObject({
      drug_name: "Amlodipine 5mg",
      dose: "Once daily",
      frequency: null,
      is_active: true,
    });
    expect(result.proposal.parseWarnings[0]).toMatch(/not split into a separate dose and frequency/);
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

describe("parseFhirResourceEntry — Immunization", () => {
  it("matches an exact catalogue name with no warning", async () => {
    const resource: FhirResource = {
      resourceType: "Immunization",
      vaccineCode: { text: "Hepatitis B" },
      occurrenceDateTime: "2026-01-01",
    };
    const supabase = stubCatalogClient({ exactMatch: { id: "catalog-hep-b" } });
    const result = await parseFhirResourceEntry(resource, supabase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.normalizedPayload.vaccination_catalog_id).toBe("catalog-hep-b");
    expect(result.proposal.parseWarnings).toHaveLength(0);
  });

  it("never matches vaccineCode.coding[].code against the catalogue's own internal slug — that field is not a FHIR/CVX code", async () => {
    // A real partner's vaccineCode.coding[].code (e.g. CVX '08') has no
    // relationship to vaccination_catalog.code (an internal slug like
    // 'hepatitis_b') — the parser must not try to .eq() them together, only
    // ever match on name/text. This is a regression test for exactly that
    // bug (/code-review high, 2026-09-18).
    const resource: FhirResource = {
      resourceType: "Immunization",
      vaccineCode: { text: "Hepatitis B", coding: [{ system: "http://hl7.org/fhir/sid/cvx", code: "08" }] },
      occurrenceDateTime: "2026-01-01",
    };
    const supabase = stubCatalogClient({ exactMatch: { id: "catalog-hep-b" } });
    const result = await parseFhirResourceEntry(resource, supabase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.normalizedPayload.vaccination_catalog_id).toBe("catalog-hep-b");
  });

  it("falls back to a substring match and warns about the ambiguity when multiple entries match", async () => {
    const resource: FhirResource = {
      resourceType: "Immunization",
      vaccineCode: { text: "Hepatitis" },
      occurrenceDateTime: "2026-01-01",
    };
    const supabase = stubCatalogClient({
      exactMatch: null,
      fuzzyMatches: [
        { id: "catalog-hep-a", name: "Hepatitis A" },
        { id: "catalog-hep-b", name: "Hepatitis B birth dose" },
      ],
    });
    const result = await parseFhirResourceEntry(resource, supabase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.normalizedPayload.vaccination_catalog_id).toBe("catalog-hep-a");
    expect(result.proposal.parseWarnings[0]).toMatch(/matched multiple catalogue entries/);
  });

  it("skips with a clear reason when nothing in the catalogue matches at all", async () => {
    const resource: FhirResource = {
      resourceType: "Immunization",
      vaccineCode: { text: "Some Unknown Vaccine" },
      occurrenceDateTime: "2026-01-01",
    };
    const supabase = stubCatalogClient({ exactMatch: null, fuzzyMatches: [] });
    const result = await parseFhirResourceEntry(resource, supabase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.skip.reason).toMatch(/No matching entry in this platform's vaccination catalogue/);
  });

  it("skips when there is no occurrenceDateTime, even with a catalogue match", async () => {
    const resource: FhirResource = { resourceType: "Immunization", vaccineCode: { text: "Hepatitis B" } };
    const supabase = stubCatalogClient({ exactMatch: { id: "catalog-hep-b" } });
    const result = await parseFhirResourceEntry(resource, supabase);
    expect(result.ok).toBe(false);
  });
});
