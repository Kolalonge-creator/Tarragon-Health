import { z } from "zod";

export const createAddOnSchema = z.object({
  code: z
    .string()
    .min(2, "Code must be at least 2 characters")
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, hyphens only"),
  name: z.string().min(2, "Name is required"),
  description: z.string().optional(),
  price_naira: z.coerce.number().int().min(0, "Price can't be negative"),
  interval: z.enum(["monthly", "yearly"]),
  restricted_to_plan_code: z.string().optional(), // "" means unrestricted
  features: z.string().optional(),
});

export type CreateAddOnInput = z.infer<typeof createAddOnSchema>;
