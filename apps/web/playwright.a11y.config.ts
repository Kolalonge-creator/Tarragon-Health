import { defineConfig, devices } from "@playwright/test";

/**
 * Website accessibility check (website upgrade Phase 6). Scans every public marketing page with axe-core against
 * WCAG 2.2 A/AA, on a phone and a desktop viewport, and checks that reduced-motion visitors get no moving video.
 *
 * Runs against a production build (`next build` first, then this config starts `next start`). No database, no
 * secrets: with no Supabase env the marketing pages fall back to their built-in content, which is the same markup.
 * Separate from playwright.config.ts (write flows, local Supabase) and playwright.smoke.config.ts (signed-in
 * smoke against production) on purpose: this one needs nothing but the build.
 */
const PORT = Number(process.env.A11Y_PORT ?? 3477);
// Point at a deployed site instead (for example a Vercel preview, or the live site to compare): no local server.
const EXTERNAL_BASE_URL = process.env.A11Y_BASE_URL;

export default defineConfig({
  testDir: "./e2e-a11y",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  use: { baseURL: EXTERNAL_BASE_URL ?? `http://localhost:${PORT}` },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
  ],
  webServer: EXTERNAL_BASE_URL
    ? undefined
    : {
        command: `pnpm exec next start -p ${PORT}`,
        url: `http://localhost:${PORT}/`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
