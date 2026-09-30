import { defineConfig, devices } from "@playwright/test";

/**
 * Real-browser tests for the staff console. Same safety model as
 * apps/web/playwright.config.ts: write-capable specs run against a fresh LOCAL
 * Supabase stack only, and global-setup.ts refuses to start unless
 * NEXT_PUBLIC_SUPABASE_URL is local. See ../web/e2e-browser/README.md for why
 * this never targets the production project.
 *
 * Runs on its own port (3101) so it can sit beside the apps/web suite (3100).
 */
const PORT = Number(process.env.PLAYWRIGHT_CONSOLE_PORT ?? 3101);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e-browser",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e-browser/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // A production build, not `next dev`: the security headers under test
    // (Cache-Control no-store in particular, which dev mode overrides) only
    // behave like production in a production server.
    command: `pnpm build && pnpm exec next start -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { ...process.env, PORT: String(PORT) } as Record<string, string>,
  },
});
