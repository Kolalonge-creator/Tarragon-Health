import { type Page, expect } from "@playwright/test";
import { APP_ORIGIN } from "./env";

/**
 * Shared fixtures for the browser E2E smoke suite.
 *
 * READ-ONLY / NAVIGATION-ONLY, always — see playwright.config.ts's header
 * comment for why. This suite runs against the real, shared production
 * Supabase project (koiplnmbgnqnbywhpjlf — this platform has no staging
 * database), through the 23 dedicated `@tarragon.test` QA accounts. Never
 * add a helper here that submits a form that writes data (vitals, bookings,
 * payments, messages, consent). If a flow needs to be driven further than
 * "the page loaded and the controls are present," stop one step before the
 * final submit/confirm action.
 */

/**
 * All QA test accounts share this one password (see project memory
 * `project_qa_test_accounts_20260727.md`) — real, live, standing accounts in
 * production, not ephemeral fixtures. Deliberately NOT hardcoded here: this
 * is a real credential and this repository is public
 * (`Kolalonge-creator/Tarragon-Health`), so a literal in source is a real
 * leak, not a theoretical one — see the CLAUDE.md "Never hardcode
 * credentials" rule.
 *
 * Must be exported in the shell that runs `pnpm e2e` / `npx playwright
 * test` itself — e.g. `PLAYWRIGHT_QA_PASSWORD=... pnpm e2e`, or `export`ed
 * beforehand. Putting it in `apps/web/.env.local` alone is NOT enough: that
 * file is loaded by the spawned `next build`/`next start` child process
 * (playwright.config.ts's `webServer`), not by the Playwright test runner
 * itself, and this function runs in the runner, not in the app. In CI, set
 * it as a repo secret for `.github/workflows/e2e-browser.yml` (see that
 * workflow's own header comment — it is not wired in yet as of this PR).
 */
// A function, not a top-level constant: a spec file that imports this module
// but never actually signs in (e.g. auth.spec.ts's unauthenticated-redirect
// test) must not fail just because it happened to import from the same file
// — only a test that actually calls this should need the env var set.
export function qaPassword(): string {
  const value = process.env.PLAYWRIGHT_QA_PASSWORD;
  if (!value) {
    throw new Error(
      "PLAYWRIGHT_QA_PASSWORD is not set. This suite signs in with a real QA account " +
        "password that must never live in source (this repo is public) — export it in " +
        "the shell running Playwright (apps/web/.env.local alone is not enough, see this " +
        "function's own doc comment), or set it as a CI secret. Ask the founder for the " +
        "current value; do not hardcode it here."
    );
  }
  return value;
}

export const QA_ACCOUNTS = {
  patientFree: "patient.free.test@tarragon.test",
  clinicianTier1: "clinician.tier1.test@tarragon.test",
} as const;

/**
 * The platform's own routing depends on the `app.` subdomain
 * (apps/web/src/lib/marketing/host.ts's `isAppHost` / apps/web/src/proxy.ts)
 * to tell the platform apart from the marketing site — a plain
 * `localhost`/`127.0.0.1` origin serves the marketing site's 404 for every
 * `/patient/*` and `/clinician/*` path. `playwright.config.ts`'s `baseURL`
 * is therefore `http://app.localhost:<port>`, which every browser resolves
 * to loopback with no `/etc/hosts` entry needed (RFC 6761).
 */

/**
 * Signs in via the real login form (email/password tab, which is the
 * default) and waits for the post-login redirect to land somewhere other
 * than /login. Every route is pre-built (playwright.config.ts's webServer
 * runs `next build && next start`, not `next dev` — no on-demand compile
 * step), so this is headroom for a real network round trip to production
 * Supabase Auth on a possibly-loaded CI runner, not compile time; observed
 * well under 2s locally in practice. Left comfortably inside the 60s
 * per-test timeout (playwright.config.ts) rather than eating most of that
 * budget on its own.
 */
export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
}

function isSameOrigin(url: string): boolean {
  // Compared against the fixed, config-derived APP_ORIGIN — not
  // `page.url()` sampled at event-fire time. The latter is racy for a
  // page's very first navigation: a `response` event for the login
  // document's own request can fire before the frame commit updates
  // `page.url()` away from "about:blank" (origin "null"), which would
  // silently misclassify that very request as cross-origin and drop it
  // from consideration — exactly the kind of same-origin server failure
  // this watcher exists to catch.
  try {
    return new URL(url).origin === APP_ORIGIN;
  } catch {
    // A malformed/non-http URL is never same-origin.
    return false;
  }
}

/**
 * Starts collecting console errors and failed same-origin network requests
 * for `page` — both a completed response with a 5xx status AND a request
 * that never got a response at all (connection reset, aborted, DNS
 * failure — Playwright's `requestfailed` event; a `response` listener alone
 * would miss these, since a server crash mid-request often never completes
 * an HTTP response for the `response` event to fire on). Registers its
 * `console`/`pageerror`/`response`/`requestfailed` listeners exactly once,
 * for the lifetime of the returned watcher — call `reset()` before each
 * navigation you want judged independently (needed when several tests share
 * one `page`, e.g. patient.spec.ts's beforeAll-login pattern; unnecessary,
 * but harmless, when each test gets its own fresh `page` fixture) and
 * `assertNoPageErrors()` once it has settled.
 */
export function watchForPageErrors(page: Page) {
  let consoleErrors: string[] = [];
  let failedRequests: string[] = [];

  // Deliberately NOT same-origin-scoped, unlike the response/requestfailed
  // listeners below: a console.error from a third-party embed a future page
  // adds is still worth surfacing here rather than silently ignoring, and
  // this suite has none of those today (the one previously-known source of
  // console noise, React dev tooling's eval() CSP error, doesn't fire under
  // this suite's production build+start — see playwright.config.ts's
  // webServer comment for why it's a production build). If a real,
  // unrelated third-party console.error ever does show up here and needs
  // to be treated as expected noise rather than a regression, that's the
  // moment to add a scoped/allowlisted filter back — not preemptively now.
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  page.on("response", (response) => {
    const url = response.url();
    if (isSameOrigin(url) && response.status() >= 500) {
      failedRequests.push(`${response.status()} ${response.request().method()} ${url}`);
    }
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    const reason = request.failure()?.errorText ?? "unknown error";
    // net::ERR_ABORTED is Chromium's normal signal for "this request was
    // cancelled because the page navigated away before it finished" (an
    // in-flight prefetch/analytics beacon from the PREVIOUS page when a
    // test calls page.goto() again, most commonly) — routine, not a
    // failure, and reset()'s own callers navigate repeatedly on one shared
    // page in exactly the pattern that triggers it. Anything else (a
    // connection reset, DNS failure, etc.) is a real same-origin failure.
    if (isSameOrigin(url) && reason !== "net::ERR_ABORTED") {
      failedRequests.push(`FAILED (${reason}) ${request.method()} ${url}`);
    }
  });

  return {
    /** Clears everything captured so far — call before a navigation whose
     * errors should be judged on their own, independent of anything a
     * shared page already did earlier in the same test file. */
    reset(): void {
      consoleErrors = [];
      failedRequests = [];
    },
    assertNoPageErrors(): void {
      expect(consoleErrors, "unexpected browser console errors").toEqual([]);
      expect(failedRequests, "unexpected failed same-origin requests").toEqual([]);
    },
  };
}
