import { z } from "zod";

/**
 * S54c: the care team suggests a pharmacy; the patient confirms. Shapes only, no I/O.
 *
 * What a clinician is shown is deliberately NEUTRAL (spec 8.16): the pharmacy, how near it is, whether the medicines are in stock and that it is
 * verified. There is no price, ranking or earning anywhere in these types, and the schemas are strict so a column added to the database
 * function later cannot slip onto the screen without somebody changing this file on purpose.
 */
export const PROXIMITY = ["same_city", "same_state", "unknown"] as const;
export const IN_STOCK = ["yes", "no", "unknown"] as const;

export const optionSchema = z
  .object({
    partner_id: z.string().uuid(),
    partner_name: z.string(),
    location_id: z.string().uuid(),
    location_name: z.string(),
    address: z.string().nullable(),
    state: z.string().nullable(),
    proximity: z.enum(PROXIMITY),
    in_stock: z.enum(IN_STOCK),
    listable: z.boolean(),
  })
  .strict();
export type PharmacyOption = z.infer<typeof optionSchema>;
export const optionRowsSchema = z.array(optionSchema);

export const routingRowSchema = z
  .object({
    prescription_id: z.string().uuid(),
    rx_state: z.string(),
    item_summary: z.string().nullable(),
    signed_at: z.string().nullable(),
    suggestion_id: z.string().uuid().nullable(),
    suggestion_status: z.string().nullable(),
    suggested_partner_name: z.string().nullable(),
    suggested_location_name: z.string().nullable(),
    suggested_at: z.string().nullable(),
    suggested_by_me: z.boolean().nullable(),
    patient_can_confirm: z.boolean().nullable(),
  })
  .strict();
export type RoutingRow = z.infer<typeof routingRowSchema>;
export const routingRowsSchema = z.array(routingRowSchema);

export const suggestFormSchema = z.object({
  patientId: z.string().uuid(),
  prescriptionId: z.string().uuid(),
  partnerId: z.string().uuid(),
  locationId: z.string().uuid(),
});
export const withdrawFormSchema = z.object({ patientId: z.string().uuid(), suggestionId: z.string().uuid() });

export const proximityLabel: Record<(typeof PROXIMITY)[number], string> = {
  same_city: "Same city as the patient",
  same_state: "Same state as the patient",
  unknown: "Distance not known",
};
export const stockLabel: Record<(typeof IN_STOCK)[number], string> = {
  yes: "Medicines in stock",
  no: "Some medicines not listed or not in stock",
  unknown: "Stock not confirmed",
};
export const statusLabel: Record<string, string> = {
  pending: "Waiting for the patient to confirm",
  accepted: "The patient confirmed it",
  declined: "The patient said no thanks",
  chose_other: "The patient chose a different pharmacy",
  withdrawn: "Withdrawn",
  unavailable: "That pharmacy can no longer be offered, so the patient is not being shown it",
  lapsed: "No longer needed",
};
