import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import type { FhirResource } from "./bundle-schema";

/**
 * Parser version stamped on every fhir_import_proposed_resources row
 * (parser_version, not-null per the migration). Bump this whenever the
 * mapping logic below changes meaningfully — it is the seam a future
 * reviewer uses to tell "this proposal was parsed by an older, possibly
 * different rule set" apart from a fresh one, same idea as the wearables
 * field-mapping note in CLAUDE.md.
 */
export const FHIR_PARSER_VERSION = 1;

export type SupportedFhirResourceType =
  Database["public"]["Enums"]["fhir_import_resource_type"];

const SUPPORTED_RESOURCE_TYPES: readonly SupportedFhirResourceType[] = [
  "Observation",
  "AllergyIntolerance",
  "MedicationStatement",
  "MedicationRequest",
  "Immunization",
];

export function isSupportedResourceType(resourceType: string): resourceType is SupportedFhirResourceType {
  return (SUPPORTED_RESOURCE_TYPES as readonly string[]).includes(resourceType);
}

export interface ParsedProposal {
  resourceType: SupportedFhirResourceType;
  fhirResourceId: string | null;
  normalizedPayload: Record<string, unknown>;
  parseWarnings: string[];
}

export interface SkippedEntry {
  resourceType: string;
  reason: string;
}

export type ParseResult = { ok: true; proposal: ParsedProposal } | { ok: false; skip: SkippedEntry };

function codingCode(concept: FhirResource["code"] | undefined): string | null {
  return concept?.coding?.find((c) => c.code)?.code ?? null;
}

function conceptText(concept: { coding?: { display?: string }[]; text?: string } | undefined): string | null {
  return concept?.text ?? concept?.coding?.[0]?.display ?? null;
}

// Common LOINC codes for the vital signs vitals_readings already supports.
// Deliberately narrow, matching the same "record what we don't recognise,
// never guess" posture as the resource-type allow-list itself — an
// unrecognised code produces a skip, not a wrong reading.
const OBSERVATION_LOINC_VITAL_TYPE: Record<string, Database["public"]["Enums"]["vital_type"]> = {
  "8867-4": "pulse",
  "2339-0": "glucose",
  "41653-7": "glucose",
  "15074-8": "glucose",
  "14749-6": "glucose",
  "29463-7": "weight",
  "3141-9": "weight",
  "8310-5": "temperature",
  "8331-1": "temperature",
  "59408-5": "spo2",
  "2708-6": "spo2",
  "56086-2": "waist_circumference",
  "8280-0": "waist_circumference",
  "9279-1": "respiratory_rate",
  "33452-4": "peak_flow",
  "19935-6": "peak_flow",
};
const BP_PANEL_LOINC = "85354-9";
const SYSTOLIC_LOINC = "8480-6";
const DIASTOLIC_LOINC = "8462-4";

