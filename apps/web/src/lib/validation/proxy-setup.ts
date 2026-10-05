import { z } from "zod";
import { Constants, E164_GENERIC } from "@tarragon/shared";
import { normalisePhoneWithCountry } from "@tarragon/auth/phone";

/** Every category a parent can choose to share. The list is the database enum, so a new category appears here without a code change. */
export const CARE_ACCESS_CATEGORIES = Constants.public.Enums.care_access_category;

export const proxySetupSchema = z
  .object({
    fullName: z.string().trim().min(1, "Enter your parent's name").max(200, "That name is too long"),
    countryCode: z.string().regex(/^\+\d{1,4}$/, "Select a country code"),
    phone: z.string().trim().min(1, "Enter your parent's phone number").max(24, "Enter a valid phone number"),
  })
  .transform((data) => {
    const result = normalisePhoneWithCountry(data.countryCode, data.phone);
    return { fullName: data.fullName, phone: result.ok ? result.e164 : "" };
  })
  .refine((data) => E164_GENERIC.test(data.phone), { message: "Enter a valid phone number", path: ["phone"] });

/** What the parent submits on the confirmation card. Categories not in the enum are rejected, never ignored. */
export const proxyConfirmSchema = z.object({
  setupId: z.uuid(),
  categories: z.array(z.enum(CARE_ACCESS_CATEGORIES)).max(CARE_ACCESS_CATEGORIES.length),
  password: z.string().max(200).optional(),
});

export const proxyDeclineSchema = z.object({ setupId: z.uuid() });
