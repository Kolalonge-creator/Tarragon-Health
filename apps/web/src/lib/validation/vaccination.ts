import { z } from "zod";

export const logVaccinationSchema = z.object({
  vaccination_catalog_id: z.string().uuid(),
  dose_number: z.coerce.number().int().min(1).max(20),
  date_administered: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Enter a valid date" }),
  provider: z.string().trim().max(200).optional(),
});
export type LogVaccinationInput = z.infer<typeof logVaccinationSchema>;
