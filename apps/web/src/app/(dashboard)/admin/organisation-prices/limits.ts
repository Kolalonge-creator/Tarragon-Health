import { z } from "zod";
import { getProposedConfig } from "@tarragon/shared";

const limitsShape = z.object({ min_kobo: z.number().int().positive(), max_kobo: z.number().int().positive() });
/** The floor and ceiling a typed price must sit inside. PROPOSED config (commerce.organisation_member_price_limits); the database enforces the same band. */
export function organisationPriceLimits(): { minKobo: number; maxKobo: number } {
  const v = limitsShape.parse(getProposedConfig("commerce.organisation_member_price_limits").value);
  return { minKobo: v.min_kobo, maxKobo: v.max_kobo };
}
