import { expect, test, type Page } from "@playwright/test";
import { ownIp } from "./helpers/own-ip";

// helpers/own-ip.ts relies on two facts: the sign-in limiter is keyed on the first x-forwarded-for entry, and the server keeps a
// value the browser sends. If either stops being true, every UI sign-in goes back into one shared bucket and the suite starts failing
// with "Too many attempts" near its end (PR 1558, 2026-10-30). This spec checks both facts directly, without needing a real account:
// each attempt uses an address nobody has, so the form refuses it, but the limiter counts it before Auth is asked.

const RATE_LIMITED = /Too many attempts/;
const MAX_ATTEMPTS = 40; // the limit is 20 per 5 minutes today; this only needs to be comfortably above it

async function attempt(page: Page, n: number): Promise<boolean> {
  await page.locator("#email").fill(`e2e-test-bucket-${Date.now()}-${n}@example.com`);
  await page.locator("#password").fill("E2e-test-pw-not-a-real-account-1!");
  // The previous attempt's message stays on screen until the next answer replaces it, so wait for this attempt's own response and for
  // the button to come back from "Signing in..." before reading the message.
  const answered = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/login", { timeout: 30_000 });
  await page.getByRole("button", { name: "Sign in" }).click();
  await answered;
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible({ timeout: 30_000 });
  const message = page.getByRole("alert").filter({ hasText: /\S/ }).first();
  await expect(message).toBeVisible({ timeout: 30_000 });
  return RATE_LIMITED.test((await message.textContent()) ?? "");
}

async function openLogin(page: Page): Promise<void> {
  await page.goto("/login");
  // a click on a form that has not hydrated yet is a plain GET that reloads /login with blank fields
  await page.waitForLoadState("networkidle");
}

test.describe("sign-in rate limit buckets", () => {
  test.setTimeout(240_000);

  test("one client address is limited, and a different x-forwarded-for gets its own bucket", async ({ browser }) => {
    const first = await browser.newContext({ extraHTTPHeaders: ownIp() });
    const page = await first.newPage();
    await openLogin(page);
    let limitedAt = 0;
    for (let n = 1; n <= MAX_ATTEMPTS && limitedAt === 0; n += 1) {
      if (await attempt(page, n)) limitedAt = n;
    }
    expect(limitedAt, `the limiter never refused in ${MAX_ATTEMPTS} sign-ins from one address`).toBeGreaterThan(1);

    // a second address is not affected by the first one's count
    const second = await browser.newContext({ extraHTTPHeaders: ownIp() });
    const other = await second.newPage();
    await openLogin(other);
    expect(await attempt(other, 1), "a new x-forwarded-for was still limited: the header is not what the limiter keys on").toBe(false);

    await first.close();
    await second.close();
  });
});
