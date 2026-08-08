import type { Database } from "@tarragon/shared";
import {
  loincCodeableConceptForVitalType,
  LOINC_BLOOD_PRESSURE_PANEL,
  LOINC_SYSTOLIC,
  LOINC_DIASTOLIC,
  LOINC_ABO_GROUP,
  LOINC_RH_GROUP,
  splitCombinedBloodGroup,
  genotypeCodeableConcept,
  conditionCodeableConcept,
  vaccineCodeableConcept,
} from "../crosswalks";
import type {
  PatientResource,
  ObservationResource,
  AllergyIntoleranceResource,
  MedicationStatementResource,
  ImmunizationResource,
  CarePlanResource,
  EncounterResource,
  DocumentReferenceResource,
  Reference,
} from "../types";

type VitalsRow = Database["public"]["Tables"]["vitals_readings"]["Row"];
type ScreeningRow = Database["public"]["Tables"]["screening_results"]["Row"];
type AllergyRow = Database["public"]["Tables"]["patient_allergies"]["Row"];
type MedicationRow = Database["public"]["Tables"]["medications"]["Row"];
type VaccinationRow = Database["public"]["Tables"]["vaccination_records"]["Row"];
type CarePlanRow = Database["public"]["Tables"]["care_plans"]["Row"];
type AdmissionRow = Database["public"]["Tables"]["patient_hospital_admissions"]["Row"];
type DocumentRow = Database["public"]["Tables"]["lab_result_documents"]["Row"];

export function patientReference(patientId: string): Reference {
  return { reference: `Patient/${patientId}` };
}

const VITAL_SIGNS_CATEGORY = [
  {
    coding: [
      {
        system: "http://terminology.hl7.org/CodeSystem/observation-category",
        code: "vital-signs",
        display: "Vital Signs",
      },
    ],
  },
];

const LABORATORY_CATEGORY = [
  {
    coding: [
      {
        system: "http://terminology.hl7.org/CodeSystem/observation-category",
        code: "laboratory",
        display: "Laboratory",
      },
    ],
  },
];

export function buildPatientResource(profile: {
  id: string;
  full_name: string | null;
  date_of_birth: string | null;
  sex: Database["public"]["Enums"]["sex"] | null;
  phone: string | null;
}): PatientResource {
  return {
    resourceType: "Patient",
    id: profile.id,
    name: profile.full_name ? [{ text: profile.full_name }] : undefined,
    gender: profile.sex ?? undefined,
    birthDate: profile.date_of_birth ?? undefined,
    telecom: profile.phone ? [{ system: "phone", value: profile.phone }] : undefined,
  };
}

/**
 * One Observation per vitals_readings row. Blood pressure is a single
 * Observation with systolic/diastolic as components (the FHIR-conventional
 * shape for a BP panel), not two separate Observations.
 */
