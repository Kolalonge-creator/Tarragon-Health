import type { Database } from "@tarragon/shared";
import {
  buildPatientResource,
  buildVitalsObservations,
  buildBloodProfileObservations,
  buildAllergyIntoleranceResources,
  buildMedicationStatementResources,
  buildImmunizationResources,
  buildCarePlanResources,
  buildEncounterResources,
  buildDocumentReferenceResources,
} from "./resources";

const PATIENT_ID = "11111111-1111-1111-1111-111111111111";

function vitalsRow(overrides: Partial<Database["public"]["Tables"]["vitals_readings"]["Row"]>) {
  return {
    id: "v1",
    organisation_id: "org1",
    patient_id: PATIENT_ID,
    source: "manual",
    taken_at: "2026-08-01T10:00:00Z",
    vital_type: "blood_pressure",
    systolic: null,
    diastolic: null,
    pulse_bpm: null,
    glucose_context: null,
    glucose_mmol_l: null,
    weight_kg: null,
    temperature_c: null,
    spo2_pct: null,
    waist_cm: null,
    ketones_mmol_l: null,
    ketone_urine: null,
    cgm_connection_id: null,
    device_id: null,
    external_reading_id: null,
    logged_by_profile_id: null,
    note: null,
    created_at: "2026-08-01T10:00:00Z",
    ...overrides,
  } as Database["public"]["Tables"]["vitals_readings"]["Row"];
}

describe("buildPatientResource", () => {
  it("maps the core demographic fields", () => {
    const resource = buildPatientResource({
      id: PATIENT_ID,
      full_name: "Ada Obi",
      date_of_birth: "1990-01-01",
      sex: "female",
      phone: "+2348012345678",
    });
    expect(resource.resourceType).toBe("Patient");
    expect(resource.name).toEqual([{ text: "Ada Obi" }]);
    expect(resource.gender).toBe("female");
    expect(resource.telecom).toEqual([{ system: "phone", value: "+2348012345678" }]);
  });
});

describe("buildVitalsObservations", () => {
  it("represents blood pressure as one Observation with systolic/diastolic components, not two Observations", () => {
    const [obs] = buildVitalsObservations(PATIENT_ID, [
      vitalsRow({ vital_type: "blood_pressure", systolic: 128, diastolic: 82, pulse_bpm: 70 }),
    ]);
    expect(obs.component).toHaveLength(3);
    expect(obs.component?.[0].valueQuantity?.value).toBe(128);
    expect(obs.component?.[1].valueQuantity?.value).toBe(82);
    expect(obs.valueQuantity).toBeUndefined();
  });

  it("maps a simple vital to a single valueQuantity with the right unit", () => {
    const [obs] = buildVitalsObservations(PATIENT_ID, [vitalsRow({ vital_type: "weight", weight_kg: 68.5 })]);
    expect(obs.valueQuantity).toEqual({ value: 68.5, unit: "kg", system: "http://unitsofmeasure.org", code: "kg" });
  });

  it("covers every vital_type without falling through to an empty Observation", () => {
    const types: Database["public"]["Enums"]["vital_type"][] = [
      "blood_pressure",
      "glucose",
      "weight",
      "pulse",
      "temperature",
      "spo2",
      "waist_circumference",
      "ketones",
    ];
    for (const vital_type of types) {
      const [obs] = buildVitalsObservations(PATIENT_ID, [vitalsRow({ vital_type })]);
      const hasValue = obs.valueQuantity !== undefined || (obs.component?.length ?? 0) > 0;
      expect(hasValue).toBe(true);
    }
  });
});

describe("buildBloodProfileObservations", () => {
  it("codes genotype against the local CodeSystem, never a standard one", () => {
    const observations = buildBloodProfileObservations(PATIENT_ID, {
      patient_id: PATIENT_ID,
      organisation_id: "org1",
      blood_group: "O+",
      genotype: "AS",
      genotype_note: null,
      provenance: "self_reported",
      recorded_at: "2026-01-01T00:00:00Z",
      recorded_by: null,
      updated_at: "2026-01-01T00:00:00Z",
      attested_at: null,
      attestation_version: null,
      document_id: null,
    });
    expect(observations).toHaveLength(2);
    expect(observations[0].valueString).toBe("O Positive");
    expect(observations[1].code.coding?.[0].system).toContain("haemoglobin-genotype");
  });

  it("returns no Observations for a profile with neither field set", () => {
    expect(buildBloodProfileObservations(PATIENT_ID, null)).toEqual([]);
  });
});

