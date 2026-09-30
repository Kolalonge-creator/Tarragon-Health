import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "./helpers/supabase-admin";

/**
 * Phone sign-up, verification, sign-in and recovery (S03, functions 1.1 to 1.3 and 1.6), through the real UI.
 *
 * Runs against the local Supabase stack only (see README.md). The three phone numbers below are listed in
 * supabase/config.toml under [auth.sms.test_otp] with the fixed code 123456, so GoTrue accepts that code and sends no
 * SMS. The production path (Send SMS hook -> provider) is covered by the Deno tests in
 * supabase/functions/auth-send-sms-hook; this suite proves the screens and the Auth wiring around it.
 *
 * NOT RUN in the session that wrote it (no Docker on that machine); CI's e2e-browser job is the first real run.
 */
const CODE = "123456";
const SIGNUP_PHONE_LOCAL = "8031230001"; // +2348031230001
const SIGNUP_PHONE_E164 = "+2348031230001";
const SEEDED_PHONE_LOCAL = "8031230002"; // +2348031230002, a confirmed account
const SEEDED_PHONE_E164 = "+2348031230002";
const UNVERIFIED_PHONE_LOCAL = "8031230003"; // +2348031230003, created but never confirmed
const UNVERIFIED_PHONE_E164 = "+2348031230003";
const DIRECT_PHONE_E164 = "+2348031230004"; // used only by the direct GoTrue sign-up test, never deleted
const UNKNOWN_PHONE_LOCAL = "8031239999"; // not registered and not in test_otp
const PASSWORD = "E2e-phone-pw-!Aa1-first";
const NEW_PASSWORD = "E2e-phone-pw-!Aa1-second";

async function deleteUserByPhone(phone: string): Promise<void> {
  // GoTrue stores and returns the number with or without the plus depending on version; compare digits only, and look
  // past the first page so a busy stack cannot hide a leftover user (a leftover made every retry fail in CI).
  const digits = phone.replace(/\D/g, "");
  for (let page = 1; page <= 20; page++) {
    const { data } = await adminClient.auth.admin.listUsers({ page, perPage: 200 });
    const users = data?.users ?? [];
    const found = users.find((u) => (u.phone ?? "").replace(/\D/g, "") === digits);
    if (found) {
      // Warn, never swallow silently and never throw: CI showed deleting a user that has signed up fails on the stack
      // (audit_log is append-only, so a profile that is an audit actor cannot be removed). A leftover is harmless on the
      // fresh CI database; what it must not do is hide behind a generic error, so the reason is printed.
      const { error } = await adminClient.auth.admin.deleteUser(found.id);
      if (error) {
        console.warn(`[e2e-test] could not delete ${phone}: status=${error.status} code=${(error as { code?: string }).code} message=${JSON.stringify(error.message)}`);
      }
      return;
    }
    if (users.length < 200) return;
  }
}

async function openPhonePasswordLogin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: /^phone$/i }).click();
}

