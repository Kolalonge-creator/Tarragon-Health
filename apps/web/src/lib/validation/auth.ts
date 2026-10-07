import { z } from "zod";
import { E164_GENERIC } from "@tarragon/shared";
import { normalisePhoneWithCountry } from "@tarragon/auth/phone";
import { PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT_MESSAGE } from "./password";

export { emailLoginSchema, type EmailLoginInput, mfaCodeSchema, type MfaCodeInput } from "@tarragon/auth/credentials";

const PHONE_INVALID_MESSAGE = "Enter a valid phone number for the selected country";

// The national number is free text on purpose: people type "0803 123 4567", "803-123-4567" or paste the
// whole "+2348031234567". normalisePhoneWithCountry (S03) turns every one of those into the same E.164 value,
// including the stray-zero typo "+2340803...", so a code never goes to a different number than intended.
const phoneCombineSchema = z.object({
  countryCode: z.string().regex(/^\+\d{1,4}$/, "Select a country code"),
  phone: z.string().trim().min(1, "Enter your phone number").max(24, "Enter a valid phone number"),
});

/** Normalised E.164 or "" when the pair cannot be a real number (the refine below turns "" into the error). */
function toE164(countryCode: string, phone: string): string {
  const result = normalisePhoneWithCountry(countryCode, phone);
  return result.ok ? result.e164 : "";
}

export const phoneOtpRequestSchema = phoneCombineSchema
  .transform((data) => ({ phone: toE164(data.countryCode, data.phone) }))
  .refine((data) => E164_GENERIC.test(data.phone), {
    message: PHONE_INVALID_MESSAGE,
    path: ["phone"],
  });
export type PhoneOtpRequestInput = z.infer<typeof phoneOtpRequestSchema>;

export const phoneOtpVerifySchema = z.object({
  phone: z.string().regex(E164_GENERIC, "Enter a valid phone number"),
  token: z.string().length(6, "Enter the 6-digit code"),
});
export type PhoneOtpVerifyInput = z.infer<typeof phoneOtpVerifySchema>;

export const passwordResetEmailSchema = z.object({
  email: z.email(),
});
export type PasswordResetEmailInput = z.infer<typeof passwordResetEmailSchema>;


export const newPasswordSchema = z
  .object({
    password: z.string().min(PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT_MESSAGE),
    confirmPassword: z.string().min(PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT_MESSAGE),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type NewPasswordInput = z.infer<typeof newPasswordSchema>;

const signupObject = z
  .object({
    firstName: z.string().trim().min(1, "Enter your first name"),
    lastName: z.string().trim().min(1, "Enter your last name"),
    email: z.email(),
    // Country code (e.g. "+234") and local subscriber number are collected
    // as separate fields so diaspora family members without a Nigerian
    // number can still register for a family package; combined below.
    countryCode: z.string().regex(/^\+\d{1,4}$/, "Select a country code"),
    phone: z.string().trim().min(1, "Enter your phone number").max(24, "Enter a valid phone number"),
    // Optional at signup — a non-gating personalisation only (pre-fills profiles.state so
    // the first partner action knows the user's state). Onboarding captures the fuller
    // state/city/area later regardless. Empty string is normalised to undefined.
    state: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v && v.length > 0 ? v : undefined)),
    // Carried from a shareable referral link (?ref=CODE on /signup) so
    // /auth/callback can auto-redeem it once a session exists — see
    // redeem_referral_code's own validation (self-referral, 30-day window,
    // already-applied) for what actually happens with it. The hidden field
    // that carries this only renders when a ?ref= param is present (see
    // signup-form.tsx), so formData.get("refCode") is `null` — not merely
    // absent — on every plain /signup visit; .nullish() (not .optional(),
    // which rejects an explicit null) is required to accept that.
    refCode: z
      .string()
      .trim()
      .toUpperCase()
      .nullish()
      .transform((v) => (v && v.length > 0 ? v : undefined)),
    // Why the visitor signed up, carried from ?intent= on /signup, so
    // completeOnboarding can land them on the thing they actually came for
    // instead of the generic dashboard. Same hidden-field mechanism as
    // refCode above, so .nullish() is required for the same reason. Kept to a
    // closed set: an unrecognised value is dropped here rather than trusted,
    // and completeOnboarding falls back to /patient regardless, so this can
    // never be used to push a new patient at an arbitrary route.
    intent: z
      // 'support' additionally decides what we are allowed to ask this person
      // for at all: a payer has no telehealth relationship to consent to and
      // no health data for us to hold, so their onboarding is genuinely
      // shorter rather than merely reordered.
      .enum(["health_check", "support"])
      .nullish()
      .catch(undefined)
      .transform((v) => v ?? undefined),
    password: z.string().min(PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT_MESSAGE),
  });

export const signupSchema = signupObject
  .transform((data) => ({
    ...data,
    fullName: `${data.firstName} ${data.lastName}`.trim(),
    phone: toE164(data.countryCode, data.phone),
  }))
  .refine((data) => E164_GENERIC.test(data.phone), {
    message: PHONE_INVALID_MESSAGE,
    path: ["phone"],
  });
export type SignupInput = z.infer<typeof signupSchema>;

/**
 * Phone-first sign-up (S03, function 1.1): the same person fields, no email. The account is created on the
 * phone identity and stays unusable until the six-digit code is verified (function 1.2).
 */
export const phoneSignupSchema = signupObject
  .omit({ email: true })
  .transform((data) => ({
    ...data,
    fullName: `${data.firstName} ${data.lastName}`.trim(),
    phone: toE164(data.countryCode, data.phone),
  }))
  .refine((data) => E164_GENERIC.test(data.phone), {
    message: PHONE_INVALID_MESSAGE,
    path: ["phone"],
  });
export type PhoneSignupInput = z.infer<typeof phoneSignupSchema>;

/** Sign in with a phone number and password (function 1.3). */
export const phonePasswordLoginSchema = z
  .object({
    countryCode: z.string().regex(/^\+\d{1,4}$/, "Select a country code"),
    phone: z.string().trim().min(1, "Enter your phone number").max(24, "Enter a valid phone number"),
    // Not length-checked here: a sign-in is not the place to tell someone their old password is "too short".
    password: z.string().min(1, "Enter your password"),
  })
  .transform((data) => ({ phone: toE164(data.countryCode, data.phone), password: data.password }))
  .refine((data) => E164_GENERIC.test(data.phone), {
    message: PHONE_INVALID_MESSAGE,
    path: ["phone"],
  });
export type PhonePasswordLoginInput = z.infer<typeof phonePasswordLoginSchema>;