function parseObservation(resource: FhirResource): ParseResult {
  const warnings: string[] = [];
  const taken_at = resource.effectiveDateTime ?? resource.issued ?? null;
  if (!taken_at) {
    return { ok: false, skip: { resourceType: "Observation", reason: "No effectiveDateTime/issued — cannot date the reading" } };
  }

  const code = codingCode(resource.code);

  if (code === BP_PANEL_LOINC || resource.component?.length) {
    const systolicComp = resource.component?.find((c) => codingCode(c.code) === SYSTOLIC_LOINC);
    const diastolicComp = resource.component?.find((c) => codingCode(c.code) === DIASTOLIC_LOINC);
    const systolic = systolicComp?.valueQuantity?.value;
    const diastolic = diastolicComp?.valueQuantity?.value;
    if (systolic != null && diastolic != null) {
      return {
        ok: true,
        proposal: {
          resourceType: "Observation",
          fhirResourceId: resource.id ?? null,
          normalizedPayload: { vital_type: "blood_pressure", taken_at, systolic, diastolic },
          parseWarnings: warnings,
        },
      };
    }
  }

  if (!code || !(code in OBSERVATION_LOINC_VITAL_TYPE)) {
    return {
      ok: false,
      skip: {
        resourceType: "Observation",
        reason: code
          ? `Unrecognised LOINC code ${code} — no matching vital_type on this platform`
          : "Observation has no coded LOINC value — cannot classify",
      },
    };
  }

  const vital_type = OBSERVATION_LOINC_VITAL_TYPE[code];
  const value = resource.valueQuantity?.value;
  if (value == null) {
    return { ok: false, skip: { resourceType: "Observation", reason: `No valueQuantity for LOINC ${code}` } };
  }

  const normalizedPayload: Record<string, unknown> = { vital_type, taken_at };
  switch (vital_type) {
    case "glucose":
      normalizedPayload.glucose_mmol_l = value;
      // FHIR carries no reliable standard field for fasting/random/post-meal
      // context across partners — defaulting rather than guessing, flagged
      // so a reviewing clinician sees it before confirming.
      normalizedPayload.glucose_context = "random";
      warnings.push("glucose_context defaulted to 'random' — the source Observation carried no fasting/post-meal timing");
      break;
    case "weight":
      normalizedPayload.weight_kg = value;
      break;
    case "temperature":
      normalizedPayload.temperature_c = value;
      break;
    case "spo2":
      normalizedPayload.spo2_pct = value;
      break;
    case "waist_circumference":
      normalizedPayload.waist_cm = value;
      break;
    case "pulse":
      normalizedPayload.pulse_bpm = value;
      break;
    default:
      // respiratory_rate/peak_flow have no dedicated vitals_readings column
      // yet (see CLAUDE.md's device-integration section) — recognised as a
      // vital_type but with nowhere to land the actual number, so skip
      // rather than propose a resource confirm would fail to write.
      return {
        ok: false,
        skip: { resourceType: "Observation", reason: `vital_type '${vital_type}' has no matching vitals_readings column yet` },
      };
  }

  return {
    ok: true,
    proposal: { resourceType: "Observation", fhirResourceId: resource.id ?? null, normalizedPayload, parseWarnings: warnings },
  };
}

const FHIR_TO_ALLERGY_SEVERITY: Record<string, Database["public"]["Enums"]["allergy_severity"]> = {
  mild: "mild",
  moderate: "moderate",
  severe: "severe",
};

function parseAllergyIntolerance(resource: FhirResource): ParseResult {
  const warnings: string[] = [];
  const allergen = conceptText(resource.code);
  if (!allergen) {
    return { ok: false, skip: { resourceType: "AllergyIntolerance", reason: "No code.text/coding[].display to use as the allergen name" } };
  }

  const reactionEntry = resource.reaction?.[0];
  const reaction = reactionEntry?.manifestation?.[0] ? conceptText(reactionEntry.manifestation[0]) : null;
  const rawSeverity = reactionEntry?.severity?.toLowerCase();
  let severity: Database["public"]["Enums"]["allergy_severity"] = "moderate";
  if (rawSeverity && rawSeverity in FHIR_TO_ALLERGY_SEVERITY) {
    severity = FHIR_TO_ALLERGY_SEVERITY[rawSeverity];
  } else {
    warnings.push(`severity defaulted to 'moderate' — source reaction.severity was ${rawSeverity ? `unrecognised ('${rawSeverity}')` : "absent"}`);
  }

  const noted_at = resource.onsetDateTime ?? resource.recordedDate ?? null;

  return {
    ok: true,
    proposal: {
      resourceType: "AllergyIntolerance",
      fhirResourceId: resource.id ?? null,
      normalizedPayload: { allergen, reaction: reaction ?? "Not specified in source record", severity, noted_at },
      parseWarnings: warnings,
    },
  };
}