export function buildVitalsObservations(patientId: string, vitals: VitalsRow[]): ObservationResource[] {
  return vitals.map((row) => {
    const base: ObservationResource = {
      resourceType: "Observation",
      id: row.id,
      status: "final",
      category: VITAL_SIGNS_CATEGORY,
      code: loincCodeableConceptForVitalType(row.vital_type, row.vital_type),
      subject: patientReference(patientId),
      effectiveDateTime: row.taken_at,
    };

    switch (row.vital_type) {
      case "blood_pressure":
        return {
          ...base,
          code: { coding: [LOINC_BLOOD_PRESSURE_PANEL], text: "Blood pressure panel" },
          component: [
            { code: { coding: [LOINC_SYSTOLIC] }, valueQuantity: { value: row.systolic ?? undefined, unit: "mmHg", system: "http://unitsofmeasure.org", code: "mm[Hg]" } },
            { code: { coding: [LOINC_DIASTOLIC] }, valueQuantity: { value: row.diastolic ?? undefined, unit: "mmHg", system: "http://unitsofmeasure.org", code: "mm[Hg]" } },
            ...(row.pulse_bpm != null
              ? [{ code: { text: "Pulse" }, valueQuantity: { value: row.pulse_bpm, unit: "/min", system: "http://unitsofmeasure.org", code: "/min" } }]
              : []),
          ],
        };
      case "glucose":
        return {
          ...base,
          valueQuantity: { value: row.glucose_mmol_l ?? undefined, unit: "mmol/L", system: "http://unitsofmeasure.org", code: "mmol/L" },
          interpretation: row.glucose_context ? [{ text: row.glucose_context }] : undefined,
        };
      case "weight":
        return { ...base, valueQuantity: { value: row.weight_kg ?? undefined, unit: "kg", system: "http://unitsofmeasure.org", code: "kg" } };
      case "pulse":
        return { ...base, valueQuantity: { value: row.pulse_bpm ?? undefined, unit: "/min", system: "http://unitsofmeasure.org", code: "/min" } };
      case "temperature":
        return { ...base, valueQuantity: { value: row.temperature_c ?? undefined, unit: "Cel", system: "http://unitsofmeasure.org", code: "Cel" } };
      case "spo2":
        return { ...base, valueQuantity: { value: row.spo2_pct ?? undefined, unit: "%", system: "http://unitsofmeasure.org", code: "%" } };
      case "waist_circumference":
        return { ...base, valueQuantity: { value: row.waist_cm ?? undefined, unit: "cm", system: "http://unitsofmeasure.org", code: "cm" } };
      case "ketones":
        return { ...base, valueQuantity: { value: row.ketones_mmol_l ?? undefined, unit: "mmol/L", system: "http://unitsofmeasure.org", code: "mmol/L" } };
      default:
        return base;
    }
  });
}

export function buildBloodProfileObservations(
  patientId: string,
  bloodProfile: Database["public"]["Tables"]["patient_blood_profile"]["Row"] | null
): ObservationResource[] {
  if (!bloodProfile) return [];
  const observations: ObservationResource[] = [];

  if (bloodProfile.blood_group) {
    const split = splitCombinedBloodGroup(bloodProfile.blood_group);
    observations.push({
      resourceType: "Observation",
      status: "final",
      category: LABORATORY_CATEGORY,
      code: { coding: [LOINC_ABO_GROUP, LOINC_RH_GROUP], text: "ABO and Rh group" },
      subject: patientReference(patientId),
      effectiveDateTime: bloodProfile.recorded_at,
      valueString: split ? `${split.abo} ${split.rh}` : bloodProfile.blood_group,
    });
  }

  if (bloodProfile.genotype) {
    observations.push({
      resourceType: "Observation",
      status: "final",
      category: LABORATORY_CATEGORY,
      code: genotypeCodeableConcept(bloodProfile.genotype),
      subject: patientReference(patientId),
      effectiveDateTime: bloodProfile.recorded_at,
      valueString: bloodProfile.genotype,
    });
  }

  return observations;
}

/**
 * screen_types carries no LOINC mapping today (unlike vitals, which do have
 * a stable, small enum a crosswalk can cover) — coded text-only, which is
 * valid FHIR for "we know what this is, we don't have its standard code."
 */
export function buildScreeningObservations(
  patientId: string,
  screenings: { row: ScreeningRow; screenTypeName: string }[]
): ObservationResource[] {
  return screenings.map(({ row, screenTypeName }) => ({
    resourceType: "Observation",
    id: row.id,
    status: "final",
    category: LABORATORY_CATEGORY,
    code: { text: screenTypeName },
    subject: patientReference(patientId),
    effectiveDateTime: row.created_at,
    valueString: row.result_summary ?? undefined,
    interpretation: row.abnormal_flags?.length ? [{ text: row.abnormal_flags.join(", ") }] : undefined,
  }));
}

function allergyCriticality(
  severity: Database["public"]["Enums"]["allergy_severity"] | null
): AllergyIntoleranceResource["criticality"] {
  if (severity === "severe") return "high";
  if (severity === "mild" || severity === "moderate") return "low";
  return "unable-to-assess";
}

