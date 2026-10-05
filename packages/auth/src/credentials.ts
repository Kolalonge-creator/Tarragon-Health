import { z } from "zod";
import { PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT_MESSAGE } from "./password-policy";

// Credential schemas shared by every sign-in surface (apps/web and
// apps/console). Kept here so the two apps cannot disagree about what a valid
// password or second-factor code looks like.

export const emailLoginSchema = z.object({
  email: z.email(),
  password: z.string().min(PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT_MESSAGE),
});
export type EmailLoginInput = z.infer<typeof emailLoginSchema>;

export const mfaCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app"),
});
export type MfaCodeInput = z.infer<typeof mfaCodeSchema>;