async function fillLogin(page: Page, local: string, password: string): Promise<void> {
  await page.locator("#phone").fill(local);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

// No retries: every attempt re-signs-up the same number, and phone sign-up is limited to 3 an hour per number in the
// dev server's memory, so a retry only adds a "Too many attempts" failure on top of the real one.
test.describe.configure({ mode: "serial", retries: 0 });

test.beforeAll(async () => {
  await deleteUserByPhone(SIGNUP_PHONE_E164);
  await deleteUserByPhone(SEEDED_PHONE_E164);
  await deleteUserByPhone(UNVERIFIED_PHONE_E164);

  const seeded = await adminClient.auth.admin.createUser({
    phone: SEEDED_PHONE_E164,
    password: PASSWORD,
    phone_confirm: true,
    user_metadata: { full_name: "[e2e-test] Phone Patient" },
  });
  if (seeded.error) throw seeded.error;

  const unverified = await adminClient.auth.admin.createUser({
    phone: UNVERIFIED_PHONE_E164,
    password: PASSWORD,
    phone_confirm: false,
    user_metadata: { full_name: "[e2e-test] Unverified Phone" },
  });
  if (unverified.error) throw unverified.error;
});

test.afterAll(async () => {
  await deleteUserByPhone(SIGNUP_PHONE_E164);
  await deleteUserByPhone(SEEDED_PHONE_E164);
  await deleteUserByPhone(UNVERIFIED_PHONE_E164);
});

test.describe("phone sign-up", () => {
  // Isolates the Auth stack from the UI: if this passes and the UI test below fails, the problem is in the app; if this
  // fails, the message says exactly what GoTrue rejected (status, code, text), which the UI deliberately hides.
  test("Auth itself accepts a phone sign-up for a test-OTP number", async () => {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error } = await anon.auth.signUp({
      phone: DIRECT_PHONE_E164,
      password: PASSWORD,
      options: { data: { full_name: "[e2e-test] Direct Sign-up" } },
    });
    const code = (error as { code?: string } | null)?.code;
    expect(error, `Auth rejected a direct phone sign-up: status=${error?.status} code=${code} message=${error?.message}`).toBeNull();
    // Deliberately not deleted: this number is separate from the UI test's, so a leftover cannot collide with it.
  });

  test("creates the account, shows the code step, and only a correct code signs the person in", async ({ page }) => {
    // First hits of /signup and /patient compile on demand in `next dev`; the default 30s cut this test off with the
    // code step already on screen (PR 816 CI screenshot).
    test.setTimeout(120_000);
    await page.goto("/signup");
    await page.getByRole("tab", { name: /^phone$/i }).click();
    await page.locator("#firstName").fill("E2e");
    await page.locator("#lastName").fill("Phone");
    // Typed the way people actually type it, with the domestic leading zero and spaces.
    await page.locator("#phone").fill("0803 123 0001");
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();

    // Step 2: the code. The number is masked, never echoed in full. If it does not appear, say WHY (the form's own error
    // text) instead of only "element not found".
    await page.locator("#token").or(page.getByRole("alert").filter({ hasText: /\S/ })).first().waitFor({ timeout: 15_000 });
    const alertText = await page.getByRole("alert").filter({ hasText: /\S/ }).first().textContent().catch(() => null);
    expect(alertText, `sign-up showed an error instead of the code step: ${alertText}`).toBeNull();
    await expect(page.locator("#token")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(SIGNUP_PHONE_LOCAL.slice(0, 3))).toHaveCount(0);

    // Wrong code: stays on the code step, signs nobody in.
    await page.locator("#token").fill("000000");
    await page.getByRole("button", { name: /confirm/i }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/signup/);

    // Resend is held back by the visible 60 second countdown.
    await expect(page.getByRole("button", { name: /send a new code/i })).toBeDisabled();

    // Correct code: signed in, off the signup page.
    await page.locator("#token").fill(CODE);
    await page.getByRole("button", { name: /confirm/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/signup"), { timeout: 20_000 });
  });

  test("an impossible number is refused on the form and creates no account", async ({ page }) => {
    await page.goto("/signup");
    await page.getByRole("tab", { name: /^phone$/i }).click();
    await page.locator("#firstName").fill("E2e");
    await page.locator("#lastName").fill("Bad");
    await page.locator("#phone").fill("0603123456");
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator("#token")).toHaveCount(0);
  });
});

test.describe("phone sign-in", () => {
  test("a confirmed number signs in with its password", async ({ page }) => {
    await openPhonePasswordLogin(page);
    await fillLogin(page, SEEDED_PHONE_LOCAL, PASSWORD);
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
  });

  test("a wrong password and an unknown number show the same message", async ({ page }) => {
    await openPhonePasswordLogin(page);
    await fillLogin(page, SEEDED_PHONE_LOCAL, "definitely-wrong-password");
    const wrong = await page.getByRole("alert").textContent();

    await page.goto("/login");
    await page.getByRole("button", { name: /^phone$/i }).click();
    await fillLogin(page, UNKNOWN_PHONE_LOCAL, "definitely-wrong-password");
    const unknown = await page.getByRole("alert").textContent();

    expect(wrong).toBeTruthy();
    expect(unknown).toBe(wrong);
  });

  test("a number that was never confirmed cannot sign in: it gets the code step instead of a session", async ({ page }) => {
    await openPhonePasswordLogin(page);
    await fillLogin(page, UNVERIFIED_PHONE_LOCAL, PASSWORD);
    await expect(page.locator("#token")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/login/);

    await page.locator("#token").fill(CODE);
    await page.getByRole("button", { name: /confirm/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
  });
});

test.describe("recovery", () => {
  test("a registered number: code, then a new password that really works", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByRole("button", { name: /^phone$/i }).click();
    await page.locator("#phone").fill(SEEDED_PHONE_LOCAL);
    await page.getByRole("button", { name: /send code/i }).click();

    await expect(page.locator("#token")).toBeVisible({ timeout: 15_000 });
    await page.locator("#token").fill(CODE);
    await page.getByRole("button", { name: /verify/i }).click();

    await page.waitForURL(/\/reset-password/, { timeout: 15_000 });
    await page.locator("#password").fill(NEW_PASSWORD);
    await page.locator("#confirmPassword").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: /update password/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/reset-password"), { timeout: 20_000 });

    // The old password no longer works; the new one does.
    await page.context().clearCookies();
    await openPhonePasswordLogin(page);
    await fillLogin(page, SEEDED_PHONE_LOCAL, PASSWORD);
    await expect(page.getByRole("alert")).toBeVisible();
    await page.goto("/login");
    await page.getByRole("button", { name: /^phone$/i }).click();
    await fillLogin(page, SEEDED_PHONE_LOCAL, NEW_PASSWORD);
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
  });

  test("an unregistered number gets the same code screen and no account is created", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByRole("button", { name: /^phone$/i }).click();
    await page.locator("#phone").fill(UNKNOWN_PHONE_LOCAL);
    await page.getByRole("button", { name: /send code/i }).click();

    // Indistinguishable from the registered case: the code step appears.
    await expect(page.locator("#token")).toBeVisible({ timeout: 15_000 });

    // And asking for a code did not CREATE an account for that number (it used to).
    const { data } = await adminClient.auth.admin.listUsers();
    expect(data?.users.some((u) => u.phone === "2348031239999")).toBe(false);
  });
});
