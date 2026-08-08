import type { CodeableConcept, FhirResourceBase } from "../types";
import { LOINC_BY_VITAL_TYPE, LOINC_BLOOD_PRESSURE_PANEL, matchVaccineToCatalog } from "../crosswalks";

/**
 * Parsers for the v1 import allow-list. Each is pure (no DB, no network)
 * and never guesses: anything it can't map confidently returns
 * `normalized: null` (or a null field within a valid payload) plus a
 * human-readable warning, rather than a best-effort value a clinician might
 * mistake for something the parser was actually sure of.
 */

export interface ParseResult {
  normalized: Record<string, unknown> | null;
  warnings: string[];
}

function codingCodes(concept: CodeableConcept | undefined): string[] {
  return (concept?.coding ?? []).map((c) => c.code).filter((c): c is string => !!c);
}

// ---------------------------------------------------------------------------
// Observation -> vitals_readings
// ---------------------------------------------------------------------------

export interface IncomingObservation extends FhirResourceBase {
  status?: string;
  code?: CodeableConcept;
  effectiveDateTime?: string;
  valueQuantity?: { value?: number };
  component?: { code?: CodeableConcept; valueQuantity?: { value?: number } }[];
}

const VITAL_TYPE_BY_LOINC_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(LOINC_BY_VITAL_TYPE)
    .filter(([, coding]) => !!coding.code)
    .map(([vitalType, coding]) => [coding.code as string, vitalType])
);

const VITALS_COLUMN_BY_TYPE: Record<string, string> = {
  glucose: "glucose_mmol_l",
  weight: "weight_kg",
  pulse: "pulse_bpm",
  temperature: "temperature_c",
  spo2: "spo2_pct",
  waist_circumference: "waist_cm",
  ketones: "ketones_mmol_l",
};

export function parseObservationResource(resource: IncomingObservation): ParseResult {
  const takenAt = resource.effectiveDateTime;
  if (!takenAt) {
    return {
      normalized: null,
      warnings: ["Observation has no effectiveDateTime -- there is no reliable date to record this reading against."],
    };
  }

  const codes = codingCodes(resource.code);

  if (LOINC_BLOOD_PRESSURE_PANEL.code && codes.includes(LOINC_BLOOD_PRESSURE_PANEL.code)) {
    const systolic = resource.component?.find((c) => codingCodes(c.code).includes("8480-6"))?.valueQuantity?.value;
    const diastolic = resource.component?.find((c) => codingCodes(c.code).includes("8462-4"))?.valueQuantity?.value;
    if (systolic == null || diastolic == null) {
      return {
        normalized: null,
        warnings: ["Blood pressure Observation is missing a systolic or diastolic component -- skipped."],
      };
    }
    return { normalized: { vital_type: "blood_pressure", taken_at: takenAt, systolic, diastolic }, warnings: [] };
  }

  const vitalType = codes.map((code) => VITAL_TYPE_BY_LOINC_CODE[code]).find(Boolean);
  if (!vitalType) {
    return {
      normalized: null,
      warnings: [
        `Observation code (${codes.join(", ") || resource.code?.text || "unlabelled"}) does not match a vital type this platform imports -- skipped.`,
      ],
    };
  }

  const value = resource.valueQuantity?.value;
  const column = VITALS_COLUMN_BY_TYPE[vitalType];
  if (value == null || !column) {
    return { normalized: null, warnings: [`${vitalType} Observation has no usable value -- skipped.`] };
  }

  return { normalized: { vital_type: vitalType, taken_at: takenAt, [column]: value }, warnings: [] };
}

// ---------------------------------------------------------------------------
// AllergyIntolerance -> patient_allergies
// ---------------------------------------------------------------------------

export interface IncomingAllergyIntolerance extends FhirResourceBase {
  code?: CodeableConcept;
  criticality?: string;
  reaction?: { manifestation?: CodeableConcept[]; description?: string }[];
  recordedDate?: string;
}

