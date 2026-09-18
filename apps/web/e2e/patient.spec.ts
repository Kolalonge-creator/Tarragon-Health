import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { loginAs, watchForPageErrors, QA_ACCOUNTS, qaPassword } from "./fixtures";

/**
 * Patient golden-path smoke coverage. READ-ONLY: signs in once as the
 * standing `patient.free.test` QA account and only navigates/asserts —
 * never submits a form that writes data (see fixtures.ts's header comment).
 *
 * Signs in exactly once for the whole file (`beforeAll`, not per-test) and
 * reuses the resulting session across all 4 tests below — each still gets
 * its own real page/navigation to assert against, but this suite is already
 * read-only and already serialized (`workers: 1` in playwright.config.ts),
 * so there is no isolation benefit to a fresh real sign-in per test, only
 * 4x the load against the one shared production auth backend. The error
 * watcher is likewise created once (`watchForPageErrors` only ever attaches
 * its listeners once per page) and `reset()` before each test's own
 * navigation, rather than re-attached per test, which would stack duplicate
 * listeners on the one shared `page`.
 */
test.describe("patient", () => {
  let context: BrowserContext;
  let page: Page;
  let errorWatcher: ReturnType<typeof watchForPageErrors>;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    errorWatcher = watchForPageErrors(page);
    await loginAs(page, QA_ACCOUNTS.patientFree, qaPassword());
    // Asserted HERE, not left for the first test: the first test's own
    // errorWatcher.reset() (needed so ITS assertion covers only its own
    // navigation, not this login too) would otherwise silently discard
    // whatever the sign-in itself produced before anything ever checked
    // it — a real console error or failed request during login would pass
    // unnoticed. A failure here fails the whole describe block (all 4
    // tests, reported as a hook failure) rather than one test, which is
    // the right shape: if login itself is broken, none of their
    // navigations are meaningful either.
    errorWatcher.assertNoPageErrors();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("dashboard's key sections render with no console/network errors", async () => {
    // Login already happened in beforeAll, before this test's own reset() —
    // a fresh navigation here is what makes the assertion below genuinely
    // cover this page's load rather than one this test never observed.
    errorWatcher.reset();
    await page.goto("/patient");

    // Core Overview sections a patient relies on every visit — greeting
    // banner, the sidebar nav, and the quick-actions row — all matched by
    // href rather than English copy. This account's UI language could in
    // principle be switched to Pidgin (patients can change it, and the
    // platform ships real Pidgin coverage — see project memory
    // project_pidgin_lifestyle_tracker_coverage_20260911), which would
    // silently break an assertion on translated text like the
    // quick-actions section's own "Quick actions" heading
    // (quick-actions.tsx's tr("Quick actions")) — hrefs never translate.
    // "Patient dashboard" and the "Here's how ... is going" greeting are
    // untranslated static/server-built strings (dashboard-placeholder.tsx,
    // (sections)/page.tsx), so those two stay text assertions.
    await expect(page.getByText("Patient dashboard")).toBeVisible();
    await expect(page.getByText(/Here's how .* is going\./)).toBeVisible();
    // Several of these hrefs (vitals/appointments/messages/labs) appear
    // MORE THAN ONCE in the DOM at this viewport size — once in the desktop
    // `<aside>` sidebar (app-shell.tsx, the visible one), again in the
    // `lg:hidden` BottomTabBar rendered later in the same file for mobile,
    // and some again in the quick-actions row's own cards
    // (quick-actions.tsx). Scoping to the `complementary` landmark (the one
    // and only `<aside>`) makes these locators resolve to the visible
    // sidebar copy by structure, not by DOM-order luck — `.first()` alone
    // would silently start resolving to a CSS-hidden duplicate if
    // AppShell's/QuickActions' JSX were ever reordered, with no change to
    // this file needed to break it.
    const sidebar = page.getByRole("complementary");
    await expect(sidebar.locator('a[href="/patient/vitals"]')).toBeVisible();
    await expect(sidebar.locator('a[href="/patient/appointments"]')).toBeVisible();
    await expect(sidebar.locator('a[href="/patient/messages"]')).toBeVisible();
    await expect(sidebar.locator('a[href="/patient/labs"]')).toBeVisible();

    errorWatcher.assertNoPageErrors();
  });

  test("vitals page renders the logging form and trend tabs", async () => {
    errorWatcher.reset();
    await page.goto("/patient/vitals");

    await expect(
      page.getByRole("heading", { name: "Vitals & symptoms", exact: true })
    ).toBeVisible();
    await expect(page.getByText("Log a reading", { exact: false }).first()).toBeVisible();

    errorWatcher.assertNoPageErrors();
  });

  test("appointments page renders the booking surface", async () => {
    errorWatcher.reset();
    await page.goto("/patient/appointments");

    await expect(
      page.getByRole("heading", { name: "Appointments", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Your upcoming appointments", exact: true })
    ).toBeVisible();

    errorWatcher.assertNoPageErrors();
  });

  test("messages page renders the care-team thread list", async () => {
    errorWatcher.reset();
    await page.goto("/patient/messages");

    // Two "Messages" headings share this page (the page's own H1 plus the
    // thread-list panel's own card header) — .first() is enough for a smoke
    // check that the heading text is present at all.
    await expect(
      page.getByRole("heading", { name: "Messages", exact: true }).first()
    ).toBeVisible();
    await expect(
      page.getByText("Message your care team in the app and they'll reply here.", {
        exact: false,
      })
    ).toBeVisible();

    errorWatcher.assertNoPageErrors();
  });
});
