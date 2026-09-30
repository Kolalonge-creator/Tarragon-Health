/**
 * Pure decision logic for the S03 phone sign-up / sign-in / recovery flows.
 *
 * Kept free of React and of the concrete Supabase client (the client is
 * passed in) so every branch that matters for safety can be unit-tested
 * without a device or a network:
 *  - an unknown number on recovery is treated as SUCCESS, so recovery never
 *    reveals whether a number is registered;
 *  - "Phone not confirmed" moves the person to the verify step;
 *  - provider error strings never reach the screen: they are mapped to
 *    auth.error.* keys.
 *
 * Nothing here logs. A phone number, code or password must never reach
 * console, Sentry, analytics or a URL.
 */
import type { MessageKey } from "@tarragon/i18n";

/** The slice of supabase.auth these flows use; lets tests pass a fake. */
export interface AuthApi {
  signUp(args: {
    phone: string;
    password: string;
    options?: { data?: Record<string, unknown> };
  }): Promise<{ error: { message: string } | null }>;
  verifyOtp(args: {
    phone: string;
    token: string;
    type: "sms";
  }): Promise<{ error: { message: string } | null }>;
  resend(args: { type: "sms"; phone: string }): Promise<{ error: { message: string } | null }>;
  signInWithPassword(args: {
    phone: string;
    password: string;
  }): Promise<{ error: { message: string } | null }>;
  signInWithOtp(args: {
    phone: string;
    options?: { shouldCreateUser?: boolean };
  }): Promise<{ error: { message: string } | null }>;
}

export const OTP_LENGTH = 6;
export const RESEND_COOLDOWN_SECONDS = 60;

/** Keep digits only and cap at the code length (handles pasted "123 456"). */
export function sanitiseOtp(input: string): string {
  return input.replace(/\D/g, "").slice(0, OTP_LENGTH);
}

export function isOtpComplete(input: string): boolean {
  return sanitiseOtp(input).length === OTP_LENGTH;
}

function lower(message: string): string {
  return (message ?? "").toLowerCase();
}

export function isPhoneNotConfirmed(message: string): boolean {
  return lower(message).includes("phone not confirmed");
}

/**
 * GoTrue's answer to signInWithOtp({shouldCreateUser:false}) for a number
 * with no account. Recovery must treat this exactly like a sent code.
 */
export function isUnknownUserOtpError(message: string): boolean {
  const m = lower(message);
  return (
    m.includes("signups not allowed") ||
    m.includes("signup is disabled") ||
    m.includes("user not found") ||
    m.includes("user not allowed")
  );
}

export function isRateLimited(message: string): boolean {
  const m = lower(message);
  return m.includes("rate limit") || m.includes("too many") || m.includes("security purposes");
}

export function isOffline(message: string): boolean {
  const m = lower(message);
  return m.includes("network") || m.includes("fetch") || m.includes("timeout");
}

export type AuthErrorContext = "sign_up" | "sign_in" | "verify" | "recovery" | "resend";

/**
 * Map a raw provider message to a translatable key. The same wording is
 * returned whether or not an account exists (sign-in and sign-up both fall
 * through to a generic key, never to "already registered"/"no such user").
 */
export function authErrorKey(rawMessage: string, context: AuthErrorContext): MessageKey {
  if (isRateLimited(rawMessage)) return "auth.error.rate_limited";
  if (isOffline(rawMessage)) return "auth.error.offline";
  const m = lower(rawMessage);
  if (context === "verify" && (m.includes("expired") || m.includes("invalid") || m.includes("token"))) {
    return "auth.error.wrong_code";
  }
  if (context === "sign_in") return "auth.error.sign_in_failed";
  return "auth.error.generic";
}

export type SignUpOutcome =
  | { kind: "verify" }
  | { kind: "error"; key: MessageKey };

/**
 * Creates the unconfirmed phone account; the server sends the code. A
 * "user already registered" reply is deliberately shown as the verify step
 * too, so the screen cannot be used to learn who has an account (the code
 * simply never arrives for a number that is not theirs).
 */
export async function startPhoneSignUp(
  auth: AuthApi,
  args: { phone: string; password: string; fullName: string; state?: string },
): Promise<SignUpOutcome> {
  const { error } = await auth.signUp({
    phone: args.phone,
    password: args.password,
    options: {
      data: {
        full_name: args.fullName,
        phone: args.phone,
        ...(args.state ? { state: args.state } : {}),
      },
    },
  });
  if (!error) return { kind: "verify" };
  const m = lower(error.message);
  if (m.includes("already registered") || m.includes("already been registered") || m.includes("already exists")) {
    return { kind: "verify" };
  }
  return { kind: "error", key: authErrorKey(error.message, "sign_up") };
}

export type VerifyOutcome = { kind: "verified" } | { kind: "error"; key: MessageKey };

export async function verifyPhoneCode(
  auth: AuthApi,
  args: { phone: string; code: string },
): Promise<VerifyOutcome> {
  const token = sanitiseOtp(args.code);
  if (token.length !== OTP_LENGTH) return { kind: "error", key: "auth.error.wrong_code" };
  const { error } = await auth.verifyOtp({ phone: args.phone, token, type: "sms" });
  if (error) return { kind: "error", key: authErrorKey(error.message, "verify") };
  return { kind: "verified" };
}

export type ResendOutcome = { kind: "sent" } | { kind: "error"; key: MessageKey };

export async function resendPhoneCode(auth: AuthApi, phone: string): Promise<ResendOutcome> {
  const { error } = await auth.resend({ type: "sms", phone });
  if (error) return { kind: "error", key: authErrorKey(error.message, "resend") };
  return { kind: "sent" };
}

export type PhoneSignInOutcome =
  | { kind: "signed_in" }
  /** Number exists but was never confirmed: a new code was requested, go to verify. */
  | { kind: "needs_verification" }
  | { kind: "error"; key: MessageKey };

export async function signInWithPhonePassword(
  auth: AuthApi,
  args: { phone: string; password: string },
): Promise<PhoneSignInOutcome> {
  const { error } = await auth.signInWithPassword(args);
  if (!error) return { kind: "signed_in" };
  if (isPhoneNotConfirmed(error.message)) {
    // Best effort: even if the resend is throttled the verify step shows the
    // countdown and lets the person ask again.
    await auth.resend({ type: "sms", phone: args.phone }).catch(() => undefined);
    return { kind: "needs_verification" };
  }
  return { kind: "error", key: authErrorKey(error.message, "sign_in") };
}

export type CodeRequestOutcome = { kind: "sent" } | { kind: "error"; key: MessageKey };

/**
 * Code sign-in and phone recovery share this: shouldCreateUser:false so an
 * unknown number can never create an account, and the unknown-user error is
 * reported as "sent" so the screen looks identical either way.
 */
export async function requestPhoneCode(auth: AuthApi, phone: string): Promise<CodeRequestOutcome> {
  const { error } = await auth.signInWithOtp({ phone, options: { shouldCreateUser: false } });
  if (!error) return { kind: "sent" };
  if (isUnknownUserOtpError(error.message)) return { kind: "sent" };
  return { kind: "error", key: authErrorKey(error.message, "recovery") };
}

/** Whole seconds left before a resend is allowed; 0 when allowed now. */
export function secondsUntilResend(nowMs: number, availableAtMs: number): number {
  return Math.max(0, Math.ceil((availableAtMs - nowMs) / 1000));
}
