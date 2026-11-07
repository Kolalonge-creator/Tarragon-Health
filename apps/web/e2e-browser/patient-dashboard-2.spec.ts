import { expect, test, type Page } from "@playwright/test";
import { deleteTestPatient, type TestPatient } from "./helpers/supabase-admin";
import { createJourneyPatient } from "./journeys/journey-helpers";
import { completeOnboardingFixture, createUser, signIn, type TestUser } from "./journeys/harness/sessions";
import { lit, sql, sqlValue } from "./journeys/harness/sql";
import { deleteAccount, gotoRoute, login } from "./helpers/staff-session";
import { ownIp } from "./helpers/own-ip";

// Patient dashboard 2.0, slice H (docs/design/PATIENT-DASHBOARD-2.md section 5 item 8): browser journeys for what shipped on main-dev in
// PRs 1798, 1800, 1804, 1805 and 1808. The journeys for PRs 1806 (care plan "what changed") and 1807 (record search, medicine "Not sure")
// are in patient-dashboard-2-pending.spec.ts, which skips with a named reason until those land.
//
// A. Home big numbers: a logged reading's value and a trend word. A failed read says so (forced on the Vitals history, the client read).
// B. Vitals empty state: exactly one "Log a reading" control.
// C. Appointments: the four chips; cancel asks first and "Keep it" keeps it booked; a seeded cancelled visit is under Cancelled.
// D. Notifications: the bell's "See all notifications" opens the centre; a category narrows the list; mark as read writes the row.
// F. Care Circle typed help (PD-08): the patient sends a type and a note; a supporter sees both and the "not an emergency" line;
//    the supporter's notification is routine.
// I. A 390px and 1280px crawl of the main patient pages: no horizontal page scroll, no uncaught errors.
//
// Local stack only (global-setup refuses anything else). Every account and row is is_test and prefixed [e2e-test] or [s85]. Seeding goes
// through psql (journeys/harness/sql.ts, E2E_DATABASE_URL); every assertion about what a person sees goes through the real browser.

const runId = `${Date.now()}8`;

const NOT_EMERGENCY = "This is not an emergency service. If you need care now, go to the nearest hospital.";
const REFILL_TEXT = "A reminder is coming up. Open the app to see when.";
const APPT_REMINDER_TEXT = "Reminder: you have an appointment coming up";
const HELP_NOTE = "Please can you drive me to the lab on Thursday morning";

// Device readings keep the taken_at they are given; a manual reading is stamped with the insert time (stamp_manual_vitals_timestamp).
function seedBp(patient: TestPatient, systolic: number, diastolic: number, ago: string): void {
  sql(`insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source, position, arm)
       values (${lit(patient.organisationId)}, ${lit(patient.userId)}, 'blood_pressure', ${systolic}, ${diastolic}, now() - interval '${ago}', 'device', 'seated', 'left');`);
}

/**
 * Overflows found by this crawl and reported, not fixed (this slice is tests only). Each is tolerated ONLY at the named path, below the
 * named width and with a culprit carrying the named text, so a new overflow anywhere still fails. Each has a test.fail twin below that
 * flips when it is fixed; delete the entry then.
 *   - Profile, 390px: the "Request a change to your name or date of birth" button (PR #1808, identity-change-card.tsx) does not wrap.
 */
const KNOWN_OVERFLOWS: { path: string; maxWidth: number; text: string }[] = [
  { path: "/patient/profile", maxWidth: 480, text: "Request a change to your name or date of" },
];

function isKnownOverflow(path: string, width: number, culprit: string): boolean {
  return KNOWN_OVERFLOWS.some((k) => k.path === path && width <= k.maxWidth && culprit.includes(k.text));
}

/**
 * No horizontal page scroll: the document is never wider than the viewport. On a failure it also names the elements whose right
 * edge passes the viewport (deepest first), so the report points at the cause rather than only the page.
 */
async function horizontalOverflow(page: Page): Promise<{ extra: number; culprits: string[] }> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const extra = root.scrollWidth - root.clientWidth;
    if (extra <= 1) return { extra, culprits: [] };
    const width = root.clientWidth;
    const culprits: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const rect = el.getBoundingClientRect();
      if (rect.right <= width + 1 || rect.width === 0) continue;
      // Only the deepest offender in a branch: skip an element whose child also overflows.
      const childOverflows = Array.from(el.children).some((c) => c.getBoundingClientRect().right > width + 1);
      if (childOverflows) continue;
      const cls = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 4).join(".") : "";
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      culprits.push(`<${el.tagName.toLowerCase()}${cls ? ` .${cls}` : ""}> right=${Math.round(rect.right)} "${text}"`);
      if (culprits.length >= 5) break;
    }
    return { extra, culprits };
  });
}

