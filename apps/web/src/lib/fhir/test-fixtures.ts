import type { ExportSnapshot } from "./export-snapshot";

const PATIENT = "11111111-1111-4111-8111-111111111111";

export function fixtureSnapshot(over: Partial<ExportSnapshot> = {}): ExportSnapshot {
  return {
    status: "ok",
    generated_at: "2026-10-07T09:00:00+00:00",
    requester_kind: "self",
    sections_included: ["vitals", "lab_results", "medications", "conditions", "allergies", "immunizations", "documents"],
    sections_refused: [],
    excluded_domains: ["reproductive_health", "mental_health"],
    limits: ["items_inside_general_sections_are_not_classified_by_purpose"],
    patient: { id: PATIENT, patient_number: "TH-000123", full_name: "Test Person", sex: "female", date_of_birth: "1980-05-01" },
    vitals: [
      { id: "aaaaaaaa-0000-4000-8000-000000000001", vital_type: "blood_pressure", taken_at: "2026-10-01T08:00:00+00:00", source: "manual", systolic: 128, diastolic: 82, pulse_bpm: 71 },
      { id: "aaaaaaaa-0000-4000-8000-000000000002", vital_type: "glucose", taken_at: "2026-10-01T08:05:00+00:00", source: "device", glucose_mmol_l: 5.4, glucose_context: "random" },
      { id: "aaaaaaaa-0000-4000-8000-000000000003", vital_type: "weight", taken_at: "2026-10-01T08:10:00+00:00", source: "wearable", weight_kg: 72.5 },
      { id: "aaaaaaaa-0000-4000-8000-000000000004", vital_type: "temperature", taken_at: "2026-10-01T08:15:00+00:00", source: "manual", temperature_c: 37.2 },
      { id: "aaaaaaaa-0000-4000-8000-000000000005", vital_type: "spo2", taken_at: "2026-10-01T08:20:00+00:00", source: "device", spo2_pct: 97 },
      { id: "aaaaaaaa-0000-4000-8000-000000000006", vital_type: "pulse", taken_at: "2026-10-01T08:25:00+00:00", source: "wearable", pulse_bpm: 68 },
      { id: "aaaaaaaa-0000-4000-8000-000000000007", vital_type: "waist_circumference", taken_at: "2026-10-01T08:30:00+00:00", source: "manual", waist_cm: 88 },
      { id: "aaaaaaaa-0000-4000-8000-000000000008", vital_type: "ketones", taken_at: "2026-10-01T08:35:00+00:00", source: "manual", ketones_mmol_l: 0.3 },
    ],
    lab_results: [
      { id: "bbbbbbbb-0000-4000-8000-000000000001", code: "creatinine", value: 0.9, unit: "mg/dL", ref_low: 0.6, ref_high: 1.3, flag: "normal", taken_at: "2026-09-20T10:00:00+00:00", origin: "lab_result" },
      { id: "bbbbbbbb-0000-4000-8000-000000000002", code: "ldl_cholesterol", value: 130, unit: "mg/dL", ref_low: null, ref_high: 100, flag: "high", taken_at: "2026-09-20T10:00:00+00:00", origin: "lab_result" },
      { id: "bbbbbbbb-0000-4000-8000-000000000003", code: "hbsag", value: null, value_text: "negative", unit: "", flag: "negative", taken_at: "2026-09-20T10:00:00+00:00", origin: "lab_result" },
    ],
    medications: [
      { id: "cccccccc-0000-4000-8000-000000000001", drug_name: "Amlodipine", dose: "5 mg", frequency: "once daily", route: "oral", is_active: true, source: "clinician", stopped_at: null, created_at: "2026-08-01T00:00:00+00:00" },
      { id: "cccccccc-0000-4000-8000-000000000002", drug_name: "Ibuprofen", dose: null, frequency: null, route: null, is_active: false, source: "patient", stopped_at: "2026-08-10T00:00:00+00:00", created_at: "2026-08-02T00:00:00+00:00" },
    ],
    conditions: [
      { id: "dddddddd-0000-4000-8000-000000000001", condition_name: "Hypertension", icd10_code: "I10", status: "controlled", date_identified: "2025-01-15", source: "clinician", created_at: "2026-08-01T00:00:00+00:00" },
      { id: "dddddddd-0000-4000-8000-000000000002", condition_name: "Possible anaemia", icd10_code: null, status: "suspected", date_identified: null, source: "patient", created_at: "2026-08-01T00:00:00+00:00" },
    ],
    allergies: [{ id: "eeeeeeee-0000-4000-8000-000000000001", allergen: "Penicillin", reaction: "Rash", severity: "moderate", noted_at: "2026-08-01T00:00:00+00:00", verification_status: "unverified", source: "patient" }],
    immunizations: [
      { id: "ffffffff-0000-4000-8000-000000000001", vaccine_code: "hepatitis_b", vaccine_name: "Hepatitis B", dose_number: 2, date_administered: "2026-07-01", batch_lot_number: "LOT42", given_where: "Lagos clinic", verification_status: "verified" },
    ],
    documents: [{ id: "99999999-0000-4000-8000-000000000001", document_type: "discharge_summary", document_date: "2026-06-01", mime_type: "image/jpeg", source: "patient", created_at: "2026-06-02T00:00:00+00:00" }],
    ...over,
  };
}
