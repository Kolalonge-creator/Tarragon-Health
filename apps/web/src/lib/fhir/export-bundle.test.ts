import { describe, expect, it } from "@jest/globals";
import { loadFhirMapping } from "./config";
import { buildFhirBundle, WEARABLE_ESTIMATE_NOTE, type FhirOut } from "./export-bundle";
import { fixtureSnapshot } from "./test-fixtures";

const { mapping } = loadFhirMapping();

function entries(bundle: FhirOut, type: string): FhirOut[] {
  return (bundle.entry as { resource: FhirOut }[]).map((e) => e.resource).filter((r) => r.resourceType === type);
}

describe("buildFhirBundle", () => {
  const out = buildFhirBundle(fixtureSnapshot(), mapping);

  it("produces a collection Bundle of the six resource types the spec names, plus allergies", () => {
    expect(out.bundle.resourceType).toBe("Bundle");
    expect(out.bundle.type).toBe("collection");
    const types = new Set((out.bundle.entry as { resource: FhirOut }[]).map((e) => e.resource.resourceType));
    expect([...types].sort()).toEqual(["AllergyIntolerance", "Condition", "DocumentReference", "Immunization", "MedicationStatement", "Observation", "Patient"]);
  });

  it("writes blood pressure as one panel with two components in mm[Hg], and the pulse as its own observation", () => {
    const bp = entries(out.bundle, "Observation").find((o) => o.id === "aaaaaaaa-0000-4000-8000-000000000001") as FhirOut;
    const comps = bp.component as { valueQuantity: { value: number; code: string; system: string } }[];
    expect(comps.map((c) => c.valueQuantity.value)).toEqual([128, 82]);
    expect(comps.every((c) => c.valueQuantity.code === "mm[Hg]" && c.valueQuantity.system === "http://unitsofmeasure.org")).toBe(true);
    expect(entries(out.bundle, "Observation").some((o) => o.id === "aaaaaaaa-0000-4000-8000-000000000001-pulse")).toBe(true);
  });

  it("labels a wearable reading as an estimate with a tag and a note, and tags every source", () => {
    const w = entries(out.bundle, "Observation").find((o) => o.id === "aaaaaaaa-0000-4000-8000-000000000003") as FhirOut;
    expect(JSON.stringify(w.meta)).toContain('"code":"estimate"');
    expect((w.note as { text: string }[])[0]?.text).toBe(WEARABLE_ESTIMATE_NOTE);
    const manual = entries(out.bundle, "Observation").find((o) => o.id === "aaaaaaaa-0000-4000-8000-000000000004") as FhirOut;
    expect(JSON.stringify(manual.meta)).toContain('"code":"manual"');
    expect(manual.note).toBeUndefined();
  });

  it("lists a vital with no mapping as skipped with a reason instead of inventing a code", () => {
    expect(out.skipped).toEqual([{ kind: "vital", id: "aaaaaaaa-0000-4000-8000-000000000008", reason: "no FHIR mapping for vital type ketones" }]);
  });

  it("gives a lab result a LOINC only when the configuration has one, and always Tarragon's own analyte code", () => {
    const labs = entries(out.bundle, "Observation").filter((o) => (o.category as { coding: { code: string }[] }[])[0]?.coding[0]?.code === "laboratory");
    const creat = labs.find((o) => o.id === "bbbbbbbb-0000-4000-8000-000000000001") as FhirOut;
    const ldl = labs.find((o) => o.id === "bbbbbbbb-0000-4000-8000-000000000002") as FhirOut;
    expect(JSON.stringify(creat.code)).toContain("2160-0");
    expect(JSON.stringify(ldl.code)).not.toContain("loinc.org");
    expect(JSON.stringify(ldl.code)).toContain("ldl_cholesterol");
    expect(creat.valueQuantity).toMatchObject({ value: 0.9, unit: "mg/dL", code: "mg/dL" });
    expect(creat.referenceRange).toEqual([{ low: expect.objectContaining({ value: 0.6 }), high: expect.objectContaining({ value: 1.3 }) }]);
    expect(JSON.stringify(creat.interpretation)).toContain('"code":"N"');
  });

  it("exports a negative qualitative result as a coded value, never a number", () => {
    const hb = entries(out.bundle, "Observation").find((o) => o.id === "bbbbbbbb-0000-4000-8000-000000000003") as FhirOut;
    expect(hb.valueQuantity).toBeUndefined();
    expect(JSON.stringify(hb.valueCodeableConcept)).toContain("260385009");
  });

  it("maps condition status, and marks a suspected condition unconfirmed", () => {
    const [controlled, suspected] = entries(out.bundle, "Condition");
    expect(JSON.stringify(controlled?.clinicalStatus)).toContain('"active"');
    expect(JSON.stringify(controlled?.verificationStatus)).toContain('"confirmed"');
    expect(JSON.stringify(controlled?.code)).toContain("I10");
    expect(JSON.stringify(suspected?.verificationStatus)).toContain('"unconfirmed"');
  });

  it("maps a stopped medicine to stopped and carries dose and frequency as text", () => {
    const [active, stopped] = entries(out.bundle, "MedicationStatement");
    expect(active?.status).toBe("active");
    expect(stopped?.status).toBe("stopped");
    expect(JSON.stringify(active?.dosage)).toContain("5 mg, once daily");
  });

  it("exports a document as metadata only: a content type and no data, url or text", () => {
    const [doc] = entries(out.bundle, "DocumentReference");
    expect(doc?.content).toEqual([{ attachment: { contentType: "image/jpeg" } }]);
    expect(JSON.stringify(doc)).not.toMatch(/data|url|ocr|extracted/);
  });

  it("names what was left out in the bundle's own tags", () => {
    const tags = JSON.stringify((out.bundle.meta as { tag: unknown[] }).tag);
    expect(tags).toContain("excludes-reproductive-health");
    expect(tags).toContain("excludes-mental-health");
    expect(tags).toContain("items-inside-general-sections-are-not-classified-by-purpose");
  });

  it("names a section the requester was not permitted, so a partial export is never mistaken for a full one", () => {
    const partial = buildFhirBundle(fixtureSnapshot({ sections_refused: ["lab_results", "medications"], sections_included: ["vitals"], lab_results: undefined, medications: undefined }), mapping);
    expect(JSON.stringify(partial.bundle.meta)).toContain("section-not-permitted-lab-results");
    expect(entries(partial.bundle, "MedicationStatement")).toHaveLength(0);
  });

  it("claims no Nigeria Core or NPHCDA profile until the configuration lists one", () => {
    expect(JSON.stringify(out.bundle)).not.toContain('"profile"');
    expect(mapping.profiles).toEqual({});
    expect(mapping.ig_status).toBe("nigeria_core_and_nphcda_under_development");
  });

  it("with a profile listed in a later configuration version, adds it to that resource type only", () => {
    const withProfile = buildFhirBundle(fixtureSnapshot(), { ...mapping, profiles: { Immunization: ["https://example.invalid/StructureDefinition/ng-immunization"] } });
    expect(entries(withProfile.bundle, "Immunization")[0]?.meta).toMatchObject({ profile: ["https://example.invalid/StructureDefinition/ng-immunization"] });
    expect(entries(withProfile.bundle, "Condition")[0]?.meta).not.toHaveProperty("profile");
  });

  it("never carries a private note or a file name: the snapshot has none, and the bundle adds none", () => {
    expect(JSON.stringify(out.bundle)).not.toMatch(/PRIVATE|file_path|original_filename/);
  });
});
