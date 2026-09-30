import { expect, test } from "@playwright/test";

/**
 * Authenticated console flows. Need a local Supabase stack (service-role key
 * and a local URL), so they skip cleanly when it is absent instead of failing.
 * Accounts are created per run through the same helper apps/web's browser
 * suite uses (importing it here rather than copying it).
 */
const haveStack = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
test.skip(!haveStack, "needs a local Supabase stack (SUPABASE_SERVICE_ROLE_KEY)");

type Helpers = typeof import("../../web/e2e-browser/helpers/supabase-admin");
type Patient = Awaited<ReturnType<Helpers["createTestPatient"]>>;

test.describe("console sign-in", () => {
  let helpers: Helpers;
  let ngoAdmin: Patient;
  let patient: Patient;
  const runId = `${Date.now()}`;

  test.beforeAll(async () => {
    helpers = await import("../../web/e2e-browser/helpers/supabase-admin");
    ngoAdmin = await helpers.createTestPatient(`${runId}a`);
    patient = await helpers.createTestPatient(`${runId}b`);
    const { error } = await helpers.adminClient.from("profiles").update({ role: "ngo_admin" }).eq("id", ngoAdmin.userId);
    if (error) throw error;
  });

  test.afterAll(async () => {
    await helpers?.deleteTestPatient(ngoAdmin);
    await helpers?.deleteTestPatient(patient);
  });

  async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }

  test("an NGO admin signs in and lands on their area", async ({ page }) => {
    await signIn(page, ngoAdmin.email, ngoAdmin.password);
    await expect(page).toHaveURL(/\/ngo$/);
    // The module is dormant by default, so the honest placeholder shows.
    await expect(page.getByText(/has not switched it on yet/i)).toBeVisible();
  });

  test("the session cookie is host-only, never widened to a parent domain", async ({ page, context }) => {
    await signIn(page, ngoAdmin.email, ngoAdmin.password);
    await expect(page).toHaveURL(/\/ngo$/);
    const authCookies = (await context.cookies()).filter((c) => c.name.includes("auth-token"));
    expect(authCookies.length).toBeGreaterThan(0);
    for (const cookie of authCookies) {
      // A leading dot means the cookie is sent to every subdomain, including
      // the marketing and patient hosts. Host-only is the S01d guarantee.
      expect(cookie.domain.startsWith(".")).toBe(false);
    }
  });

  test("a patient is refused and ends up with no session on the console", async ({ page }) => {
    await signIn(page, patient.email, patient.password);
    await expect(page.getByText(/staff areas that have moved to the console/i)).toBeVisible();
    // Signed out again, so a direct visit to a console path goes back to login.
    await page.goto("/ngo");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a wrong password gets the generic message and no session", async ({ page }) => {
    await signIn(page, ngoAdmin.email, "definitely-not-the-password-1A!");
    await expect(page.getByRole("alert")).toBeVisible();
    await page.goto("/ngo");
    await expect(page).toHaveURL(/\/login/);
  });

  test("sign-out ends the console session", async ({ page }) => {
    await signIn(page, ngoAdmin.email, ngoAdmin.password);
    await expect(page).toHaveURL(/\/ngo$/);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/ngo");
    await expect(page).toHaveURL(/\/login/);
  });
});
