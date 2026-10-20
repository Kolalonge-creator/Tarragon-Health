/**
 * Plain wording for every passkey outcome. Two rules:
 *  - Sign-in has ONE failure message. A missing passkey, a removed one, a stale challenge, an unconfirmed or blocked account and
 *    a wrong-role account all read the same, so the screen cannot be used to find out whether an account exists (enumeration).
 *  - Every message ends by pointing at the ways that always work, because passkeys are an extra and never the only way in.
 */
export const ALWAYS_WORKS = "You can always sign in with your phone number or email.";

export const PASSKEY_MESSAGES = {
  signInFailed: "We could not sign you in with that passkey. Try again, or use your phone number or email.",
  signInUnavailable: `Passkeys are not available right now. ${ALWAYS_WORKS}`,
  rateLimited: "Too many tries. Please wait a few minutes, then try again.",
  generic: `Something went wrong just then. Nothing was changed. ${ALWAYS_WORKS}`,
  cancelled: "That was cancelled, so nothing was added. You can try again whenever you like.",
  unsupported: `This browser or device cannot use passkeys. ${ALWAYS_WORKS}`,
  sessionExpired: "Your session has expired. Sign in again, then retry.",
  wrongPassword: "That password is not right. Enter the password you sign in with. If you have never set a password, set one under Change password first.",
  recheckPassword: "That took too long, so we need your password again. Start adding the passkey again.",
  noPasswordRoute: "To add a passkey we need to check your password first. Set a password under Change password, then come back.",
  alreadyRegistered: "This device or password manager already has a passkey on your account.",
  tooMany: "You have reached the most passkeys an account can have. Remove one you no longer use, then add this one.",
  notAvailableForAccount: `Passkeys are only for patient accounts. ${ALWAYS_WORKS}`,
  badName: "Give the passkey a short name, for example My phone.",
  notFound: "That passkey is no longer there. Refresh the page.",
} as const;

export type PasskeyMessageKey = keyof typeof PASSKEY_MESSAGES;

/** Auth error codes (Supabase Auth, see the Passkey authentication guide) that a registration can safely explain to the person. */
export function registrationErrorKey(code: string | undefined, message?: string): PasskeyMessageKey {
  switch (code) {
    case "webauthn_credential_exists":
      return "alreadyRegistered";
    case "too_many_passkeys":
      return "tooMany";
    case "passkey_disabled":
      return "signInUnavailable";
    default:
      // The database gate (a trigger on the credential table) refuses with these texts; Auth wraps them in a generic 500, so the
      // text may or may not survive. The server checks the gate BEFORE calling Auth, so this is a backstop, not the main path.
      if (message && /passkey_step_up_required|passkey_not_allowed/.test(message)) return "noPasswordRoute";
      return "generic";
  }
}
