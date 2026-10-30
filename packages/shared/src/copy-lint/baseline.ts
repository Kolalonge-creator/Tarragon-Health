/**
 * Ratchet for warn-only copy-lint: the number of existing violations per rule
 * when the lint was introduced (S01, 2026-09-30). The count may only go DOWN.
 * A PR that adds a new violation fails; a PR that removes some should lower
 * the number here. Do not raise a number to make a PR pass: fix the copy.
 */
export const COPY_LINT_BASELINE: Readonly<Record<string, number>> = {
  "em-dash": 704, // lowered 6 for the finance overview honesty fix (#1495, its "—" placeholders became explicit hints) and 16 for the copy rewrite (#1453) and 3 for the clinician copy pass (#1455) and 2 for the admin copy pass; previously: measured 2026-10-30 after the patient design pass (P0-P7) removed 11 net (was 742 on 2026-10-27, 818 before the templates root was added)
  "your-doctor": 39, // lowered 28 for the marketing voice pass (2026-10-30); 17 of the rest are in resources.ts
  "en-dash": 57, // measured 2026-10-30 (was 58; the design pass fixed one):  en dashes inside string literals or JSX text only; legitimate ranges use the allow marker
  cure: 3, // all "miracle cures" anti-claims; false positives kept until an allowlist exists
  "instant-doctor": 0,
  "free-healthcare": 0,
  "abbreviation-bp": 0, // patient-facing text only (see PATIENT_FACING); added with the voice rules 2026-10-30
  "internal-term": 0, // "escalate" and "care gap" in patient-facing text
  colloquial: 1, // "panic.title" in packages/i18n, inside the reviewed-strings ledger; changing it needs a recorded reviewer
};
