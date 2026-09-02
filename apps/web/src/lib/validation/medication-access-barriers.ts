import { z } from "zod";

/** Medication safety pathway 64.21 — structured, not free text, so this is
 * countable population-health data rather than a pile of prose. */
export const MEDICATION_ACCESS_BARRIER_REASONS = [
  "unavailable",
  "expensive",
  "pharmacy_too_far",
  "delivery_unavailable",
  "forgot",
  "side_effects",
  "didnt_understand_instructions",
] as const;

export const medicationAccessBarrierSchema = z.object({
  medication_id: z.string().uuid(),
  reason: z.enum(MEDICATION_ACCESS_BARRIER_REASONS),
  note: z.string().trim().max(500).optional(),
});
export type MedicationAccessBarrierInput = z.infer<typeof medicationAccessBarrierSchema>;
