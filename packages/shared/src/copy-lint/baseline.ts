/**
 * Ratchet for warn-only copy-lint: the number of existing violations per rule
 * when the lint was introduced (S01, 2026-09-30). The count may only go DOWN.
 * A PR that adds a new violation fails; a PR that removes some should lower
 * the number here. Do not raise a number to make a PR pass: fix the copy.
 */
export const COPY_LINT_BASELINE: Readonly<Record<string, number>> = {
  "em-dash": 742, // measured 2026-10-27 after removing 5 in send-pending-notifications/templates.ts (was 818 before the templates root was added)
  "your-doctor": 67,
  "en-dash": 58, // measured 2026-10-27: en dashes inside string literals or JSX text only; legitimate ranges use the allow marker
  cure: 4, // all "miracle cures" anti-claims; false positives kept until an allowlist exists
  "instant-doctor": 0,
  "free-healthcare": 0,
};
