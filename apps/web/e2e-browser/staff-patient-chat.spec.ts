import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, deleteTestPatient, pollUntil, type TestPatient } from "./helpers/supabase-admin";
import { createJourneyPatient } from "./journeys/journey-helpers";

// Staff to patient chat, click-through: a care coordinator opens the chat from a patient's page, starts a conversation, replies with an
// action button, the patient sees the message and the button (and the button opens the right screen), and the coordinator's thread
// changes from "Sent, not seen yet" to "Seen by the patient". Local stack only (global-setup refuses anything else); every account and
// row is is_test and prefixed [e2e-test].

const runId = Date.now().toString();
const DB_URL = process.env.E2E_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function psql(sql: string): string {
  return execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-Atq", "-c", sql], { encoding: "utf8" }).trim();
}

async function login(page: Page, who: { email: string; password: string }, landing: RegExp): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(who.email);
  await page.locator("#password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(landing, { timeout: 60_000 });
}

// The dev server compiles a route on its first request and can answer it with the 404 page; reload before treating that as real.
async function gotoRoute(page: Page, path: string): Promise<void> {
  await page.goto(path);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if ((await page.getByText(/We couldn.t find that page/).count()) === 0) return;
    await page.waitForTimeout(3_000);
    await page.reload();
  }
}