test.describe("Patient dashboard 2.0: the shipped journeys", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);
  test.use({ extraHTTPHeaders: ownIp() });

  let patient: TestPatient;
  let emptyPatient: TestPatient;
  let supporter: TestUser | undefined;
  let supportOnly: TestUser | undefined;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    // A data-rich patient for most journeys, and one with nothing logged for the Vitals empty state.
    patient = await createJourneyPatient(runId);
    sql(`update public.profiles set full_name = '[e2e-test] Dashboard Patient' where id = ${lit(patient.userId)};`);
    emptyPatient = await createJourneyPatient(`${runId}1`);

    // A: two readings this week, two earlier in the month, the newest 134/86. The recent mean is more than 3% above the earlier one,
    // so the tile's trend word is "Higher than earlier this month" (trendWord in @tarragon/shared reading-trends.ts).
    seedBp(patient, 134, 86, "1 hour");
    seedBp(patient, 132, 84, "2 days");
    seedBp(patient, 118, 76, "12 days");
    seedBp(patient, 120, 78, "20 days");

    // A medicine, so the crawl sees a populated Medicines page.
    sql(`insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active)
         values (${lit(patient.organisationId)}, ${lit(patient.userId)}, 'Amlodipine', '5 mg', 'once daily', 'patient', true);`);

    // C: one upcoming in-person visit that can be cancelled, one cancelled, one completed and one missed.
    // Terminal states carry their timestamp (appointments_*_has_timestamp CHECKs), exactly as the app's own transitions leave them.
    const appt = (status: string, at: string, location: string) =>
      `(${lit(patient.organisationId)}, ${lit(patient.userId)}, now() + interval '${at}', now() + interval '${at}' + interval '30 minutes',
        '${status}', 'gp', 'in_person', 'not_required', ${lit(location)},
        ${status === "cancelled" ? "now() - interval '4 days'" : "null"}, ${status === "completed" ? "now() + interval '" + at + "'" : "null"},
        ${status === "no_show" ? "now() + interval '" + at + "'" : "null"})`;
    sql(`insert into public.appointments (organisation_id, patient_id, scheduled_for, ends_at, status, appointment_type, consultation_method, payment_status, location,
           cancelled_at, completed_at, no_show_marked_at)
         values ${appt("confirmed", "5 days", "[e2e-test] Upcoming clinic")},
                ${appt("cancelled", "-3 days", "[e2e-test] Cancelled clinic")},
                ${appt("completed", "-10 days", "[e2e-test] Past clinic")},
                ${appt("no_show", "-7 days", "[e2e-test] Missed clinic")};`);

    // D: two in-app notices in different groups (Medicines and Appointments), a minute apart so neither is folded into the other.
    sql(`insert into public.notifications (recipient_id, channel, status, template, payload, created_at)
         values (${lit(patient.userId)}, 'in_app', 'pending', 'medication_refill_reminder', '{}'::jsonb, now() - interval '2 minutes'),
                (${lit(patient.userId)}, 'in_app', 'pending', 'appointment_reminder', '{}'::jsonb, now() - interval '1 minute');`);

    // F: two supporters in the patient's Care Circle holding red_alerts, each joined through the real invite and acceptance: a
    // supporter who is also a patient here (receives_care true) and a support-only account (receives_care false).
    const patientClient = await signIn({ id: patient.userId, email: patient.email, password: patient.password, label: "patient" });
    const join = async (label: string, receivesCare: boolean): Promise<TestUser> => {
      const who = await createUser(runId, label, { role: "patient", organisationId: patient.organisationId, fullName: `[e2e-test] ${label}` });
      completeOnboardingFixture(who.id, patient.organisationId, { receivesCare });
      const invite = await patientClient.rpc("create_care_circle_invite", {
        p_kind: "email",
        p_contact: who.email,
        p_relationship: "Daughter",
        p_permissions: ["red_alerts", "appointments"],
      });
      if (invite.error) throw new Error(`care circle invite failed: ${invite.error.message}`);
      const token = (invite.data as { token?: string } | null)?.token;
      if (!token) throw new Error("care circle invite returned no token");
      const accepted = await (await signIn(who)).rpc("accept_care_circle_invite", { p_token: token });
      if (accepted.error) throw new Error(`care circle accept failed: ${accepted.error.message}`);
      return who;
    };
    supporter = await join("pd2-supporter", true);
    supportOnly = await join("pd2-support-only", false);
  });

  test.afterAll(async () => {
    if (patient) await deleteTestPatient(patient);
    if (emptyPatient) await deleteTestPatient(emptyPatient);
    await deleteAccount(supporter?.id);
    await deleteAccount(supportOnly?.id);
  });

  test("A. Home: the blood pressure tile shows the latest reading and a trend word", async ({ page }) => {
    await login(page, patient, /\/patient/);
    await gotoRoute(page, "/patient");
    const tile = page.getByRole("link").filter({ hasText: "Blood pressure" }).filter({ hasText: "134/86" });
    await expect(tile.first()).toBeVisible({ timeout: 60_000 });
    await expect(tile.first()).toContainText("mmHg");
    await expect(tile.first()).toContainText("Higher than earlier this month");
    await expect(tile.first()).toContainText(/Today, \d{2}:\d{2}/);
  });

  test("A. Vitals: a failed read of the history says it could not load", async ({ page }) => {
    await login(page, patient, /\/patient/);
    // The history is read in the browser through the audited RPC; failing it is the cleanest way to force a failed read.
    await page.route("**/rest/v1/rpc/read_patient_vitals_audited*", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "forced by e2e", code: "XX000" }) }),
    );
    await gotoRoute(page, "/patient/vitals");
    await expect(page.getByText("Could not load your readings.")).toBeVisible({ timeout: 60_000 });
  });

  // Found while writing slice H: on a failed read VitalsHistory shows "No readings logged yet." UNDER the error line, because its empty
  // branch tests only !isLoading && no rows (vitals-history.tsx). That is the silent-failure shape the dashboard rules forbid. Marked
  // test.fail so the suite stays green while it is reported; the day the component is fixed, this flips and must be turned into a test().
  test("A. Vitals: a failed read never also says there are no readings (known bug, expected to fail)", async ({ page }) => {
    test.fail(true, "VitalsHistory shows its empty line beside the error on a failed read; reported in slice H, not fixed here (tests only).");
    await login(page, patient, /\/patient/);
    await page.route("**/rest/v1/rpc/read_patient_vitals_audited*", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "forced by e2e", code: "XX000" }) }),
    );
    await gotoRoute(page, "/patient/vitals");
    await expect(page.getByText("Could not load your readings.")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("No readings logged yet.")).toHaveCount(0);
  });

  test("B. Vitals empty state: exactly one Log a reading control", async ({ page }) => {
    await login(page, emptyPatient, /\/patient/);
    await gotoRoute(page, "/patient/vitals");
    await expect(page.getByText("No readings yet")).toBeVisible({ timeout: 60_000 });
    // Controls only: the form's own card title "Log a reading" is a heading, not something to press.
    const controls = page.locator("a:visible, button:visible").filter({ hasText: /log a reading/i });
    await expect(controls).toHaveCount(1);
  });

  test("C. Appointments: chips, cancel asks first, Keep it keeps it, and Cancelled lists the cancelled visit", async ({ page }) => {
    await login(page, patient, /\/patient/);
    await gotoRoute(page, "/patient/appointments");
    const chips = page.getByRole("group", { name: "Show appointments" });
    for (const label of ["Upcoming", "Past", "Cancelled", "Missed"]) {
      await expect(chips.getByRole("button", { name: label, exact: true })).toBeVisible({ timeout: 60_000 });
    }
    await expect(chips.getByRole("button", { name: "Upcoming", exact: true })).toHaveAttribute("aria-pressed", "true");

    // Cancel asks first; Keep it closes the question and nothing changes.
    await page.getByRole("button", { name: "Cancel", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Cancel this appointment?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep it" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Cancel", exact: true }).first()).toBeVisible();
    expect(
      sqlValue<string>(`select status::text from public.appointments where patient_id = ${lit(patient.userId)} and location = '[e2e-test] Upcoming clinic'`),
    ).toBe("confirmed");

    // The seeded cancelled visit is under Cancelled, with its badge, and is not shown as "nothing here".
    await chips.getByRole("button", { name: "Cancelled", exact: true }).click();
    await expect(chips.getByRole("button", { name: "Cancelled", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Cancelled appointments")).toBeVisible();
    const cancelledRow = page.getByRole("listitem").filter({ hasText: "[e2e-test] Cancelled clinic" });
    await expect(cancelledRow).toBeVisible({ timeout: 30_000 });
    await expect(cancelledRow).toContainText("GP");
    await expect(page.getByText("No cancelled appointments.")).toHaveCount(0);
    await expect(page.getByText("[e2e-test] Upcoming clinic")).toHaveCount(0);

    // Past and Missed read their own rows too.
    await chips.getByRole("button", { name: "Past", exact: true }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "[e2e-test] Past clinic" })).toBeVisible({ timeout: 30_000 });
    await chips.getByRole("button", { name: "Missed", exact: true }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "[e2e-test] Missed clinic" })).toBeVisible({ timeout: 30_000 });
  });

  test("D. Notifications: See all opens the centre, a category narrows it, mark as read writes the row", async ({ page }) => {
    await login(page, patient, /\/patient/);
    await gotoRoute(page, "/patient");
    const bell = page.getByRole("button", { name: /^Notifications/ });
    await expect(bell).toBeVisible({ timeout: 60_000 });
    await bell.click();
    await page.getByRole("link", { name: "See all notifications" }).click();
    await page.waitForURL(/\/patient\/notifications$/, { timeout: 60_000 });

    await expect(page.getByText(REFILL_TEXT)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(APPT_REMINDER_TEXT)).toBeVisible();

    const filters = page.getByRole("group", { name: "Show" });
    await filters.getByRole("button", { name: "Medicines", exact: true }).click();
    await expect(filters.getByRole("button", { name: "Medicines", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(REFILL_TEXT)).toBeVisible();
    await expect(page.getByText(APPT_REMINDER_TEXT)).toHaveCount(0);

    const row = page.getByRole("listitem").filter({ hasText: REFILL_TEXT });
    await row.getByRole("button", { name: "Mark as read" }).click();
    await expect(row.getByRole("button", { name: "Mark as read" })).toHaveCount(0, { timeout: 30_000 });
    await expect
      .poll(() => sqlValue<string>(`select status::text from public.notifications where recipient_id = ${lit(patient.userId)} and template = 'medication_refill_reminder'`), {
        timeout: 30_000,
      })
      .toBe("read");
    // The other group is untouched.
    expect(sqlValue<string>(`select status::text from public.notifications where recipient_id = ${lit(patient.userId)} and template = 'appointment_reminder'`)).toBe(
      "pending",
    );
  });

  test("F. Care Circle typed help: the supporter sees the type, the note and the not-an-emergency line; the notice is routine", async ({ browser }) => {
    const patientContext = await browser.newContext({ extraHTTPHeaders: ownIp() });
    const patientPage = await patientContext.newPage();
    await login(patientPage, patient, /\/patient/);
    await gotoRoute(patientPage, "/patient/care-circle");
    await expect(patientPage.getByText(NOT_EMERGENCY)).toBeVisible({ timeout: 60_000 });
    await patientPage.getByRole("radio", { name: "Transport to get somewhere" }).check();
    await patientPage.getByLabel("A short note (optional)").fill(HELP_NOTE);
    await patientPage.getByRole("button", { name: "Ask my Care Circle for help" }).click();
    // Both supporters hold red_alerts, so the patient is told two people were reached.
    await expect(patientPage.getByText("Your Care Circle has been told. 2 people were reached.")).toBeVisible({ timeout: 30_000 });

    expect(
      sqlValue<string>(`select request_type || '|' || coalesce(request_note, '') from public.care_circle_help_alerts where patient_id = ${lit(patient.userId)} order by created_at desc limit 1`),
    ).toBe(`transport|${HELP_NOTE}`);
    // Founder as CMO (2026-11-07): a typed request reaches supporters as a routine notification, never critical.
    expect(
      sqlValue<string>(
        `select coalesce(string_agg(distinct priority::text, ','), 'none') from public.notifications
          where recipient_id in (${lit(supporter!.id)}, ${lit(supportOnly!.id)}) and template = 'circle_help_tap'`,
      ),
    ).toBe("routine");

    const supporterContext = await browser.newContext({ extraHTTPHeaders: ownIp() });
    const supporterPage = await supporterContext.newPage();
    await login(supporterPage, supporter!);
    await gotoRoute(supporterPage, `/patient/supporting/circle/${patient.userId}`);
    await expect(supporterPage.getByText("They asked for: Transport to get somewhere")).toBeVisible({ timeout: 60_000 });
    await expect(supporterPage.getByText(`Their note: ${HELP_NOTE}`)).toBeVisible();
    await expect(supporterPage.getByText(NOT_EMERGENCY).first()).toBeVisible();

    await supporterContext.close();
    await patientContext.close();
  });

  // Found while writing slice H: a support-only account (receives_care false, the account a relative makes only to support someone)
  // cannot open the person page at all. supporting/circle/[patientId]/page.tsx calls getPatientDashboardContext(), which sends every
  // support-only login to /patient/supporting, so the "Open" link on that very page leads straight back (the browser reported too many
  // redirects) and the help request is never shown to that supporter. Marked test.fail so the suite stays green while it is reported;
  // once fixed this flips and must become a test(). Runs after F, so the help request it looks for already exists.
  test("F. A support-only supporter can open the person page and see the help request (known bug, expected to fail)", async ({ browser }) => {
    test.fail(true, "Support-only supporters are redirected away from /patient/supporting/circle/[patientId]; reported in slice H, not fixed here.");
    const context = await browser.newContext({ extraHTTPHeaders: ownIp() });
    const page = await context.newPage();
    await login(page, supportOnly!);
    await gotoRoute(page, `/patient/supporting/circle/${patient.userId}`);
    await expect(page.getByText("They asked for: Transport to get somewhere")).toBeVisible({ timeout: 30_000 });
    await context.close();
  });

  for (const viewport of [
    { name: "390px", width: 390, height: 844 },
    { name: "1280px", width: 1280, height: 800 },
  ]) {
    test(`I. Crawl at ${viewport.name}: no horizontal scroll, no uncaught errors`, async ({ browser }) => {
      const context = await browser.newContext({ extraHTTPHeaders: ownIp(), viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      const uncaught: string[] = [];
      const consoleErrors: string[] = [];
      page.on("pageerror", (err) => uncaught.push(`${page.url()}: ${err.message}`));
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        // A failed network fetch logs "Failed to load resource"; that is the network, not an uncaught script error, and the page
        // itself must say "Couldn't load" (other journeys assert that). Everything else is counted.
        if (/Failed to load resource/i.test(text)) return;
        // `next dev` only: React's development build asks for eval(), which the app's CSP refuses. CI runs a production build, where
        // React never calls eval(), so this line never appears there.
        if (/React requires eval\(\) in development mode/.test(text)) return;
        consoleErrors.push(`${page.url()}: ${text}`);
      });

      await login(page, patient, /\/patient/);
      const pages = [
        "/patient",
        "/patient/vitals",
        "/patient/medications",
        "/patient/labs",
        "/patient/appointments",
        "/patient/notifications",
        "/patient/care",
        "/patient/profile",
      ];
      const overflowing: string[] = [];
      for (const path of pages) {
        await gotoRoute(page, path);
        await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
        await expect(page.getByText(/We couldn.t find that page/)).toHaveCount(0);
        const { extra, culprits } = await horizontalOverflow(page);
        if (extra <= 1) continue;
        // Tolerate only an overflow whose every culprit is a known, reported one (KNOWN_OVERFLOWS); anything else fails the crawl.
        const unknown = culprits.filter((c) => !isKnownOverflow(path, viewport.width, c));
        if (unknown.length > 0 || culprits.length === 0) {
          overflowing.push(`${path} is ${extra}px wider than the ${viewport.name} viewport: ${culprits.join("; ")}`);
        }
      }
      expect(overflowing, overflowing.join("\n")).toEqual([]);
      expect(uncaught, uncaught.join("\n")).toEqual([]);
      expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
      await context.close();
    });
  }

  // The known overflow above, as its own check: expected to fail until the button wraps on a phone, then it flips and must become a test().
  test("I. Profile at 390px has no horizontal scroll (known bug, expected to fail)", async ({ browser }) => {
    test.fail(true, "The identity change button on Profile is wider than a 390px phone; reported in slice H, not fixed here (tests only).");
    const context = await browser.newContext({ extraHTTPHeaders: ownIp(), viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, patient, /\/patient/);
    await gotoRoute(page, "/patient/profile");
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    const { extra } = await horizontalOverflow(page);
    expect(extra).toBeLessThanOrEqual(1);
    await context.close();
  });
});
