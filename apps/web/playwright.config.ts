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
  // fullyParallel left at Playwright's own default (false): tests within
  // ONE FILE always share a worker and run in declaration order — exactly
  // what employer-eligibility.spec.ts's 3 tests want (they share one
  // beforeAll-seeded org; fullyParallel:true could split them across
  // workers, running that beforeAll/afterAll redundantly once per worker
  // for no benefit, since these are 3 fast, already-sequential tests).
  // b2c-signup-to-entitlement.spec.ts's "authenticated patient journey"
  // block has a real ordering dependency beyond this and declares its own
  // test.describe.configure({ mode: "serial" }) for that. No `workers` cap
  // here, unlike the removed `workers: 1` — DIFFERENT files (this one vs.
  // employer-eligibility.spec.ts) are independent and can run concurrently
  // across workers; only intra-file order needed protecting.
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
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // Reverted from --webpack: that attempt PROVED the bug is not
    // Turbopack-specific — the stack trace changed shape (`proxy$1`,
    // webpack's own naming, confirming --webpack genuinely ran) but the
    // exact same "Invalid supabaseUrl" persisted. Back to plain `pnpm dev`
    // (Turbopack, this repo's normal dev experience) now that the bundler
    // is ruled out as the variable.
    command: "pnpm dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      PORT: String(PORT),
      // Forced explicitly rather than left to whatever ambient value this
      // CI job's own environment carries — untested until now.
      // node_modules/next/dist/docs/01-app/02-guides/environment-variables.md
      // (line 250/272) documents that .env.local is never loaded at all
      // when NODE_ENV=test, and this repo's own next.config.ts now also
      // has a (still-failing) `env` field explicitly setting these same 2
      // vars — if NODE_ENV really is "test" here, BOTH of those failing
      // makes sense together, since .env.local wouldn't load AND the
      // "legacy" (next.config.ts's own env.md doc's word) `env` config
      // field may have equally undocumented dev-mode-under-test gaps.
      // `next dev` defaults NODE_ENV to "development" only when the var is
      // UNASSIGNED (same doc, "Good to know") — if something upstream in
      // this CI job (Playwright itself, actions/setup-node, or turbo) is
      // setting it to "test" first, that default never kicks in.
      NODE_ENV: "development",
    },
  },
});