test.describe("staff to patient chat", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);

  let patient: TestPatient;
  let coordinator: { userId: string; email: string; password: string };
  // The coordinator's signed-in browser state, saved by the first test so the later tests do not sign in again (repeated sign-ins of one
  // account on the dev server have timed out in CI).
  let staffState: Awaited<ReturnType<import("@playwright/test").BrowserContext["storageState"]>> | undefined;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    patient = await createJourneyPatient(runId);
    psql(`update public.profiles set full_name = '[e2e-test] Chat Patient' where id = '${patient.userId}'`);

    const email = `e2e-test-coordinator-${runId}@example.com`;
    const password = `E2e-test-pw-${runId}-!Aa1`;
    const { data: user, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "[e2e-test] Coordinator" },
      app_metadata: { signup_exempt: "true" },
    });
    if (error || !user.user) throw error ?? new Error("coordinator create failed");
    await pollUntil(async () => {
      const { data } = await adminClient.from("profiles").select("id").eq("id", user.user.id).maybeSingle();
      return data;
    });
    const { error: updateError } = await adminClient
      .from("profiles")
      .update({ role: "care_coordinator", organisation_id: patient.organisationId, is_active: true, onboarding_completed_at: new Date().toISOString() })
      .eq("id", user.user.id);
    if (updateError) throw updateError;
    psql(`update public.profiles set is_test = true where id = '${user.user.id}'`);
    // A coordinator is a clinical_staff row at the care_coordinator tier; the coordinator dashboard and patient directory need one.
    psql(`insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at,
        verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
      values ('${patient.organisationId}', '${user.user.id}', '[e2e-test] Coordinator', 'MDCN', 'E2E-coord-${runId}', true, 'active', now(),
        (select id from public.profiles order by created_at limit 1), 'care_coordinator', 'employed', 1, true, (select id from public.profiles order by created_at limit 1), true)`);
    coordinator = { userId: user.user.id, email, password };
  });

  test.afterAll(async () => {
    try {
      if (coordinator) await adminClient.auth.admin.deleteUser(coordinator.userId);
    } catch {
      // best effort: every row here is is_test and lives in a throwaway local database
    }
    if (patient) await deleteTestPatient(patient);
  });

  test("coordinator messages the patient; the patient sees it and its button; the coordinator sees it was seen", async ({ browser }) => {
    const staffContext = await browser.newContext();
    const staffPage = await staffContext.newPage();
    await login(staffPage, coordinator, /\/(dashboard|clinician)/);
    staffState = await staffContext.storageState();

    // 1. The chat is closed until asked for, then offers a form because there is no conversation yet.
    await gotoRoute(staffPage, `/clinician/patients/${patient.userId}`);
    await staffPage.getByRole("button", { name: /Open chat with/ }).click();
    await staffPage.getByLabel("Message", { exact: true }).fill("Please confirm your review date.");
    await staffPage.getByRole("button", { name: "Send" }).click();

    // 2. The conversation appears; reply with an action button attached.
    await expect(staffPage.getByText("Please confirm your review date.")).toBeVisible({ timeout: 30_000 });
    await staffPage.getByLabel("Book an appointment").check();
    await staffPage.getByLabel("Your reply").fill("You can pick a time here.");
    await staffPage.getByRole("button", { name: "Send", exact: true }).last().click();
    await expect(staffPage.getByText("Button: Book an appointment")).toBeVisible({ timeout: 30_000 });
    await expect(staffPage.getByText("Sent, not seen yet").first()).toBeVisible({ timeout: 30_000 });

    // The database agrees on who wrote it and what is attached.
    const row = psql(
      `select count(*) filter (where author_role = 'care_team') || ',' || (select count(*) from public.care_message_actions where patient_id = '${patient.userId}' and kind = 'book_appointment')
         from public.care_messages where patient_id = '${patient.userId}'`,
    );
    expect(row).toBe("2,1");

    // 3. The patient sees both messages and the button, and the button opens the appointments screen.
    const patientContext = await browser.newContext();
    const patientPage = await patientContext.newPage();
    await login(patientPage, patient, /\/patient/);
    await gotoRoute(patientPage, "/patient/messages");
    await patientPage.getByText(/A message from your care team/).first().click();
    await expect(patientPage.getByText("You can pick a time here.")).toBeVisible({ timeout: 30_000 });
    const button = patientPage.getByRole("link", { name: "Book an appointment" });
    await expect(button).toBeVisible();
    await button.click();
    await patientPage.waitForURL(/\/patient\/appointments/, { timeout: 60_000 });

    // 4. The coordinator's open thread notices the patient has read it (the thread polls every 15 seconds).
    await expect(staffPage.getByText(/Seen by the patient/).first()).toBeVisible({ timeout: 60_000 });

    await patientContext.close();
    await staffContext.close();
  });

  // A staff member starts a conversation with a file and a button on the very first message. The thread is created first, then the
  // first message's id is looked up (first_care_message_id, no second thread read), then the button and the file are attached.
  // (Journey patients each live in their own organisation, so this uses the same patient as the test above, via "Start a new conversation".)
  test("a new conversation can carry a file and a button on its first message", async ({ browser }) => {
    const staffContext = await browser.newContext({ storageState: staffState });
    const staffPage = await staffContext.newPage();
    if (!staffState) await login(staffPage, coordinator, /\/(dashboard|clinician)/);
    await gotoRoute(staffPage, `/clinician/patients/${patient.userId}`);
    await staffPage.getByRole("button", { name: /Open chat with/ }).click();
    await staffPage.getByRole("button", { name: "Start a new conversation" }).click();
    await staffPage.getByLabel("Subject").fill("[e2e-test] Your referral letter");
    await staffPage.getByLabel("Message", { exact: true }).fill("The letter is attached.");
    // The open thread above also offers this button on its reply box; the new-conversation form is the last one on the page.
    await staffPage.getByLabel("Book an appointment").last().check();
    await staffPage.locator('input[type="file"]').last().setInputFiles({
      name: "letter.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"),
    });
    await staffPage.getByRole("button", { name: "Send", exact: true }).last().click();
    await expect(staffPage.getByText("The letter is attached.")).toBeVisible({ timeout: 30_000 });

    // Both extras landed on the first message of the new thread, and the staff page shows no "could not be added" notice.
    await expect
      .poll(
        () =>
          psql(
            `select (select count(*) from public.care_message_attachments a join public.care_message_threads t on t.id = a.thread_id
                      where t.patient_id = '${patient.userId}' and t.subject = '[e2e-test] Your referral letter') || ',' ||
                    (select count(*) from public.care_message_actions x join public.care_messages m on m.id = x.message_id
                      join public.care_message_threads t on t.id = m.thread_id
                      where t.patient_id = '${patient.userId}' and t.subject = '[e2e-test] Your referral letter')`,
          ),
        { timeout: 30_000 },
      )
      .toBe("1,1");
    await expect(staffPage.getByText(/could not be added/)).toHaveCount(0);
    await staffContext.close();
  });

  // The 24 hour reply target shows as a red badge inside the 14 day lookback. Older than that it is not badged; it is counted in a quiet sentence.
  test("the reply-target badge shows inside 14 days and not beyond it", async ({ browser }) => {
    const asPatient = (subject: string, hoursAgo: number) => {
      psql(`begin;
        select set_config('request.jwt.claims', json_build_object('sub', '${patient.userId}', 'role', 'authenticated')::text, true);
        set local role authenticated;
        select public.start_care_thread('${subject}', 'A question from the patient');
        commit;`);
      psql(`update public.care_message_threads set last_message_at = now() - interval '${hoursAgo} hours', care_team_last_read_at = null
             where patient_id = '${patient.userId}' and subject = '${subject}'`);
    };
    asPatient("[e2e-test] Badge recent", 25);
    asPatient("[e2e-test] Badge old", 24 * 20);

    const staffContext = await browser.newContext({ storageState: staffState });
    const staffPage = await staffContext.newPage();
    if (!staffState) await login(staffPage, coordinator, /\/(dashboard|clinician)/);
    await gotoRoute(staffPage, "/clinician/messages");

    const recent = staffPage.locator("li", { hasText: "[e2e-test] Badge recent" });
    const old = staffPage.locator("li", { hasText: "[e2e-test] Badge old" });
    await expect(recent).toBeVisible({ timeout: 60_000 });
    await expect(recent.getByText("Past 24h reply target")).toBeVisible();
    await expect(old).toBeVisible();
    await expect(old.getByText("Past 24h reply target")).toHaveCount(0);
    await expect(staffPage.getByText(/older conversation.*no badge/)).toBeVisible();
    await staffContext.close();
  });
});
