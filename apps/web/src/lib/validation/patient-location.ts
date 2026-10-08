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
  // S41 (spec 1.9): local government area. Empty clears it; otherwise 2 to 60 characters, matching profiles_lga_length.
  lga: z.union([z.literal(""), z.string().trim().min(2, "Enter at least 2 letters for your local government area").max(60)]).optional(),
});
export type PatientLocationInput = z.infer<typeof patientLocationSchema>;
