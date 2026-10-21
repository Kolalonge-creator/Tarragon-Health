import { getProposedConfig } from "@tarragon/shared";
import { z } from "zod";

/**
 * The FHIR mapping configuration (S44). It is versioned data in the PROPOSED-config registry (`fhir.mapping`), read here and validated, so
 * a mapping change is a reviewed new version and never an edit scattered through the code. The Nigeria Core and NPHCDA implementation
 * guides are under development: `profiles` is empty and no profile URL is claimed until a version adds one.
 */
const vitalCodeSchema = z.object({
  loinc: z.string(),
  display: z.string(),
  systolic: z.string().optional(),
  diastolic: z.string().optional(),
});

const mappingSchema = z.object({
  ig_status: z.string(),
  base_url: z.string(),
  profiles: z.record(z.string(), z.array(z.string())),
  systems: z.object({
    loinc: z.string(),
    ucum: z.string(),
    icd10: z.string(),
    snomed: z.string(),
    observation_category: z.string(),
    interpretation: z.string(),
    condition_clinical: z.string(),
    condition_verification: z.string(),
    patient_number: z.string(),
    lab_analyte: z.string(),
    vaccine: z.string(),
    document_type: z.string(),
    record_source: z.string(),
    data_quality: z.string(),
  }),
  vitals: z.record(z.string(), vitalCodeSchema),
  lab_analyte_loinc: z.record(z.string(), z.string()),
});

export type FhirMapping = z.infer<typeof mappingSchema>;

export interface LoadedFhirMapping {
  mapping: FhirMapping;
  version: number;
  status: "proposed" | "confirmed";
}

/**
 * The International Patient Summary shape (`fhir.ips_mapping`). Versioned PROPOSED data: section codes, the document type, the empty-section
 * reason. It claims no implementation-guide profile (see the registry comment).
 */
const ipsSectionSchema = z.object({
  key: z.enum(["problems", "allergies", "medications", "immunizations", "results", "vital_signs"]),
  loinc: z.string(),
  display: z.string(),
  title: z.string(),
  required: z.boolean(),
});

const ipsMappingSchema = z.object({
  ig_status: z.string(),
  profiles: z.record(z.string(), z.array(z.string())),
  composition_type: z.object({ system: z.string(), code: z.string(), display: z.string() }),
  title: z.string(),
  author_name: z.string(),
  composition_status: z.enum(["preliminary", "final", "amended"]),
  document_identifier_system: z.string(),
  empty_reason_system: z.string(),
  empty_reason_code: z.string(),
  withheld_reason_code: z.string(),
  vitals_per_type: z.number().int().positive(),
  results_per_analyte: z.number().int().positive(),
  sections: z.array(ipsSectionSchema),
});

export type IpsMapping = z.infer<typeof ipsMappingSchema>;
export type IpsSectionKey = z.infer<typeof ipsSectionSchema>["key"];

export interface LoadedIpsMapping {
  ips: IpsMapping;
  version: number;
  status: "proposed" | "confirmed";
}

export function loadIpsMapping(asOf?: string): LoadedIpsMapping {
  const entry = getProposedConfig("fhir.ips_mapping", asOf);
  return { ips: ipsMappingSchema.parse(entry.value), version: entry.version, status: entry.status };
}

export function loadFhirMapping(asOf?: string): LoadedFhirMapping {
  const entry = getProposedConfig("fhir.mapping", asOf);
  return { mapping: mappingSchema.parse(entry.value), version: entry.version, status: entry.status };
}
