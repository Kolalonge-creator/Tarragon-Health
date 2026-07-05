import { z } from "zod";
import { E164_NG } from "@tarragon/shared";

export const emailLoginSchema = z.object({
  email: z.email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
export type EmailLoginInput = z.infer<typeof emailLoginSchema>;

export const phoneOtpRequestSchema = z.object({
  phone: z.string().regex(E164_NG, "Enter a Nigerian number, e.g. +234XXXXXXXXXX"),
});
export type PhoneOtpRequestInput = z.infer<typeof phoneOtpRequestSchema>;

export const phoneOtpVerifySchema = z.object({
  phone: z.string().regex(E164_NG, "Enter a Nigerian number, e.g. +234XXXXXXXXXX"),
  token: z.string().length(6, "Enter the 6-digit code"),
});
export type PhoneOtpVerifyInput = z.infer<typeof phoneOtpVerifySchema>;

export const signupSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name"),
  email: z.email(),
  phone: z.string().regex(E164_NG, "Enter a Nigerian number, e.g. +234XXXXXXXXXX"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
export type SignupInput = z.infer<typeof signupSchema>;
