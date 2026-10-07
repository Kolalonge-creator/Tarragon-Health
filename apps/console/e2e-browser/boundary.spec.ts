import { expect, test } from "@playwright/test";

/**
 * Console boundary checks that need no database and no session: the security
 * posture an anonymous caller (or a crawler, or a framing attacker) sees.
 * Always runs.
 */
test.describe("console boundary (anonymous)", () => {
  test("liveness answers without touching auth", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true, app: "console" });
  });

  test("a console path sends an anonymous caller to login and remembers the destination", async ({ page }) => {
    await page.goto("/ngo");
    await expect(page).toHaveURL(/\/login\?redirect=%2Fngo$/);
    await expect(page.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
  });

  test("a non-extracted staff path is not served either", async ({ page }) => {
    await page.goto("/clinician/patients");
    await expect(page).toHaveURL(/\/login\?redirect=/);
  });

  test("the sign-in page carries the strict security headers", async ({ request }) => {
    const res = await request.get("/login");
    const headers = res.headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["cache-control"]).toContain("no-store");
    expect(headers["x-robots-tag"]).toContain("noindex");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    const csp = headers["content-security-policy"] ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("youtube");
  });

  test("robots.txt disallows everything", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(await res.text()).toContain("Disallow: /");
  });
});
