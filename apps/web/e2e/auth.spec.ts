import { test, expect } from "@playwright/test";
import { loginAs, watchForPageErrors, QA_ACCOUNTS, qaPassword } from "./fixtures";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

/**
 * Login + route-gating golden path. READ-ONLY: every test here either signs
 * in with a real (already-existing) QA account or checks an unauthenticated
 * redirect — nothing here submits a form that creates or changes data.
 */

test("patient login lands on the patient dashboard", async ({ page }) => {
  const { assertNoPageErrors } = watchForPageErrors(page);

  await loginAs(page, QA_ACCOUNTS.patientFree, qaPassword());

  await expect(page).toHaveURL(/\/patient(\/|$)/);
  // "Patient dashboard" is the page's own heading (see
  // apps/web/src/app/(dashboard)/patient/(sections)/page.tsx), independent
  // of the signed-in account's display name.
  await expect(page.getByText("Patient dashboard")).toBeVisible();

  assertNoPageErrors();
});

test("an invalid password is rejected with an inline error, not a crash", async ({ page }) => {
  // Deliberately a made-up address, never one of the 23 real QA accounts:
  // signInWithPassword's own per-identifier rate limit
  // (checkAuthRateLimit("login-email", ...) in login/actions.ts, 8/15min)
  // is keyed on the email tried, and this suite runs on nearly every PR —
  // repeatedly failing against a real account risks eventually locking out
  // that account's legitimate use elsewhere (manual QA, other suites).
  // Failing against an address with no account at all exercises the exact
  // same code path (authErrorMessage's deliberately-identical wording for
  // "wrong password" vs. "no such account") without that risk.
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("e2e-nonexistent-account@tarragon.test");
  await page.getByLabel("Password", { exact: true }).fill("not-a-real-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Stays on /login with an inline error — see login/actions.ts's
  // authErrorMessage, which deliberately never confirms whether the address
  // has an account here.
  await expect(page).toHaveURL(/\/login/);
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible({ timeout: 15_000 });
  // Distinguishes a real "bad credentials" rejection from this same fixed
  // email having been rate-limited by unrelated concurrent CI activity
  // (checkAuthRateLimit's email-scoped bucket is shared production Redis,
  // not per-run — see this suite's own e2e-browser.yml header comment).
  // Without this, a rate-limited run would still show SOME alert and this
  // test would pass while silently no longer testing the code path its
  // name claims to.
  await expect(alert).not.toHaveText(RATE_LIMIT_MESSAGE);
});

test("an unauthenticated visit to a patient route is redirected to login", async ({ page }) => {
  // proxy.ts's isRoleHomePrefixed gate (apps/web/src/proxy.ts) — the single
  // choke point for every protected route on the platform.
  await page.goto("/patient/vitals");
  await expect(page).toHaveURL(/\/login\?redirect=%2Fpatient%2Fvitals/);
});
