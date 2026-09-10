import { z } from "zod";
import { E164_GENERIC } from "@tarragon/shared";

/**
 * Guest checkout collects less than signup does (no password, no state) —
 * the account this provisions is passwordless and the guest can add
 * anything else later from inside the app once they're in. Phone is
 * optional: unlike signup, nothing here depends on it (no SMS OTP flow to
 * fall back to), so it is asked for only because a doctor reviewing a
 * consult/result may want a fallback contact.
 */
export const guestCheckoutSchema = z.object({
  fullName: z.string().trim().min(1, "Enter your full name"),
  email: z.email("Enter a valid email address"),
  countryCode: z
    .string()
    .regex(/^\+\d{1,4}$/, "Select a country code")
    .optional()
    .or(z.literal("")),
  phone: z
    .string()
    .trim()
    .regex(/^\d{6,14}$/, "Enter a valid phone number")
    .optional()
    .or(z.literal("")),
});

export type GuestCheckoutInput = z.infer<typeof guestCheckoutSchema>;

/** Combines countryCode+phone into E.164 the way phoneOtpRequestSchema does,
 * and drops it entirely if either half was left blank rather than failing —
 * phone is optional here, unlike login/signup's phone tab. */
export function combineGuestPhone(input: GuestCheckoutInput): string | null {
  if (!input.countryCode || !input.phone) return null;
  const combined = `${input.countryCode}${input.phone}`;
  return E164_GENERIC.test(combined) ? combined : null;
}
