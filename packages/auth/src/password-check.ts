import { checkBreachedPassword, type BreachCheckOptions } from "./breached-password";
import { PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT_MESSAGE } from "./password-policy";

/**
 * The one place a NEW password (sign-up, reset, change) is judged: length first, then the breached-password
 * range check. Every surface calls this so the rule cannot drift between web, mobile and the account page.
 *
 * `breach` is reported even on success so a caller can count "unknown" (the range service was down and the
 * password was allowed through; see breached-password.ts for why that fails open).
 */
export const BREACHED_PASSWORD_MESSAGE = `That password has appeared in a known data breach. Choose a different one, at least ${PASSWORD_MIN_LENGTH} characters.`;

export type PasswordVerdict =
  | { ok: true; breach: "clean" | "unknown" }
  | { ok: false; reason: "too_short" | "breached"; message: string };

export async function checkPasswordAcceptable(
  password: string,
  options?: BreachCheckOptions,
): Promise<PasswordVerdict> {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: "too_short", message: `${PASSWORD_TOO_SHORT_MESSAGE}.` };
  }
  const result = await checkBreachedPassword(password, options);
  if (result.status === "breached") {
    return { ok: false, reason: "breached", message: BREACHED_PASSWORD_MESSAGE };
  }
  return { ok: true, breach: result.status };
}
