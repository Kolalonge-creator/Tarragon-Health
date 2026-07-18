import { z } from "zod";

export const createAddOnSchema = z.object({
  code: z
    .string()
    .min(2, "Code must be at least 2 characters")
    // Widened from hyphens-only to also allow underscores — diaspora rows
    // append a _usd/_gbp suffix to the base NGN code (e.g. care-coordinator_usd).
    .regex(/^[a-z0-9_-]+$/, "Lowercase letters, numbers, hyphens, underscores only"),
  name: z.string().min(2, "Name is required"),
  description: z.string().optional(),
  price_amount: z.coerce.number().int().min(0, "Price can't be negative"),
  currency: z.enum(["NGN", "GBP", "USD"]).default("NGN"),
  interval: z.enum(["monthly", "yearly"]),
  restricted_to_plan_code: z.string().optional(), // "" means unrestricted
  features: z.string().optional(),
});

export type CreateAddOnInput = z.infer<typeof createAddOnSchema>;
