import type { MessageKey } from "./en";

/**
 * Nigerian Pidgin (`pcm`) catalogue. The type forces every English key to have
 * a Pidgin entry, so a missing key fails the typecheck as well as the parity test.
 *
 * REVIEW STATUS: not yet reviewed by a native Pidgin speaker. Clinical and
 * safety strings must not be added here until a clinician has signed off the
 * translation (see docs/CLINICAL_FEATURE_CHECKLIST.md).
 */
export const pcm: Record<MessageKey, string> = {
  "app.name": "TarragonHealth",
  "app.tagline": "Care wey dey stay with you.",
  "common.care_team": "your care team",
  "common.continue": "Continue",
  "common.cancel": "Cancel",
  "common.try_again": "Try again",
  "console.login.title": "Staff sign-in",
  "console.login.subtitle": "Sign in to the TarragonHealth console.",
  "console.login.email": "Email",
  "console.login.password": "Password",
  "console.login.submit": "Sign in",
  "console.login.submitting": "E dey sign you in...",
  "console.login.not_staff": "This sign-in na for staff areas wey don move go console. Abeg sign in from the main TarragonHealth app instead.",
  "console.login.forgot": "You forget your password?",
  "console.login.wrong_area": "You don sign in, but this account no get access to the console.",
  "console.mfa.title": "Enter your code",
  "console.mfa.body": "Open your authenticator app and enter the 6-digit code for TarragonHealth.",
  "console.mfa.code_label": "6-digit code",
  "console.mfa.verify": "Verify",
  "console.mfa.verifying": "E dey verify...",
  "console.mfa.wrong_code": "That code no match. Check the app and try again.",
  "console.signout": "Sign out",
  "console.signout_not_you": "No be you? Sign out",
  "console.login.check_credentials": "Check your email and password, then try again.",
  "console.mfa.enter_code": "Enter the 6-digit code from your authenticator app.",
  "console.shell.staff_area": "Staff console",
  "greeting.hello": "How far, {name}",
};
