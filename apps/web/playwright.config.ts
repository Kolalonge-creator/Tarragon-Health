import { defineConfig, devices } from "@playwright/test";

/**
 * Real browser E2E — distinct from jest.e2e.config.mjs's `e2e/` (which hits
 * the live project's DB/Edge Functions directly, bypassing the UI). These
 * specs drive the actual Next.js app in a real browser. Intended to run
 * against a fresh local Supabase stack (`supabase start` + `supabase db
 * reset`), never against the live production project — see e2e-browser's
 * own README for why, and .github/workflows/ci.yml's `e2e-browser` job for
 * how CI provisions one. NEXT_PUBLIC_SUPABASE_URL etc. must already point at
 * that local stack before this config's webServer boots the app; it does
 * not set them itself, so a developer running this locally against their
 * own `.env.local` (which points at the live project, per CLAUDE.md) would
 * be running these against production by mistake — the global setup below
 * refuses to proceed if the configured Supabase URL isn't a local one.
 */
const PORT = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 3100);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e-browser",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e-browser/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      PORT: String(PORT),
    },
  },
});
