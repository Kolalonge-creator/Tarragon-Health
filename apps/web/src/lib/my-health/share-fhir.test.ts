import { buildSharedRecordBundle, sharedBundleFileName, sharedRecordToSnapshot } from "./share-fhir";
import type { SharedData } from "@/app/share/[token]/shared-record-view";

const RECORD: SharedData = {
  status: "ok",
  full_name: "Test Person",
  shared_at: "2026-10-20T09:00:00+00:00",
  expires_at: "2026-10-27T09:00:00+00:00",
  sections: ["vitals", "medications", "conditions", "allergies", "lab_results", "vaccinations", "emergency_info"],
  recipient_label: "Dr Okafor",
  vitals: [
    { vital_type: "blood_pressure", systolic: 128, diastolic: 82, pulse_bpm: 71, glucose_mmol: null, weight_kg: null, temperature_c: null, spo2_pct: null, source: "manual", taken_at: "2026-10-01T08:00:00+00:00" }, // band-ok: fixture reading for the FHIR mapper
    { vital_type: "glucose", systolic: null, diastolic: null, pulse_bpm: null, glucose_mmol: 5.4, weight_kg: null, temperature_c: null, spo2_pct: null, source: "wearable", taken_at: "2026-10-01T08:05:00+00:00" }, // band-ok: fixture reading for the FHIR mapper
  ],
  medications: [{ drug_name: "Amlodipine", dose: "5 mg", frequency: "once daily", is_active: true }],
  conditions: ["Hypertension"],
  allergies: [{ allergen: "Penicillin", reaction: "Rash", severity: "moderate" }],
  lab_results: [
    { code: "creatinine", value: 0.9, value_text: null, unit: "mg/dL", reference_range_text: "0.6 to 1.3", abnormal_flag: "normal", taken_at: "2026-09-20T10:00:00+00:00", laboratory: "Lab A" },
  ],
  vaccinations: [
    { vaccine_name: "Hepatitis B", date_administered: "2026-07-01", dose_number: 2, batch_number: "LOT42" },
    { vaccine_name: "No date", date_administered: null, dose_number: null, batch_number: null },
  ],
  emergency_info: { blood: { blood_group: "O+", genotype: "AA", source: "patient" }, emergency_contact: { name: "Ada", phone: "+2348000000000", relationship: "sister" } },
};

describe("sharedRecordToSnapshot", () => {
  it("uses counter ids and a synthetic patient, never real identifiers", () => {
    const s = sharedRecordToSnapshot(RECORD);
    expect(s.patient).toEqual({ id: "patient-1", full_name: "Test Person" });
    expect(s.vitals?.map((v) => v.id)).toEqual(["vital-1", "vital-2"]);
    expect(JSON.stringify(s)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("drops a vaccination with no date rather than inventing one", () => {
    expect(sharedRecordToSnapshot(RECORD).immunizations).toHaveLength(1);
  });

  it("does not claim a clinician confirmed a condition", () => {
    expect(sharedRecordToSnapshot(RECORD).conditions?.[0]?.status).toBe("suspected");
  });
});

describe("buildSharedRecordBundle", () => {
  const { bundle, mappingVersion } = buildSharedRecordBundle(RECORD);
  const resources = (bundle.entry as Array<{ resource: Record<string, unknown> }>).map((e) => e.resource);

  it("is a FHIR collection bundle with the mapping version recorded", () => {
    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.type).toBe("collection");
    expect(mappingVersion).toBeGreaterThan(0);
  });

  it("holds each shared section once, and no emergency contact or blood group", () => {
    const types = resources.map((r) => r.resourceType);
    expect(types).toEqual(expect.arrayContaining(["Patient", "Observation", "MedicationStatement", "Condition", "AllergyIntolerance", "Immunization"]));
    const text = JSON.stringify(bundle);
    expect(text).not.toContain("+2348000000000");
    expect(text).not.toContain("O+");
  });

  it("keeps the printed reference range as text on the lab observation", () => {
    const lab = resources.find((r) => r.id === "lab-1");
    expect(lab?.referenceRange).toEqual([{ text: "0.6 to 1.3" }]);
  });

  it("tags a wearable reading as an estimate", () => {
    const glucose = resources.find((r) => r.id === "vital-2");
    expect(JSON.stringify(glucose)).toContain("estimate");
  });

  it("says how many shared items could not be exported instead of dropping them silently", () => {
    const odd = buildSharedRecordBundle({
      ...RECORD,
      vitals: [{ vital_type: "no_such_vital", systolic: null, diastolic: null, pulse_bpm: null, glucose_mmol: null, weight_kg: null, temperature_c: null, spo2_pct: null, source: "manual", taken_at: "2026-10-01T08:00:00+00:00" }],
    });
    expect(odd.skipped).toHaveLength(1);
    expect(JSON.stringify(odd.bundle.meta)).toContain("items-not-exported-1");
    expect(JSON.stringify(bundle.meta)).not.toContain("items-not-exported");
  });

  it("carries only the sections that were shared", () => {
    const only = buildSharedRecordBundle({ status: "ok", full_name: "A B", shared_at: RECORD.shared_at, expires_at: RECORD.expires_at, sections: ["allergies"], allergies: RECORD.allergies });
    const types = (only.bundle.entry as Array<{ resource: { resourceType: string } }>).map((e) => e.resource.resourceType).sort();
    expect(types).toEqual(["AllergyIntolerance", "Patient"]);
  });
});

describe("sharedBundleFileName", () => {
  it("names the file for what it is and the day, with no personal detail", () => {
    expect(sharedBundleFileName(RECORD)).toBe("tarragon-health-record-2026-10-20.fhir.json");
  });
});
