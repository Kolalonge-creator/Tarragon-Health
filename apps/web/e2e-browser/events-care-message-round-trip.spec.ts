import { expect, test } from "@playwright/test";
import { deleteTestPatient, type TestPatient } from "./helpers/supabase-admin";
import { createJourneyPatient } from "./journeys/journey-helpers";
import { deleteAccount, gotoRoute, login, makeDoctor, psql, type Account } from "./helpers/staff-session";
import { ownIp } from "./helpers/own-ip";

// Events harness E5 and E7, in a real browser (docs/design/DASHBOARD-PROGRAMME-CLINICIAN-FIRST.md section 4).
//
// E5: a patient writes to the care team from the app, the assigned doctor sees it in the inbox and answers, the patient sees the answer.
// E7: each person is told once, in the app. The bell on each side shows exactly one unread notice for the message, with the wording a
// person reads, and following it lands on the right screen. "Once" matters: before the table guard in 20261030122555 a message could
// raise the same bell notice twice.
//
// What this does not prove: email and push delivery (the sender is an Edge Function; send-pending-notifications is covered by its own
// Deno tests and the events_notification_delivery_renderable DB proof). Local stack only (global-setup refuses anything else); every
// account and row is is_test and prefixed [e2e-test].

// The suffix keeps this spec's accounts apart from the other events specs, which Playwright may start in the same millisecond.
// Digits only: the run id also feeds the test phone number, which must stay valid E.164.
const runId = `${Date.now()}5`;
const SUBJECT = `[e2e-test] Question about my results ${runId}`;
const QUESTION = "Could you tell me what my last results mean?";
const ANSWER = "Your results are fine. Keep taking your readings and message me if anything changes.";

test.describe("E5 and E7: a care message makes the round trip and each person is told once", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);

  let patient: TestPatient;
  let doctor: Account;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    patient = await createJourneyPatient(runId);
    psql(`update public.profiles set full_name = '[e2e-test] Message Patient' where id = '${patient.userId}'`);
    doctor = await makeDoctor("msg-doctor", runId, patient.organisationId);
    // The doctor's "new message" notice goes to the doctor assigned to the patient.
    psql(`insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values ('${patient.organisationId}', '${patient.userId}', '${doctor.userId}')`);
  });

  test.afterAll(async () => {
    // The patient first: care_team_assignment restricts deleting the doctor while it still points at them.
    if (patient) await deleteTestPatient(patient);
    await deleteAccount(doctor?.userId);
  });

  test("patient writes; the doctor is told once and sees it; the doctor answers; the patient is told once and sees the answer", async ({ browser }) => {
    // 1. The patient writes to the care team from the app.
    const patientContext = await browser.newContext({ extraHTTPHeaders: ownIp() });
    const patientPage = await patientContext.newPage();
    await login(patientPage, patient, /\/patient/);
    await gotoRoute(patientPage, "/patient/messages");
    await patientPage.getByRole("button", { name: /Message your care team|^New$/ }).first().click();
    await patientPage.getByLabel("Subject").fill(SUBJECT);
    await patientPage.getByLabel("Message", { exact: true }).fill(QUESTION);
    await patientPage.getByRole("button", { name: "Send", exact: true }).click();
    await expect(patientPage.getByText(SUBJECT).first()).toBeVisible({ timeout: 30_000 });

    // The database agrees: one thread, one patient message, open and waiting for the care team.
    const stored = psql(
      `select (select count(*) from public.care_message_threads where patient_id = '${patient.userId}' and subject = '${SUBJECT}')
          || ',' || (select count(*) from public.care_messages where patient_id = '${patient.userId}' and author_role <> 'care_team')`,
    );
    expect(stored).toBe("1,1");

    // 2. E7, doctor side: the assigned doctor has exactly one unread notice for it, worded for a person, and it points at the patient.
    const doctorContext = await browser.newContext({ extraHTTPHeaders: ownIp() });
    const doctorPage = await doctorContext.newPage();
    await login(doctorPage, doctor);
    await gotoRoute(doctorPage, "/clinician");
    // The bell also carries unrelated notices (a first sign-in raises a "new device" security notice), so assert on the message notice itself.
    const doctorBell = doctorPage.getByRole("button", { name: /^Notifications, \d+ unread/ });
    await expect(doctorBell).toBeVisible({ timeout: 60_000 });
    await doctorBell.click();
    await expect(doctorPage.getByText(/New message from .*Message Patient/).first()).toBeVisible();
    expect(await doctorPage.getByText(/New message from .*Message Patient/).count()).toBe(1);

    // 3. E5, doctor side: the inbox lists the thread as unread and the doctor answers inside it.
    await gotoRoute(doctorPage, "/clinician/messages");
    await doctorPage.getByRole("button", { name: SUBJECT }).click();
    await expect(doctorPage.getByText(QUESTION)).toBeVisible({ timeout: 30_000 });
    await doctorPage.getByLabel("Your reply").fill(ANSWER);
    await doctorPage.getByRole("button", { name: "Send", exact: true }).last().click();
    await expect(doctorPage.getByText(ANSWER)).toBeVisible({ timeout: 30_000 });

    // 4. E7, patient side: exactly one unread notice, worded as from the care team, and it opens the messages screen with the answer in it.
    await gotoRoute(patientPage, "/patient");
    const patientBell = patientPage.getByRole("button", { name: /^Notifications, \d+ unread/ });
    await expect(patientBell).toBeVisible({ timeout: 60_000 });
    await patientBell.click();
    const notice = patientPage.getByText("New message from the care team");
    await expect(notice.first()).toBeVisible();
    expect(await notice.count()).toBe(1);
    await notice.first().click();
    await patientPage.waitForURL(/\/patient\/messages/, { timeout: 60_000 });
    await patientPage.getByText(SUBJECT).first().click();
    await expect(patientPage.getByText(ANSWER)).toBeVisible({ timeout: 30_000 });

    // The database holds exactly one in-app notice per recipient for these two messages (none suppressed away, none doubled).
    const counts = psql(
      `select count(*) filter (where recipient_id = '${patient.userId}' and status <> 'suppressed')
          || ',' || count(*) filter (where recipient_id = '${doctor.userId}' and status <> 'suppressed')
         from public.notifications where channel = 'in_app' and template in ('new_care_message', 'clinician_new_care_message')
           and (recipient_id in ('${patient.userId}', '${doctor.userId}'))`,
    );
    expect(counts).toBe("1,1");

    await doctorContext.close();
    await patientContext.close();
  });
});
