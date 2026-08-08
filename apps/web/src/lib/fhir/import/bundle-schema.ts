import { z } from "zod";

/**
 * Body schema for POST /api/integrations/fhir/import. The envelope
 * (patient_number + bundle, rather than a bare FHIR Bundle with an
 * embedded Patient identifier) mirrors the existing
 * /api/integrations/device-readings shape -- but this is a real product
 * bet, not just plumbing: a real HMO/EMR vendor's export tooling may emit
 * something different. Adjust once a real partner's actual payload is
 * seen; this is not meant to be a frozen contract. See
 * docs/INTEGRATIONS_API.md.
 *
 * Deliberately loose on the Bundle's *contents* -- resourceType is checked
 * per-entry, but each resource is otherwise passed through untyped and
 * handed to the matching parser in ./parsers.ts, which does its own
 * field-level validation and degrades to a skip+warning rather than a
 * schema rejection when a field is missing or unrecognised. Rejecting the
 * whole Bundle for one malformed entry would throw away every resource a
 * partner DID send correctly.
 */

const MAX_BUNDLE_ENTRIES = 200;

export const patientNumberField = z
  .string()
  .trim()
  .regex(/^TH-\d{6}$/, "patient_number must look like TH-000123");

const fhirResourceSchema = z
  .object({
    resourceType: z.string().trim().min(1),
    id: z.string().trim().optional(),
  })
  .passthrough();

const bundleEntrySchema = z.object({
  fullUrl: z.string().trim().optional(),
  resource: fhirResourceSchema,
});

export const fhirBundleSchema = z.object({
  resourceType: z.literal("Bundle"),
  id: z.string().trim().optional(),
  identifier: z.object({ system: z.string().optional(), value: z.string().optional() }).optional(),
  type: z.string().trim().min(1),
  timestamp: z.string().optional(),
  // A Bundle with no entries at all is well-formed but pointless -- reject
  // it early with a clear message rather than a 200 with nothing proposed.
  entry: z
    .array(bundleEntrySchema)
    .min(1, "Bundle has no entries")
    .max(MAX_BUNDLE_ENTRIES, `Bundle exceeds the ${MAX_BUNDLE_ENTRIES}-entry import limit -- send it in smaller batches`),
});

export const fhirImportRequestSchema = z.object({
  patient_number: patientNumberField,
  source_system: z.string().trim().max(200).optional(),
  bundle: fhirBundleSchema,
});

export type FhirImportRequest = z.infer<typeof fhirImportRequestSchema>;