describe("buildAllergyIntoleranceResources", () => {
  it("maps severe -> high criticality and mild/moderate -> low", () => {
    const base = {
      id: "a1",
      organisation_id: "org1",
      patient_id: PATIENT_ID,
      allergen: "Penicillin",
      reaction: "Rash",
      source: "clinician" as const,
      noted_at: "2026-01-01T00:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      recorded_by: null,
    };
    const [severe] = buildAllergyIntoleranceResources(PATIENT_ID, [{ ...base, severity: "severe" }]);
    const [mild] = buildAllergyIntoleranceResources(PATIENT_ID, [{ ...base, severity: "mild" }]);
    expect(severe.criticality).toBe("high");
    expect(mild.criticality).toBe("low");
  });
});

describe("buildMedicationStatementResources", () => {
  it("maps is_active to the FHIR status and joins dose/frequency into dosage text", () => {
    const [med] = buildMedicationStatementResources(PATIENT_ID, [
      {
        id: "m1",
        organisation_id: "org1",
        patient_id: PATIENT_ID,
        care_plan_id: null,
        drug_name: "Amlodipine",
        dose: "5mg",
        frequency: "once daily",
        is_active: true,
        source: "clinician",
        refill_date: null,
        schedule_times: [],
        stopped_at: null,
        stopped_reason: null,
        added_by: null,
        last_confirmed_at: null,
        last_confirmed_by: null,
        prescriber_document_url: null,
        prescriber_name: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(med.status).toBe("active");
    expect(med.dosage?.[0].text).toBe("5mg, once daily");
  });
});

describe("buildImmunizationResources", () => {
  it("carries the dose number through as protocolApplied", () => {
    const [imm] = buildImmunizationResources(PATIENT_ID, [
      {
        row: {
          id: "im1",
          organisation_id: "org1",
          profile_id: PATIENT_ID,
          vaccination_catalog_id: "cat1",
          dose_number: 2,
          date_administered: "2026-02-01",
          provider: null,
          certificate_url: null,
          physical_certificate_path: null,
          tarragon_certificate_issued_at: null,
          tarragon_certificate_serial: null,
          verification_note: null,
          verification_status: "verified",
          verified_at: "2026-02-02T00:00:00Z",
          verified_by: "staff1",
          created_at: "2026-02-01T00:00:00Z",
          updated_at: "2026-02-01T00:00:00Z",
          booking_request_id: null,
        },
        vaccineName: "Yellow Fever",
      },
    ]);
    expect(imm.protocolApplied).toEqual([{ doseNumberPositiveInt: 2 }]);
    expect(imm.occurrenceDateTime).toBe("2026-02-01");
  });
});

describe("buildCarePlanResources", () => {
  it("maps the internal 'cancelled' status to FHIR's 'revoked'", () => {
    const [plan] = buildCarePlanResources(PATIENT_ID, [
      {
        id: "cp1",
        organisation_id: "org1",
        patient_id: PATIENT_ID,
        assigned_clinician_id: null,
        condition: "hypertension",
        status: "cancelled",
        notes: null,
        target_ranges: {},
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(plan.status).toBe("revoked");
  });
});

describe("buildEncounterResources", () => {
  it("passes admitted_on/discharged_on through as bare dates, never fabricating a time-of-day", () => {
    const [enc] = buildEncounterResources(PATIENT_ID, [
      {
        id: "adm1",
        organisation_id: "org1",
        patient_id: PATIENT_ID,
        admitted_on: "2026-03-01",
        discharged_on: "2026-03-05",
        reason: null,
        self_reported_diagnosis: "Malaria",
        facility_id: null,
        facility_name: "General Hospital",
        source: "patient_reported",
        is_current: false,
        logged_by_profile_id: null,
        recorded_by: null,
        clinician_alert_id: null,
        discharge_review_alert_id: null,
        emergency_event_id: null,
        discharge_summary: null,
        created_at: "2026-03-01T00:00:00Z",
        updated_at: "2026-03-05T00:00:00Z",
      },
    ]);
    expect(enc.period).toEqual({ start: "2026-03-01", end: "2026-03-05" });
    expect(enc.status).toBe("finished");
  });
});

describe("buildDocumentReferenceResources", () => {
  it("only includes documents that actually got a signed URL, never a raw storage path", () => {
    const doc = (id: string) => ({
      id,
      organisation_id: "org1",
      patient_id: PATIENT_ID,
      file_path: `patients/${PATIENT_ID}/${id}.pdf`,
      file_size_bytes: null,
      lab_order_id: null,
      mime_type: "application/pdf",
      note: null,
      original_filename: `${id}.pdf`,
      review_note: null,
      reviewed_at: null,
      reviewed_by: null,
      source: "patient" as const,
      uploaded_by: null,
      clinician_alert_id: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });

    const signedUrlById = new Map<string, string | null>([
      ["doc-ok", "https://storage.example/signed"],
      ["doc-failed", null],
    ]);
    const refs = buildDocumentReferenceResources(PATIENT_ID, [doc("doc-ok"), doc("doc-failed")], signedUrlById);
    expect(refs).toHaveLength(1);
    expect(refs[0].content[0].attachment.url).toBe("https://storage.example/signed");
  });
});
