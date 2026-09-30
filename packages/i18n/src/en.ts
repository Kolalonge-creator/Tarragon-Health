/**
 * English catalogue (v5 spec Section 12). Flat dot-keys, `{param}` placeholders.
 *
 * This is the key-based catalogue the v5 build writes new strings into. The
 * older patient-app wayfinding dictionary in `@tarragon/shared` (keyed by the
 * English source string) is untouched; migrating it is a later, deliberate step.
 *
 * Rules: no em dashes, never "cure", "instant doctor", "free healthcare" or
 * "your doctor" (say "your care team"). Enforced by i18n.test.ts.
 */
export const en = {
  "app.name": "TarragonHealth",
  "app.tagline": "Care that stays with you.",
  "common.care_team": "your care team",
  "common.continue": "Continue",
  "common.cancel": "Cancel",
  "common.try_again": "Try again",
  "console.login.title": "Staff sign-in",
  "console.login.subtitle": "Sign in to the TarragonHealth console.",
  "console.login.email": "Email",
  "console.login.password": "Password",
  "console.login.submit": "Sign in",
  "console.login.submitting": "Signing in...",
  "console.login.not_staff": "This sign-in is for staff areas that have moved to the console. Please sign in from the main TarragonHealth app instead.",
  "console.login.forgot": "Forgot your password?",
  "console.login.wrong_area": "You are signed in, but this account has no access to the console.",
  "console.mfa.title": "Enter your code",
  "console.mfa.body": "Open your authenticator app and enter the 6-digit code for TarragonHealth.",
  "console.mfa.code_label": "6-digit code",
  "console.mfa.verify": "Verify",
  "console.mfa.verifying": "Verifying...",
  "console.mfa.wrong_code": "That code did not match. Check the app and try again.",
  "console.signout": "Sign out",
  "console.signout_not_you": "Not you? Sign out",
  "console.login.check_credentials": "Check your email and password, then try again.",
  "console.mfa.enter_code": "Enter the 6-digit code from your authenticator app.",
  "console.shell.staff_area": "Staff console",
  "greeting.hello": "Hello, {name}",
} as const;

export type MessageKey = keyof typeof en;
