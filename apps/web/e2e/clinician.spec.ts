import { test, expect } from "@playwright/test";
import { loginAs, watchForPageErrors, QA_ACCOUNTS, qaPassword } from "./fixtures";

/**
 * Clinician golden-path smoke coverage. READ-ONLY — see fixtures.ts's header
 * comment: this only signs in and asserts the worklist renders, never
 * claims/resolves a case or signs an attestation.
 */
test("clinician login reaches /clinician and the worklist renders", async ({ page }) => {
  const { assertNoPageErrors } = watchForPageErrors(page);

  await loginAs(page, QA_ACCOUNTS.clinicianTier1, qaPassword());

  await expect(page).toHaveURL(/\/clinician(\/|$)/);
  // /clinician's page.tsx IS the worklist (no separate /clinician/worklist
  // route) — "Here's what needs you today." is the page's own subheading,
  // stable regardless of which doctor is signed in or how many items are
  // queued.
  await expect(page.getByText("Here's what needs you today.")).toBeVisible();
  // The queue itself — at least one of the doctor-tier worklist's own named
  // sections should be present in the sidebar, confirming this is really
  // the case-queue page and not just the shell around it. Scoped to the
  // `complementary` landmark (the desktop `<aside>`, the one and only
  // element with that role) rather than a bare `.first()`: this href can
  // also appear in AppShell's `lg:hidden` mobile BottomTabBar, so an
  // unscoped `.first()` depends on DOM order rather than which copy is
  // actually visible — see patient.spec.ts's dashboard test for the same
  // reasoning in more detail.
  await expect(
    page.getByRole("complementary").locator('a[href="/clinician/escalations"]')
  ).toBeVisible();

  assertNoPageErrors();
});
