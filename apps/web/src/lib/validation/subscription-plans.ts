import { z } from "zod";

export const createPlanSchema = z.object({
  code: z
    .string()
    .min(2, "Code must be at least 2 characters")
    .regex(/^[a-z0-9_]+$/, "Lowercase letters, numbers, underscores only"),
  name: z.string().min(2, "Name is required"),
  description: z.string().optional(),
  // Whole-unit amount (naira/dollars/pounds) — converted to minor units via
  // toMinorUnits(price_amount, currency) by the caller.
  price_amount: z.coerce.number().int().min(0, "Price can't be negative"),
  currency: z.enum(["NGN", "GBP", "USD"]).default("NGN"),
  interval: z.enum(["monthly", "yearly"]),
  features: z.string().optional(), // comma-separated, parsed by the caller
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