export function buildAllergyIntoleranceResources(patientId: string, allergies: AllergyRow[]): AllergyIntoleranceResource[] {
  return allergies.map((row) => ({
    resourceType: "AllergyIntolerance",
    id: row.id,
    clinicalStatus: { text: "active" },
    code: { text: row.allergen },
    patient: patientReference(patientId),
    criticality: allergyCriticality(row.severity),
    reaction: row.reaction ? [{ manifestation: [{ text: row.reaction }], description: row.reaction }] : undefined,
    recordedDate: row.noted_at,
  }));
}

export function buildMedicationStatementResources(
  patientId: string,
  medications: MedicationRow[]
): MedicationStatementResource[] {
  return medications.map((row) => ({
    resourceType: "MedicationStatement",
    id: row.id,
    status: row.is_active ? "active" : "stopped",
    medicationCodeableConcept: { text: row.drug_name },
    subject: patientReference(patientId),
    dosage: [{ text: [row.dose, row.frequency].filter(Boolean).join(", ") || undefined }],
    dateAsserted: row.created_at,
  }));
}

export function buildImmunizationResources(
  patientId: string,
  immunizations: { row: VaccinationRow; vaccineName: string }[]
): ImmunizationResource[] {
  return immunizations.map(({ row, vaccineName }) => ({
    resourceType: "Immunization",
    id: row.id,
    status: "completed",
    vaccineCode: vaccineCodeableConcept(vaccineName),
    patient: patientReference(patientId),
    occurrenceDateTime: row.date_administered,
    protocolApplied: [{ doseNumberPositiveInt: row.dose_number }],
  }));
}

function carePlanFhirStatus(status: Database["public"]["Enums"]["care_plan_status"]): CarePlanResource["status"] {
  if (status === "cancelled") return "revoked";
  return status;
}

export function buildCarePlanResources(patientId: string, carePlans: CarePlanRow[]): CarePlanResource[] {
  return carePlans.map((row) => ({
    resourceType: "CarePlan",
    id: row.id,
    status: carePlanFhirStatus(row.status),
    category: [conditionCodeableConcept(row.condition)],
    subject: patientReference(patientId),
    description: row.notes ?? undefined,
  }));
}

const INPATIENT_CLASS = {
  system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
  code: "IMP",
  display: "inpatient encounter",
};

/**
 * admitted_on/discharged_on are `date` columns, not `timestamptz` — passed
 * through as bare date strings. FHIR's dateTime type accepts a
 * partial-precision date like "2026-07-01" directly; no fabricated
 * time-of-day is introduced.
 */
export function buildEncounterResources(patientId: string, admissions: AdmissionRow[]): EncounterResource[] {
  return admissions.map((row) => ({
    resourceType: "Encounter",
    id: row.id,
    status: row.discharged_on ? "finished" : "in-progress",
    class: INPATIENT_CLASS,
    subject: patientReference(patientId),
    period: { start: row.admitted_on, end: row.discharged_on ?? undefined },
    reasonCode: row.self_reported_diagnosis || row.reason ? [{ text: row.self_reported_diagnosis ?? row.reason ?? undefined }] : undefined,
    serviceProvider: row.facility_name ? { display: row.facility_name } : undefined,
  }));
}

export function buildDocumentReferenceResources(
  patientId: string,
  documents: DocumentRow[],
  signedUrlById: Map<string, string | null>
): DocumentReferenceResource[] {
  return documents
    .filter((row) => signedUrlById.get(row.id))
    .map((row) => ({
      resourceType: "DocumentReference",
      id: row.id,
      status: "current",
      type: { text: row.mime_type ?? "Document" },
      subject: patientReference(patientId),
      date: row.created_at,
      content: [
        {
          attachment: {
            contentType: row.mime_type ?? undefined,
            url: signedUrlById.get(row.id) ?? undefined,
            title: row.original_filename ?? undefined,
          },
        },
      ],
    }));
}
