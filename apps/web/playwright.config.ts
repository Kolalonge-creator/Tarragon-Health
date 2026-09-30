import { defineConfig, devices } from "@playwright/test";

/**
 * Sibling to `playwright.smoke.config.ts` (`./e2e`, `pnpm e2e`), which runs
 * a read-only login/navigation smoke suite against the real production
 * Supabase project via the shared `@tarragon.test` QA accounts. This one
 * runs write-capable flows (signup, checkout, entitlement) against a fresh
 * LOCAL Supabase stack instead — the two are kept as separate config files
 * and separate CI jobs deliberately: different webServer commands,
 * different target databases, different risk profiles.
 *
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

// CI runs a production build (`next build` + `next start`), like apps/console's own suite does. `next dev` compiles each
// route on its first request, and in PR 816's CI that produced an intermittent /patient 404 that never cleared plus
// slow first hits; a production server has nothing to compile on demand. Locally the default stays `next dev`, which
// is quicker to start; set E2E_PRODUCTION_BUILD=1 to reproduce CI.
const PRODUCTION_BUILD = !!process.env.CI || process.env.E2E_PRODUCTION_BUILD === "1";

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
  // One worker in CI. With two, the dev server compiled routes for both files at once and, in PR 816's CI, answered
  // /patient with a 404 that never cleared (the same 404 the webServer comment below records), while the starved
  // phone-auth test hit its 30s timeout with the code step already on screen. Serial is slower but was the only
  // configuration that passed; revisit by running the suite against `next build` + `next start` instead of `next dev`.
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e-browser/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    // Every failed attempt, not just retries: on-first-retry hid the first attempt's error in PR 816 CI.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: PRODUCTION_BUILD ? `pnpm build && pnpm exec next start -p ${PORT}` : "pnpm dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: PRODUCTION_BUILD ? 600_000 : 120_000,
    // Pipe the dev server's own output so Playwright's report carries Next's request log. Found 2026-09-30: with the
    // default (stdout ignored) the b2c login test got a 404 for /patient on every attempt on the S01d branch; with
    // this it passed. Cause not established, so this is a workaround that also makes the next failure diagnosable.
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      PORT: String(PORT),
      // Explicit rather than left to whatever `next dev` would infer —
      // cheap insurance, not load-bearing for the real fix (see
      // .github/workflows/ci.yml's "Export local Supabase connection env
      // vars" step for the actual root cause this CI job hit: a naive
      // `cat >> $GITHUB_ENV` of the Supabase CLI's raw, quoted output left
      // literal quote characters inside NEXT_PUBLIC_SUPABASE_URL's value).
      ...(PRODUCTION_BUILD ? {} : { NODE_ENV: "development" }),
    },
  },
});