function parseMedication(resource: FhirResource, resourceType: "MedicationStatement" | "MedicationRequest"): ParseResult {
  const warnings: string[] = [];
  const drug_name = conceptText(resource.medicationCodeableConcept);
  if (!drug_name) {
    return { ok: false, skip: { resourceType, reason: "No medicationCodeableConcept.text/coding[].display — cannot identify the drug" } };
  }

  const dosageText = resource.dosage?.[0]?.text ?? resource.dosageInstruction?.[0]?.text ?? null;
  if (!dosageText) {
    warnings.push("No dosage/dosageInstruction text in the source resource — dose and frequency left blank for the reviewing clinician to fill in");
  }

  const is_active = resource.status ? ["active", "intended", "in-progress"].includes(resource.status) : true;

  return {
    ok: true,
    proposal: {
      resourceType,
      fhirResourceId: resource.id ?? null,
      normalizedPayload: { drug_name, dose: dosageText, frequency: dosageText, is_active },
      parseWarnings: warnings,
    },
  };
}

async function parseImmunization(
  resource: FhirResource,
  supabase: SupabaseClient<Database>
): Promise<ParseResult> {
  const vaccineText = conceptText(resource.vaccineCode);
  const vaccineCode = codingCode(resource.vaccineCode);
  if (!vaccineText && !vaccineCode) {
    return { ok: false, skip: { resourceType: "Immunization", reason: "No vaccineCode.text/coding — cannot identify the vaccine" } };
  }

  // Best-effort match against this platform's own catalogue: an Immunization
  // has nowhere valid to land without a real vaccination_catalog_id (the FK
  // is NOT NULL) — see the "never propose what confirm can't write" rule in
  // the migration header. No match means a clean skip, never a guess.
  let catalogQuery = supabase.from("vaccination_catalog").select("id").eq("is_active", true).limit(1);
  catalogQuery = vaccineCode ? catalogQuery.eq("code", vaccineCode) : catalogQuery.ilike("name", `%${vaccineText}%`);
  const { data: catalogMatch } = await catalogQuery.maybeSingle();

  if (!catalogMatch) {
    return {
      ok: false,
      skip: {
        resourceType: "Immunization",
        reason: `No matching entry in this platform's vaccination catalogue for '${vaccineText ?? vaccineCode}'`,
      },
    };
  }

  const date_administered = resource.occurrenceDateTime ?? null;
  if (!date_administered) {
    return { ok: false, skip: { resourceType: "Immunization", reason: "No occurrenceDateTime — cannot date the dose" } };
  }

  const dose_number = resource.protocolApplied?.[0]?.doseNumberPositiveInt ?? 1;
  const provider = resource.performer?.[0]?.actor?.display ?? null;

  return {
    ok: true,
    proposal: {
      resourceType: "Immunization",
      fhirResourceId: resource.id ?? null,
      normalizedPayload: { vaccination_catalog_id: catalogMatch.id, dose_number, date_administered, provider },
      parseWarnings: [],
    },
  };
}

/**
 * Routes one Bundle entry to its per-resource-type parser. Returns a skip
 * (never throws) for anything unsupported or unparseable — the caller
 * records every skip in fhir_import_batches.skip_reasons so nothing a
 * partner sends is ever silently dropped, matching the same discipline the
 * schema migration's own header documents.
 */
export async function parseFhirResourceEntry(
  resource: FhirResource,
  supabase: SupabaseClient<Database>
): Promise<ParseResult> {
  if (!isSupportedResourceType(resource.resourceType)) {
    return {
      ok: false,
      skip: { resourceType: resource.resourceType, reason: "resourceType is outside the v1 import allow-list (Observation/AllergyIntolerance/MedicationStatement/MedicationRequest/Immunization)" },
    };
  }

  switch (resource.resourceType) {
    case "Observation":
      return parseObservation(resource);
    case "AllergyIntolerance":
      return parseAllergyIntolerance(resource);
    case "MedicationStatement":
      return parseMedication(resource, "MedicationStatement");
    case "MedicationRequest":
      return parseMedication(resource, "MedicationRequest");
    case "Immunization":
      return parseImmunization(resource, supabase);
  }
}
