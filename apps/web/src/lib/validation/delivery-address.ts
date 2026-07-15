import { z } from "zod";
import { E164_NG } from "@tarragon/shared";

/**
 * Patient-entered pharmacy delivery address. There is no profiles.state/
 * region field anywhere in this codebase (confirmed via grep) — same
 * precedent as the referral-matching feature's manual state entry — so this
 * is captured directly on the order at delivery-address-set time, not read
 * from a stored patient field. Validated here (API/RPC layer), not via a
 * DB-level CHECK constraint on the jsonb shape, consistent with how
 * pharmacy_orders.items is already handled with no CHECK.
 */
export const deliveryAddressSchema = z.object({
  street: z.string().trim().min(3, "Enter a street address").max(200),
  area: z.string().trim().min(2, "Enter an area or neighbourhood").max(120),
  state: z.string().trim().min(2, "Enter a state or LGA").max(120),
  phone: z
    .string()
    .trim()
    .regex(E164_NG, "Enter a valid Nigerian phone number, e.g. +2348012345678"),
});

export type DeliveryAddress = z.infer<typeof deliveryAddressSchema>;
