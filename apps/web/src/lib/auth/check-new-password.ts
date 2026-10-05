import * as Sentry from "@sentry/nextjs";
import { checkPasswordAcceptable, type PasswordVerdict } from "@tarragon/auth/password-check";

/**
 * The breached-password check for every web surface that sets a password (sign-up, reset, change). The check fails open
 * when the range service is unavailable (see packages/auth/src/breached-password.ts); this wrapper makes that visible
 * instead of silent by reporting each skipped check, with no password, hash or identity attached, so an outage shows up
 * as a count in Sentry rather than as nothing.
 */
export async function checkNewPassword(password: string): Promise<PasswordVerdict> {
  const verdict = await checkPasswordAcceptable(password);
  if (verdict.ok && verdict.breach === "unknown") {
    Sentry.captureMessage("breached-password check unavailable; password allowed", "warning");
  }
  return verdict;
}
