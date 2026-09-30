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
  "greeting.hello": "Hello, {name}",
} as const;

export type MessageKey = keyof typeof en;
