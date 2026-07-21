import { z } from "zod";

/**
 * Input for the bulk price adjustment (annual inflation review) admin tool.
 * Percent is deliberately bounded: a yearly inflation pass is 5–30%, so
 * anything beyond ±50%/100% is almost certainly a typo.
 */
export const priceAdjustmentSchema = z
  .object({
    percent: z.coerce
      .number()
      .finite()
      .gte(-50, "Decreases beyond 50% look like a typo")
      .lte(100, "Increases beyond 100% look like a typo")
      .refine((value) => value !== 0, "Percent cannot be zero"),
    currency: z.enum(["ALL", "NGN", "GBP", "USD"]).default("ALL"),
    includePlans: z.coerce.boolean().default(true),
    includeAddOns: z.coerce.boolean().default(true),
    includeInactive: z.coerce.boolean().default(false),
  })
  .refine((value) => value.includePlans || value.includeAddOns, {
    message: "Select plans, add-ons, or both",
  });

export type PriceAdjustmentInput = z.infer<typeof priceAdjustmentSchema>;
