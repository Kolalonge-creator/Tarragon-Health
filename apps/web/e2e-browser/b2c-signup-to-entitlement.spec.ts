import { expect, test } from "@playwright/test";
import { adminClient, createTestPatient, deleteTestPatient, seedActiveServicePurchase, type TestPatient } from "./helpers/supabase-admin";

// Real, active guest-checkout product as of 2026-09-23 (see
// apps/web/src/app/(marketing)/_content/pricing.ts and
// GUEST_CHECKOUT_PRODUCT_CODES in guest-checkout-products.ts) — ₦15,000,
// "Result Consultation". If this code is ever retired, this spec's checkout
// test needs a replacement from the same list, not a guess.
const CHECKOUT_PRODUCT_CODE = "result_interpretation_credit";

const runId = Date.now().toString();

test.describe("B2C signup form", () => {
  // Supabase requires real email confirmation — this only proves the form
  // itself accepts valid input and shows the right response; it can't
  // complete a real account this way (see the authenticated-journey test
  // below, which seeds an already-confirmed user via the admin API instead).
  test("accepts valid input and shows the check-your-email confirmation, never a raw error", async ({ page }) => {
    const email = `e2e-test-signup-form-${runId}@example.com`;

    await page.goto("/signup");
    await page.locator("#firstName").fill("E2e");
    await page.locator("#lastName").fill("Test");
    await page.locator("#email").fill(email);
    await page.locator("#phone").fill("8012345678");
    await page.locator("#password").fill("E2e-test-pw-!Aa1");

    await page.getByRole("button", { name: /create account|sign up/i }).click();

    await expect(page.getByRole("status")).toContainText(/check your email/i, { timeout: 15_000 });

    // Best-effort cleanup — this creates a real (unconfirmed) auth.users row
    // even though this test never logs in as it. Ephemeral local stack, so
    // not load-bearing, but tidy up rather than leave it.
    const { data } = await adminClient.auth.admin.listUsers();
    const created = data?.users.find((u) => u.email === email);
    if (created) await adminClient.auth.admin.deleteUser(created.id);
  });
});

// The 3 tests below share one patient and have a real ordering dependency:
// onboarding must complete before the later two can reach /patient/* pages
// without being redirected back to /onboarding. Relies on this config's
// `workers: 1` / no `fullyParallel` (playwright.config.ts) to guarantee
// declaration-order execution within this file — an atypical thing to lean
// on in Playwright generally, called out here rather than left implicit.
test.describe("authenticated patient journey", () => {
  let patient: TestPatient;

  test.beforeAll(async () => {
    patient = await createTestPatient(runId);
  });

  test.afterAll(async () => {
    if (patient) await deleteTestPatient(patient);
  });

  /** Logs the seeded patient in through the real /login form (never a seeded session cookie). */
  async function loginAsPatient(page: import("@playwright/test").Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#email").fill(patient.email);
    await page.locator("#password").fill(patient.password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }

  test("log in and complete onboarding", async ({ page }) => {
    await loginAsPatient(page);

    // A fresh patient with no onboarding_completed_at lands on /onboarding.
    await page.waitForURL(/\/onboarding/, { timeout: 15_000 });

    // --- Onboarding: consent -> demographics -> skip intake -> finish ---
    await page.getByRole("checkbox", { name: /accept|agree/i }).check();
    await page.getByRole("button", { name: /i agree, continue/i }).click();

    await page.locator("#dateOfBirth").fill("1990-01-01");
    await page.locator("#sex").selectOption("female");
    await page.getByRole("button", { name: /save.*continue/i }).click();

    await page.getByRole("button", { name: /continue to the last step/i }).click();

    await page.getByRole("button", { name: /take me to my dashboard/i }).click();
    await page.waitForURL(/\/patient(?!\/onboarding)/, { timeout: 15_000 });
  });

  test("initiating checkout redirects to a real Paystack test-mode hosted page", async ({ page }) => {
    // Needs a real sk_test_... key set on the CI runner (PAYSTACK_SECRET_KEY)
    // to actually call Paystack's /transaction/initialize — not yet present
    // as a GitHub Actions secret on this repo as of 2026-09-23 (checked via
    // `gh secret list`). Skips rather than fails so this job stays a
    // meaningful required check before that's added, instead of being
    // permanently red for missing infrastructure nobody's asked to set up
    // yet. Add PAYSTACK_SECRET_KEY (the sk_test_ value from .env.local, or a
    // dedicated CI-only test-mode key) as a repo secret to turn this on.
    test.skip(!process.env.PAYSTACK_SECRET_KEY, "PAYSTACK_SECRET_KEY not configured in CI yet");

    await loginAsPatient(page);
    await page.waitForURL(/\/patient/, { timeout: 15_000 });

    // Deliberately does NOT attempt to complete payment on Paystack's page
    // (no card entry exists in this flow, and driving Paystack's own UI is
    // out of scope/flaky) — only proves the real test-mode API call
    // succeeds and the app redirects to a genuine Paystack hosted page.
    // Activation is proven separately (see the next test) by seeding the
    // exact DB state the real webhook produces.
    await page.goto(`/checkout/continue?code=${CHECKOUT_PRODUCT_CODE}`);
    await expect(page).toHaveURL(/checkout\.paystack\.com/, { timeout: 20_000 });
  });

  test("a completed payment's entitlement reflects in the patient dashboard", async ({ page }) => {
    // Does not depend on the Paystack-calling test above or its skip
    // condition — seeds the exact end state private.apply_service_purchase_payment
    // produces directly (see seedActiveServicePurchase's own header), so
    // this proves the UI layer honestly reflects real DB state regardless
    // of whether a live Paystack call was exercised in this run.
    const { productName } = await seedActiveServicePurchase(
      patient.userId,
      patient.organisationId,
      CHECKOUT_PRODUCT_CODE,
      runId,
    );

    await loginAsPatient(page);
    await page.waitForURL(/\/patient/, { timeout: 15_000 });

    await page.goto("/patient/subscription");
    const activeRow = page.getByText(productName).locator("..");
    await expect(activeRow.getByText("Active", { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});
