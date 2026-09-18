import { z } from "zod";

/**
 * A deliberately loose FHIR R4 Bundle shape -- just enough structure
 * (resourceType, entry[].resource.resourceType) for the import route to
 * route each entry to the right parser. Anything beyond that is read
 * defensively inside each per-resource parser (fhir-parsers.ts), never
 * assumed here -- a partner's Bundle is untrusted input, and FHIR's own
 * spec allows far more optionality per resource than any one platform ever
 * needs to consume.
 */
const fhirCodingSchema = z.object({
  system: z.string().optional(),
  code: z.string().optional(),
  display: z.string().optional(),
});

const fhirCodeableConceptSchema = z.object({
  coding: z.array(fhirCodingSchema).optional(),
  text: z.string().optional(),
});

const fhirQuantitySchema = z.object({
  value: z.number().optional(),
  unit: z.string().optional(),
  code: z.string().optional(),
});

const fhirObservationComponentSchema = z.object({
  code: fhirCodeableConceptSchema.optional(),
  valueQuantity: fhirQuantitySchema.optional(),
});

export const fhirResourceSchema = z
  .object({
    resourceType: z.string(),
    id: z.string().optional(),
    status: z.string().optional(),
    code: fhirCodeableConceptSchema.optional(),
    valueQuantity: fhirQuantitySchema.optional(),
    component: z.array(fhirObservationComponentSchema).optional(),
    effectiveDateTime: z.string().optional(),
    issued: z.string().optional(),
    // AllergyIntolerance
    reaction: z
      .array(
        z.object({
          manifestation: z.array(fhirCodeableConceptSchema).optional(),
          severity: z.string().optional(),
        })
      )
      .optional(),
    onsetDateTime: z.string().optional(),
    recordedDate: z.string().optional(),
    // MedicationStatement / MedicationRequest
    medicationCodeableConcept: fhirCodeableConceptSchema.optional(),
    dosage: z.array(z.object({ text: z.string().optional() })).optional(),
    dosageInstruction: z.array(z.object({ text: z.string().optional() })).optional(),
    // Immunization
    vaccineCode: fhirCodeableConceptSchema.optional(),
    occurrenceDateTime: z.string().optional(),
    protocolApplied: z.array(z.object({ doseNumberPositiveInt: z.number().optional() })).optional(),
    performer: z
      .array(z.object({ actor: z.object({ display: z.string().optional() }).optional() }))
      .optional(),
  })
  .passthrough();
export type FhirResource = z.infer<typeof fhirResourceSchema>;

export const fhirBundleSchema = z.object({
  resourceType: z.literal("Bundle"),
  id: z.string().optional(),
  identifier: z.object({ value: z.string().optional() }).optional(),
  entry: z
    .array(
      z.object({
        resource: fhirResourceSchema.optional(),
      })
    )
    .default([]),
});
export type FhirBundle = z.infer<typeof fhirBundleSchema>;
