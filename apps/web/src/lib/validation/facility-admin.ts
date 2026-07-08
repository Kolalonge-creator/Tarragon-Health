import { z } from "zod";

export const FACILITY_TYPES = [
  "hospital",
  "lab",
  "pharmacy",
  "radiology",
  "optician",
  "vaccination_centre",
] as const;

export const facilitySchema = z.object({
  name: z.string().trim().min(1, "Enter a facility name").max(200),
  type: z.enum(FACILITY_TYPES),
  state: z.string().trim().min(1, "Enter a state"),
  city: z.string().trim().min(1, "Enter a city"),
  contact_phone: z
    .string()
    .trim()
    .regex(/^\+[1-9][0-9]{7,14}$/, "Use E.164 format, e.g. +2348012345678")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  contact_email: z
    .string()
    .trim()
    .email("Enter a valid email")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  address: z.string().trim().max(500).optional(),
});
export type FacilityInput = z.infer<typeof facilitySchema>;

export const facilityServiceSchema = z.object({
  facility_id: z.string().uuid(),
  name: z.string().trim().min(1, "Enter a service name").max(200),
  description: z.string().trim().max(500).optional(),
  price_kobo: z.coerce.number().int().min(0).optional(),
});
export type FacilityServiceInput = z.infer<typeof facilityServiceSchema>;
