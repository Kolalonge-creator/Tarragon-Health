import { PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT_MESSAGE } from "@/lib/validation/password";

/**
 * Turns a provider error into something a person can act on.
 *
 * Every auth surface used to return `error.message` straight from GoTrue (and
 * in one case PostgREST) to the screen, which put raw provider strings in
 * front of patients: "Invalid login credentials", "AuthApiError", "Token has
 * expired or is invalid", "For security purposes, you can only request this
 * after 47 seconds", and worst of all "Password should be at least 6
 * characters" — GoTrue's own default minimum, contradicting this platform's
 * 8-character rule on the very screen that enforces it.
 *
 * Two rules the mappings below hold to:
 *  - never confirm whether an account exists. Sign-in and password-reset
 *    failures say the same thing whether or not the address is registered,
 *    matching the anti-enumeration posture forgot-password/actions.ts already
 *    documents for the success path.
 *  - never surface a provider internal (class name, status code, table name,
 *    "AuthApiError", a JWT complaint). An unrecognised error falls through to
 *    the context's generic message, which says what failed and what to do.
 *
 * The pattern this follows already existed in two places in the codebase and
 * nowhere else (mfa-actions.ts's "That code didn't match. Check the app and
 * try again" and forgot-password/actions.ts's "Could not send reset email.
 * Please try again."); this generalises it rather than inventing a new one.
 */
export type AuthErrorContext =
  | "sign_in"
  | "sign_up"
  | "otp_send"
  | "otp_verify"
  | "password_update"
  | "mfa_setup"
  | "sign_out_others"
  | "generic";

const GENERIC: Record<AuthErrorContext, string> = {
  sign_in: "We could not sign you in just then. Please try again.",
  sign_up: "We could not create your account just then. Please try again.",
  otp_send: "We could not send the code just then. Check the number and try again.",
  otp_verify: "We could not check that code just then. Please try again.",
  password_update: "We could not update your password just then. Please try again.",
  mfa_setup: "We could not set that up just then. Please try again.",
  sign_out_others: "We could not sign out your other devices just then. Please try again.",
  generic: "Something went wrong just then. Please try again.",
};

/** Anything with a readable message, without importing a provider type. */
type ErrorLike = { message?: unknown; code?: unknown; status?: unknown };

function rawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as ErrorLike).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/**
 * Matched on lowercased substrings rather than GoTrue's `error_code` values:
 * the codes were only added to auth-js recently and are absent from plenty of
 * the errors this has to handle (network failures, PostgREST), while the
 * message text has been stable for far longer. Order matters — the first
 * match wins, so the more specific patterns are listed first.
 */
const PATTERNS: Array<{
  match: RegExp;
  /** Contexts this applies to; omitted means every context. */
  only?: AuthErrorContext[];
  message: string;
}> = [
  {
    match: /invalid login credentials|invalid credentials|invalid email or password/,
    message: "That email and password do not match an account. Check both and try again.",
  },
  {
    match: /email not confirmed|email_not_confirmed/,
    message:
      "This account still needs confirming. Open the confirmation link we emailed you, then sign in.",
  },
  {
    match: /phone not confirmed/,
    message: "This number still needs confirming. Ask for a new code below.",
  },
  {
    // Anti-enumeration: never say "that address is already taken".
    match: /already registered|already been registered|user already exists|already exists/,
    only: ["sign_up"],
    message:
      "We could not create an account with those details. If you already have one, sign in instead, or reset your password.",
  },
  {
    match: /token has expired or is invalid|invalid token|otp_expired|token expired|expired token/,
    message: "That code is wrong or has expired. Ask for a new one and try again.",
  },
  {
    match: /invalid otp|otp is invalid/,
    message: "That code is not right. Check it and try again.",
  },
  {
    // GoTrue's own minimum (6) leaked through here and contradicted ours (8).
    match: /password should be at least|password is too short|weak.?password|password.*too short/,
    message: PASSWORD_TOO_SHORT_MESSAGE + ".",
  },
  {
    match: /same.?password|should be different from the old password|new password should be different/,
    message: "Choose a password you have not used on this account before.",
  },
  {
    match: /password.*(pwned|compromised|leaked|breach)/,
    message: `That password has appeared in a known data breach. Choose a different one, at least ${PASSWORD_MIN_LENGTH} characters.`,
  },
  {
    match: /for security purposes|rate limit|too many requests|over_request_rate_limit|429/,
    message: "Too many attempts just now. Wait a minute, then try again.",
  },
  {
    match: /invalid phone|phone number is invalid|invalid format.*phone/,
    message: "That does not look like a valid phone number. Check the country code and try again.",
  },
  {
    match: /error sending (confirmation |recovery |magic link )?(sms|email)|sms provider|failed to send/,
    only: ["otp_send", "sign_up"],
    message: "We could not get a message through just then. Check the details and try again.",
  },
  {
    match: /session|jwt|refresh token|not authenticated|auth session missing/,
    message: "Your session has expired. Sign in again, then retry.",
  },
  {
    match: /captcha/,
    message: "We could not verify that request. Reload the page and try again.",
  },
  {
    match: /network|fetch failed|timeout|timed out|econnrefused/,
    message: "We could not reach the server. Check your connection and try again.",
  },
  {
    match: /mfa|factor|totp/,
    only: ["mfa_setup"],
    message: "We could not set up your authenticator just then. Start the setup again.",
  },
];

/**
 * @param error  whatever the provider handed back (an object with `message`,
 *               a string, or anything else — an unrecognised shape is fine).
 * @param context which action failed, deciding the fallback wording.
 */
export function authErrorMessage(error: unknown, context: AuthErrorContext = "generic"): string {
  const raw = rawMessage(error).toLowerCase();
  if (raw) {
    for (const pattern of PATTERNS) {
      if (pattern.only && !pattern.only.includes(context)) continue;
      if (pattern.match.test(raw)) return pattern.message;
    }
  }
  return GENERIC[context];
}
