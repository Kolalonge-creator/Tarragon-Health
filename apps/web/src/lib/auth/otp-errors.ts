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
