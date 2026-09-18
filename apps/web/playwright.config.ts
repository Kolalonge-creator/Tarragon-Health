import { defineConfig, devices } from "@playwright/test";
import { PORT, BASE_URL } from "./e2e/env";

/**
 * Browser E2E smoke suite — apps/web has no separate staging Supabase
 * project (CLAUDE.md: one live production project, koiplnmbgnqnbywhpjlf),
 * so this always runs against a locally-run `next dev` server while auth
 * and data come from the shared production database via the 23 dedicated
 * `@tarragon.test` QA accounts (see e2e/fixtures.ts's `qaPassword()` for
 * the shared password — deliberately NOT written here or anywhere else in
 * source; this repo is public).
 *
 * This suite is READ-ONLY / NAVIGATION-ONLY by design: it logs in,
 * navigates, and asserts pages render — it never submits a form that
 * writes data (no vitals logging, no bookings, no payments, no messages,
 * no consent changes). See e2e/fixtures.ts's header comment and the
 * individual spec files for the full rationale; do not add a write/submit
 * action to this suite without re-reading that constraint.
 */

export default defineConfig({
  testDir: "./e2e",
  // `./e2e` is shared with the pre-existing Jest-based `test:e2e` suite
  // (jest.e2e.config.mjs, matching `*.e2e.test.ts` — a real-infra
  // DB-trigger/Edge-Function suite, not a browser test). Scope Playwright to
  // only its own `*.spec.ts` files so it never tries to load a Jest test
  // file as a Playwright one (that file uses Jest's global `describe`,
  // which doesn't exist under Playwright's runner).
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // Generous margin for a real, sometimes-slow round trip to the live
  // production Supabase project (this suite has no staging DB to fall back
  // to) — every route here is pre-built (see webServer's own comment on
  // why this runs a production build, not `next dev`), so this is headroom
  // for network/query time, not compile time.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    // Deliberately NOT "retain-on-failure" for trace/video: `loginAs()`
    // fills the real QA account password into the login form, and a
    // Playwright trace's action log / DOM snapshots record that value in
    // plain text regardless of the input's `type="password"` masking
    // (masking is CSS-only; the underlying element value is still the raw
    // string, and a trace serializes real DOM state). CI's "Upload
    // Playwright report" step publishes `playwright-report/` as a build
    // artifact on a PUBLIC repo — a retained trace would hand the shared
    // production QA password to anyone who can read the repo. Screenshot
    // and video are both plain pixel captures of a password-masked (dotted)
    // field — genuinely safe on their own — but screenshot stays on
    // (only-on-failure, real debugging value, no credential risk) while
    // video stays off purely for artifact-size hygiene, not a credential
    // concern.
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // A real production build+start, not `next dev`. `next dev`'s
    // on-demand-per-route Turbopack compile was tried first (faster to
    // boot for local iteration) but produced real, intermittent failures
    // in practice: under repeated/concurrent navigation across several
    // routes, requests to an already-visited route occasionally still hit
    // Next's own root not-found.tsx (a genuine 404 from the dev router,
    // not a test bug — every one of this repo's platform AND marketing
    // routes share that single not-found.tsx, so it's easy to mistake for
    // a host-routing problem, but it isn't one) rather than the real page.
    // A production build has no on-demand compile step — every route is
    // already built before the server accepts its first request — so this
    // whole class of flakiness doesn't apply. `next build` measured ~40s
    // locally; still comfortably inside the timeout below even accounting
    // for a slower CI runner.
    command: `npx next build && npx next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
