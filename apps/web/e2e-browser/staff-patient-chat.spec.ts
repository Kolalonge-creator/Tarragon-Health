import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, deleteTestPatient, pollUntil, type TestPatient } from "./helpers/supabase-admin";
import { createJourneyPatient } from "./journeys/journey-helpers";
import { ownIp } from "./helpers/own-ip";

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
    const staffContext = await browser.newContext({ extraHTTPHeaders: ownIp() });
    const staffPage = await staffContext.newPage();
    await login(staffPage, coordinator, /\/(dashboard|clinician)/);

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
    const patientContext = await browser.newContext({ extraHTTPHeaders: ownIp() });
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
});