function allergySeverityFromCriticality(criticality: string | undefined): { severity: string | null; warning: string | null } {
  if (criticality === "high") return { severity: "severe", warning: null };
  if (criticality === "low") return { severity: "mild", warning: null };
  if (!criticality || criticality === "unable-to-assess") return { severity: null, warning: null };
  return { severity: null, warning: `Unrecognised criticality "${criticality}" -- severity left blank for clinician review.` };
}

export function parseAllergyIntoleranceResource(resource: IncomingAllergyIntolerance): ParseResult {
  const allergen = resource.code?.text ?? resource.code?.coding?.[0]?.display;
  if (!allergen) {
    return { normalized: null, warnings: ["AllergyIntolerance has no allergen text or display -- skipped."] };
  }

  const reaction = resource.reaction?.[0]?.description ?? resource.reaction?.[0]?.manifestation?.[0]?.text ?? null;
  const { severity, warning } = allergySeverityFromCriticality(resource.criticality);

  return {
    normalized: { allergen, reaction, severity, noted_at: resource.recordedDate ?? null },
    warnings: warning ? [warning] : [],
  };
}

// ---------------------------------------------------------------------------
// MedicationStatement / MedicationRequest -> medications
// ---------------------------------------------------------------------------

export interface IncomingMedicationStatement extends FhirResourceBase {
  status?: string;
  medicationCodeableConcept?: CodeableConcept;
  dosage?: { text?: string }[];
  dosageInstruction?: { text?: string }[];
}

const MEDICATION_ACTIVE_STATUSES = new Set(["active", "intended", "on-hold", "draft"]);

/**
 * Handles both shapes: MedicationStatement uses `dosage`, MedicationRequest
 * uses `dosageInstruction` -- otherwise identical for our purposes.
 * `medicationReference` (a pointer to a separate Medication resource,
 * rather than an inline medicationCodeableConcept) is not supported in v1;
 * such an entry is skipped with a warning rather than guessed at.
 */
export function parseMedicationStatementResource(resource: IncomingMedicationStatement): ParseResult {
  const drugName = resource.medicationCodeableConcept?.text ?? resource.medicationCodeableConcept?.coding?.[0]?.display;
  if (!drugName) {
    return {
      normalized: null,
      warnings: ["Medication resource has no medicationCodeableConcept text/display (medicationReference is not supported) -- skipped."],
    };
  }

  // Free-text dosage cannot be reliably split into separate dose/frequency
  // fields -- the whole string lands in `dose`, `frequency` stays blank for
  // a clinician to fill in on review, rather than a wrong automatic split.
  const dosageText = (resource.dosage ?? resource.dosageInstruction)?.[0]?.text ?? null;
  const isActive = resource.status ? MEDICATION_ACTIVE_STATUSES.has(resource.status) : true;

  return {
    normalized: { drug_name: drugName, dose: dosageText, frequency: null, is_active: isActive },
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Immunization -> vaccination_records
// ---------------------------------------------------------------------------

export interface IncomingImmunization extends FhirResourceBase {
  status?: string;
  vaccineCode?: CodeableConcept;
  occurrenceDateTime?: string;
  protocolApplied?: { doseNumberPositiveInt?: number }[];
}

export function parseImmunizationResource<T extends { id: string; name: string }>(
  resource: IncomingImmunization,
  catalog: T[]
): ParseResult {
  if (!resource.occurrenceDateTime) {
    return { normalized: null, warnings: ["Immunization has no occurrenceDateTime -- skipped."] };
  }

  const match = matchVaccineToCatalog(resource.vaccineCode, catalog);
  const warnings: string[] = [];
  if (!match) {
    warnings.push(
      `Could not confidently match vaccineCode ("${resource.vaccineCode?.text ?? "unlabelled"}") to a catalogue entry -- this proposal cannot be confirmed until dismissed or corrected.`
    );
  }

  return {
    normalized: {
      vaccination_catalog_id: match?.id ?? null,
      date_administered: resource.occurrenceDateTime,
      dose_number: resource.protocolApplied?.[0]?.doseNumberPositiveInt ?? 1,
      provider: null,
    },
    warnings,
  };
}
