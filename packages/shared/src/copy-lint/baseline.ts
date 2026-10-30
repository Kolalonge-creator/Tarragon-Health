/**
 * Ratchet for warn-only copy-lint: the number of existing violations per rule
 * when the lint was introduced (S01, 2026-09-30). The count may only go DOWN.
 * A PR that adds a new violation fails; a PR that removes some should lower
 * the number here. Do not raise a number to make a PR pass: fix the copy.
 */
export const COPY_LINT_BASELINE: Readonly<Record<string, number>> = {
  "em-dash": 674, // lowered 36 for the mobile copy pass; previously 710, lowered 16 for the copy rewrite (#1453) and 3 for the clinician copy pass (#1455) and 2 for the admin copy pass; previously: measured 2026-10-30 after the patient design pass (P0-P7) removed 11 net (was 742 on 2026-10-27, 818 before the templates root was added)
  "your-doctor": 15, // lowered 7 for the mobile copy pass (was 22); lowered 28 for the marketing voice pass and 17 for resources.ts (2026-10-30); the rest are outside the marketing folder
  "en-dash": 57, // measured 2026-10-30 (was 58; the design pass fixed one):  en dashes inside string literals or JSX text only; legitimate ranges use the allow marker
  cure: 3, // all "miracle cures" anti-claims; false positives kept until an allowlist exists
  "instant-doctor": 0,
  "free-healthcare": 0,
  "abbreviation-bp": 0, // patient-facing text only (see PATIENT_FACING); added with the voice rules 2026-10-30
  "internal-term": 0, // "escalate" and "care gap" in patient-facing text
  colloquial: 1, // "panic.title" in packages/i18n: the calm-tool wording is pinned to the CMO's attestation by a fingerprint (s56b-wording-pin.test.ts), so changing it closes the feature until the CMO attests again
};
