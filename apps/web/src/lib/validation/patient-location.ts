import { z } from "zod";

/**
 * Patient's saved location, used to pre-fill the "choose a facility near me"
 * pickers (labs, vaccination centres, pharmacies). All optional — an empty
 * field clears that part of the saved location; nothing is inferred.
 */
export const patientLocationSchema = z.object({
  state: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  area: z.string().trim().max(100).optional(),
});
export type PatientLocationInput = z.infer<typeof patientLocationSchema>;
