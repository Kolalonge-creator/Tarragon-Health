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

export function loadFhirMapping(asOf?: string): LoadedFhirMapping {
  const entry = getProposedConfig("fhir.mapping", asOf);
  return { mapping: mappingSchema.parse(entry.value), version: entry.version, status: entry.status };
}
