/**
 * Ratchet for warn-only copy-lint: the number of existing violations per rule
 * when the lint was introduced (S01, 2026-09-30). The count may only go DOWN.
 * A PR that adds a new violation fails; a PR that removes some should lower
 * the number here. Do not raise a number to make a PR pass: fix the copy.
 */
export const COPY_LINT_BASELINE: Readonly<Record<string, number>> = {
  "em-dash": 813, // W-59: -5 in send-pending-notifications/templates.ts (new scan root). Actual on 2026-10-27 is 742; tighten when convenient
  "your-doctor": 67,
  "en-dash": 70, // W-59: new rule, counted on 2026-10-27 (includes the new send-pending-notifications root)
  cure: 4, // all "miracle cures" anti-claims; false positives kept until an allowlist exists
  "instant-doctor": 0,
  "free-healthcare": 0,
};
