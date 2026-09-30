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
  "greeting.hello": "How far, {name}",
};
