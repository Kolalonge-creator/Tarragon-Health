/**
 * Hermetic stand-in for @tarragon/auth/password-check under Jest (mapped in jest.config.mjs).
 *
 * The real module calls the breached-password range service over the network. A unit test must never do that (it
 * would be slow, flaky offline, and would send hash prefixes of test passwords to a third party). This keeps the
 * length rule real and reports every other password as clean. A test that needs a breached result mocks this module
 * explicitly (`jest.mock("@tarragon/auth/password-check", ...)`); the real logic has its own tests in packages/auth.
 */
export const BREACHED_PASSWORD_MESSAGE = "breached (test stub)";

export type PasswordVerdict =
  | { ok: true; breach: "clean" | "unknown" }
  | { ok: false; reason: "too_short" | "breached"; message: string };

export async function checkPasswordAcceptable(password: string): Promise<PasswordVerdict> {
  if (password.length < 8) return { ok: false, reason: "too_short", message: "Password must be at least 8 characters." };
  return { ok: true, breach: "clean" };
}
