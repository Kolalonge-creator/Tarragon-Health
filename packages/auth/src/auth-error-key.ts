/**
 * Locale-neutral twin of auth-error-message.ts for the S03 flows: returns an i18n KEY (from @tarragon/i18n, the
 * `auth.*` group) instead of an English sentence, so a screen can show the same failure from the catalogue.
 *
 * Same two rules as the English mapper: never confirm whether an account exists (a wrong password and an unknown
 * number read the same), and never surface a provider internal. Anything unrecognised falls back to a generic key.
 * Kept free of an @tarragon/i18n import so packages/auth stays dependency-light; the keys are checked against the
 * catalogue by a test in apps/web.
 */
export type AuthErrorKey =
  | "auth.error.generic"
  | "auth.error.rate_limited"
  | "auth.error.invalid_phone"
  | "auth.error.wrong_code"
  | "auth.error.sign_in_failed"
  | "auth.error.offline"
  | "auth.signin.unverified";

export type AuthErrorKeyContext = "sign_in" | "sign_up" | "otp_send" | "otp_verify" | "generic";

function rawMessage(error: unknown): string {
  if (typeof error === "string") return error.toLowerCase();
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message.toLowerCase();
  }
  return "";
}

export function authErrorKey(error: unknown, context: AuthErrorKeyContext = "generic"): AuthErrorKey {
  const raw = rawMessage(error);
  if (/phone not confirmed/.test(raw)) return "auth.signin.unverified";
  if (/for security purposes|rate limit|too many requests|over_request_rate_limit|over_sms_send_rate_limit|429/.test(raw)) {
    return "auth.error.rate_limited";
  }
  if (/invalid phone|phone number is invalid|invalid format[^.]{0,40}phone/.test(raw)) return "auth.error.invalid_phone";
  if (/token has expired or is invalid|invalid token|otp_expired|token expired|expired token|invalid otp|otp is invalid/.test(raw)) {
    return "auth.error.wrong_code";
  }
  if (/network|fetch failed|timeout|timed out|econnrefused/.test(raw)) return "auth.error.offline";
  if (/invalid login credentials|invalid credentials|invalid email or password/.test(raw)) return "auth.error.sign_in_failed";
  if (context === "sign_in") return "auth.error.sign_in_failed";
  if (context === "otp_verify") return "auth.error.wrong_code";
  return "auth.error.generic";
}
