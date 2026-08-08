import type { z } from "zod";
import type { fhirBundleSchema } from "./bundle-schema";
import {
  parseObservationResource,
  parseAllergyIntoleranceResource,
  parseMedicationStatementResource,
  parseImmunizationResource,
  type IncomingObservation,
  type IncomingAllergyIntolerance,
  type IncomingMedicationStatement,
  type IncomingImmunization,
} from "./parsers";

/** Bumped whenever a parser's mapping logic changes -- lets a later review
 * distinguish "the source data was wrong" from "an older parser version
 * produced something we no longer would." Same audit reasoning as
 * case_review_actions.engine_version. */
export const PARSER_VERSION = 1;

export type ImportResourceType = "Observation" | "AllergyIntolerance" | "MedicationStatement" | "MedicationRequest" | "Immunization";

const SUPPORTED_RESOURCE_TYPES: ReadonlySet<string> = new Set<ImportResourceType>([
  "Observation",
  "AllergyIntolerance",
  "MedicationStatement",
  "MedicationRequest",
  "Immunization",
]);

export interface ParsedProposal {
  resource_type: ImportResourceType;
  fhir_resource_id: string | null;
  raw_resource: Record<string, unknown>;
  normalized_payload: Record<string, unknown>;
  parse_warnings: string[];
}

export interface SkippedEntry {
  resourceType: string;
  resourceId: string | null;
  reason: string;
}

export interface ParsedBundle {
  proposals: ParsedProposal[];
  skipped: SkippedEntry[];
}

type FhirBundle = z.infer<typeof fhirBundleSchema>;
type FhirEntryResource = FhirBundle["entry"][number]["resource"];

/**
 * Pure orchestrator: a validated Bundle -> proposals ready to insert plus a
 * tally of what was out of scope. No DB access -- the import route calls
 * this after validating the request body and loading the org's vaccination
 * catalogue, then persists the result.
 */
export function parseFhirImportBundle(
  bundle: FhirBundle,
  vaccinationCatalog: { id: string; name: string }[]
): ParsedBundle {
  const proposals: ParsedProposal[] = [];
  const skipped: SkippedEntry[] = [];

  for (const entry of bundle.entry) {
    const resource = entry.resource;
    const resourceType = resource.resourceType;
    const resourceId = resource.id ?? null;

    if (!SUPPORTED_RESOURCE_TYPES.has(resourceType)) {
      skipped.push({
        resourceType,
        resourceId,
        reason: `${resourceType} is not in the v1 import allow-list (Observation, AllergyIntolerance, MedicationStatement, MedicationRequest, Immunization).`,
      });
      continue;
    }

    const { normalized, warnings } = parseOneResource(resource, resourceType, vaccinationCatalog);

    if (!normalized) {
      skipped.push({ resourceType, resourceId, reason: warnings[0] ?? `${resourceType} could not be parsed.` });
      continue;
    }

    proposals.push({
      resource_type: resourceType as ImportResourceType,
      fhir_resource_id: resourceId,
      raw_resource: resource as unknown as Record<string, unknown>,
      normalized_payload: normalized,
      parse_warnings: warnings,
    });
  }

  return { proposals, skipped };
}

function parseOneResource(
  resource: FhirEntryResource,
  resourceType: string,
  vaccinationCatalog: { id: string; name: string }[]
): { normalized: Record<string, unknown> | null; warnings: string[] } {
  switch (resourceType) {
    case "Observation":
      return parseObservationResource(resource as unknown as IncomingObservation);
    case "AllergyIntolerance":
      return parseAllergyIntoleranceResource(resource as unknown as IncomingAllergyIntolerance);
    case "MedicationStatement":
    case "MedicationRequest":
      return parseMedicationStatementResource(resource as unknown as IncomingMedicationStatement);
    case "Immunization":
      return parseImmunizationResource(resource as unknown as IncomingImmunization, vaccinationCatalog);
    default:
      return { normalized: null, warnings: [`Unhandled resource type ${resourceType}.`] };
  }
}
