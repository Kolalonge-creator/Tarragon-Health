import { z } from "zod";
import { E164_GENERIC } from "@tarragon/shared";

export const emailLoginSchema = z.object({
  email: z.email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
export type EmailLoginInput = z.infer<typeof emailLoginSchema>;

const phoneCombineSchema = z.object({
  countryCode: z.string().regex(/^\+\d{1,4}$/, "Select a country code"),
  phone: z
    .string()
    .trim()
    .regex(/^\d{6,14}$/, "Enter a valid phone number"),
});

export const phoneOtpRequestSchema = phoneCombineSchema
  .transform((data) => ({ phone: `${data.countryCode}${data.phone}` }))
  .refine((data) => E164_GENERIC.test(data.phone), {
    message: "Enter a valid phone number for the selected country",
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
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(8, "Password must be at least 8 characters"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type NewPasswordInput = z.infer<typeof newPasswordSchema>;

export const signupSchema = z
  .object({
    firstName: z.string().trim().min(1, "Enter your first name"),
    lastName: z.string().trim().min(1, "Enter your last name"),
    email: z.email(),
    // Country code (e.g. "+234") and local subscriber number are collected
    // as separate fields so diaspora family members without a Nigerian
    // number can still register for a family package; combined below.
    countryCode: z.string().regex(/^\+\d{1,4}$/, "Select a country code"),
    phone: z
      .string()
      .trim()
      .regex(/^\d{6,14}$/, "Enter a valid phone number"),
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
    password: z.string().min(8, "Password must be at least 8 characters"),
  })
  .transform((data) => ({
    ...data,
    fullName: `${data.firstName} ${data.lastName}`.trim(),
    phone: `${data.countryCode}${data.phone}`,
  }))
  .refine((data) => E164_GENERIC.test(data.phone), {
    message: "Enter a valid phone number for the selected country",
    path: ["phone"],
  });
export type SignupInput = z.infer<typeof signupSchema>;
