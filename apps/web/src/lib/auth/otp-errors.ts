/**
 * GoTrue's answer when a code is requested for a number with no account and `shouldCreateUser` is false
 * ("Signups not allowed for otp", code `otp_disabled`). Callers treat it as success so the screen cannot be used to
 * learn which numbers are registered (S03, function 1.6).
 */
export function isUnknownUserOtpError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "otp_disabled" || code === "user_not_found") return true;
  return typeof message === "string" && /signups? not allowed for otp|user not found/i.test(message);
}

/**
 * GoTrue refuses a second code request for a REAL number inside its 60 second gap ("For security purposes, you can
 * only request this after N seconds") but never for an unknown one. Showing that message would tell an attacker which
 * numbers are registered, so a code request treats it like success: the screen says a code was sent and the person
 * uses the one already on its way (the verify step carries the 60 second countdown).
 */
export function isRateLimitOtpError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === "string" && /rate_limit/.test(code)) return true;
  return typeof message === "string" && /for security purposes|rate limit|too many requests/i.test(message);
}

/** GoTrue's "this number already has an account" answer to a sign-up. Sign-up shows the code step for it, like a new number. */
export function isAlreadyRegisteredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "user_already_exists" || code === "phone_exists") return true;
  return typeof message === "string" && /already registered|already been registered|already exists/i.test(message);
}
