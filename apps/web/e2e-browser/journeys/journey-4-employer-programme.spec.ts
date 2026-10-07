import { test } from "@playwright/test";

/**
 * Journey 4 (spec D.7.3): an employer programme.
 *
 *   "A Lagos company enrols 300 staff with a cohort code. Staff get the full free app plus sponsored care packs
 *    and consultations as entitlements. The company sees only aggregate participation and cardiometabolic
 *    outcomes in the institution console, never individual records and never reproductive or mental health
 *    data."
 *
 * Blocked on S79 (Module 24, institution console). What exists: employer roster eligibility
 * (employer-eligibility.spec.ts covers the public checker), sponsor cohorts and a sponsor monthly report with
 * export (S38e, s38e_sponsor_cohorts_and_triage_accuracy.sql, S38f), entitlements (S26). What does not exist:
 * a cohort CODE that staff redeem, any "institution" role console, and an aggregate-only guarantee test across
 * reproductive and mental health data (mental health data does not exist yet either, Module 10).
 *
 * The aggregate-only rule is INV-12 adjacent and the CLAUDE.md rule I9 (institutions get aggregate-only access,
 * ever). When S79 lands, the first test written here should be the negative one: an institution login reads zero
 * rows from every patient-scoped table, then reads only the small-cell-suppressed aggregates.
 */
test.describe("journey 4: an employer programme", () => {
  test.skip("a company enrols 300 staff with a cohort code and each redeems it", async () => {
    // BLOCKER S79: no cohort code. S38e has sponsor_cohorts (a sponsor's named group), employer_roster_members
    // exists for phone-matched eligibility. Decide whether the code is a new redeem path or the roster (OQ).
    // Use is_test organisations and 300 generated is_test profiles only; never import real staff.
  });

  test.skip("staff receive sponsored care packs and consultations as entitlements", async () => {
    // BLOCKER S79 for the grant path; entitlement lifecycle (S26) is proven in s26_entitlements_lifecycle_and_refunds.sql.
  });

  test.skip("the company console shows aggregate participation and cardiometabolic outcomes only", async () => {
    // BLOCKER S79 (no institution console). The nearest built surface is the sponsor staff monthly figures
    // (S38f) on mobile and web, with small-cell suppression proven in s38f_sponsor_staff_monthly_figures.sql.
  });

  test.skip("the company never sees an individual record, reproductive health or mental health data", async () => {
    // BLOCKER S79, and Module 10 (mental health) does not exist yet. Write as a negative RLS test: institution
    // session, every patient-scoped table, expect zero rows, plus the reproductive_health category (CLAUDE.md).
  });
});
