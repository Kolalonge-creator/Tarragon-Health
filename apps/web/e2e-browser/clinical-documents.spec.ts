import { expect, test, type Page } from "@playwright/test";
import { adminClient, createTestPatient, deleteTestPatient, pollUntil, type TestPatient } from "./helpers/supabase-admin";
import { deleteAccount, gotoRoute, login, makeDoctor, psql, type Account } from "./helpers/staff-session";
import { ownIp } from "./helpers/own-ip";
import { completeOnboardingFixture } from "./journeys/harness/sessions";

// Clinical document engine, step 7: the acceptance journeys in a real browser (docs/plans/clinical-document-engine-2026-11-04.md §20).
//   1. A patient uploads a document without knowing what it is, is asked (AI-024 is off), answers, and finds it in My Health Records.
//      The same file again is refused as a duplicate.
//   2. A Care Coordinator finds the patient (never by name alone), uploads a laboratory report with the identity on the report checked;
//      a date of birth that does not match is refused. The patient gets the values-free notice and cannot see the held report.
//   3. A doctor finds the letter in Records & investigations, opens the side-by-side viewer, records a review; the patient then sees
//      "Reviewed by a doctor".
// Local stack only (global-setup refuses anything else). Every account and row is is_test and prefixed [e2e-test]. Files are synthetic
// one-page PDFs made here, unique per run so fingerprints never collide. Automatic reading is not exercised: run with
// ANTHROPIC_API_KEY unset so no model is called (AI-024 is registered off in any case).

const runId = Date.now().toString();

test.use({ extraHTTPHeaders: ownIp() });

/** A minimal, valid one-page PDF whose text carries the run id (so each run's fingerprint is new). */
function syntheticPdf(title: string): Buffer {
  const text = `SYNTHETIC TEST DOCUMENT - NOT A REAL PATIENT. ${title} ${runId}`;
  const stream = `BT /F1 12 Tf 40 760 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

async function chooseFile(page: Page, scope: string, name: string, buffer: Buffer): Promise<void> {
  await page.locator(`${scope} input[type=file][name=file]`).setInputFiles({ name, mimeType: "application/pdf", buffer });
}

test.describe("clinical document engine journeys", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);

  let patient: TestPatient;
  let coordinator: Account;
  let doctor: Account & { staffId: string };
  const letter = syntheticPdf("DISCHARGE SUMMARY");

  test.beforeAll(async () => {
    // Three accounts, onboarding and consents: more than the default 30 s hook limit on a busy machine.
    test.setTimeout(120_000);
    patient = await createTestPatient(runId);
    psql(`update public.profiles set full_name = 'Ngozi Adaeze Okafor', date_of_birth = '1980-01-15', sex = 'female', is_test = true
          where id = '${patient.userId}'`);
    // Onboarding needs date of birth, sex and every current required consent; the shared fixture records them properly.
    completeOnboardingFixture(patient.userId, patient.organisationId, { receivesCare: true });

    const coordEmail = `e2e-test-coordinator-${runId}@example.com`;
    const coordPassword = `E2e-test-pw-${runId}-!Aa1`;
    const { data: user, error } = await adminClient.auth.admin.createUser({
      email: coordEmail,
      password: coordPassword,
      email_confirm: true,
      user_metadata: { full_name: "[e2e-test] Coordinator" },
      app_metadata: { signup_exempt: "true" },
    });
    if (error || !user.user) throw error ?? new Error("coordinator create failed");
    await pollUntil(async () => (await adminClient.from("profiles").select("id").eq("id", user.user.id).maybeSingle()).data);
    psql(`update public.profiles set role = 'care_coordinator', organisation_id = '${patient.organisationId}', is_active = true, is_test = true,
            onboarding_completed_at = now() where id = '${user.user.id}'`);
    // A coordinator's worklists and screens read their active clinical staff record (doctor_tier care_coordinator).
    psql(`insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
            license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
          values ('${patient.organisationId}', '${user.user.id}', '[e2e-test] Coordinator', 'other', 'E2E-COORD-${runId}', true, 'active', now(),
            (select id from public.profiles order by created_at limit 1), 'care_coordinator', 'employed', 1, true)`);
    coordinator = { userId: user.user.id, email: coordEmail, password: coordPassword };

    doctor = await makeDoctor("cde-doctor", runId, patient.organisationId);
    psql(`insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
            values ('${patient.organisationId}', '${patient.userId}', '${doctor.userId}', now())
          on conflict (patient_id) do update set clinician_id = excluded.clinician_id`);
  });

  test.afterAll(async () => {
    await deleteAccount(coordinator?.userId);
    await deleteAccount(doctor?.userId);
    if (patient) await deleteTestPatient(patient);
  });

  test("1. a patient uploads a document they are not sure about, answers one question, and finds it", async ({ page }) => {
    await login(page, patient);
    await gotoRoute(page, "/patient/health-records");
    await expect(page.getByRole("heading", { name: "My Health Records" })).toBeVisible();

    const card = "section:has(h3:text('Not sure what a document is?'))";
    await chooseFile(page, card, "letter.pdf", letter);
    await page.locator(card).getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByText("One quick question below")).toBeVisible({ timeout: 60_000 });

    await page.getByLabel("What kind of document is this?").selectOption("reports.discharge");
    await page.locator(card).getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: "Letters and reports" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Discharge summary").first()).toBeVisible();

    // The same file again is refused, in words.
    await chooseFile(page, card, "letter-again.pdf", letter);
    await page.locator(card).getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByText(/already in this record/)).toBeVisible({ timeout: 30_000 });

    const kinds = psql(`select string_agg(coalesce(kind_code, '-') || ':' || kind_source, ',') from public.clinical_documents where patient_id = '${patient.userId}'`);
    expect(kinds).toBe("reports.discharge:confirmed");
  });

  test("2. a Care Coordinator uploads a laboratory report with the identity on it checked", async ({ page }) => {
    await login(page, coordinator);
    await gotoRoute(page, "/dashboard/care-coordinator/lab-reports");

    // A name alone never finds anyone; the email does.
    await page.locator("#upload-search").fill("Ngozi Okafor");
    await page.getByRole("button", { name: "Find patient" }).click();
    await expect(page.getByText(/add the date of birth/i)).toBeVisible();
    await page.locator("#upload-search").fill(patient.email);
    await page.getByRole("button", { name: "Find patient" }).click();
    await page.getByRole("button", { name: "Choose" }).click();
    await expect(page.getByText("Results for Ngozi Adaeze Okafor")).toBeVisible();

    const fill = async (dob: string) => {
      await page.locator("#nameOnReport").fill("Ngozi Okafor");
      await page.locator("#dateOfBirthOnReport").fill(dob);
      await page.locator("#labProviderId").selectOption("__other__");
      await page.locator("#labName").fill("[e2e-test] Synthetic Laboratory");
      await chooseFile(page, "form:has(#nameOnReport)", "fbc.pdf", syntheticPdf("FULL BLOOD COUNT"));
      await page.getByRole("button", { name: "Upload report" }).click();
    };
    await fill("1981-01-15");
    await expect(page.getByText("The date of birth on the report does not match this patient")).toBeVisible({ timeout: 30_000 });
    await fill("1980-01-15");
    await expect(page.getByText(/Uploaded\. A doctor will review it/)).toBeVisible({ timeout: 30_000 });

    // The patient is told a report was added, with nothing from it in the notice; the report itself stays held.
    const notices = psql(`select count(*) from public.notifications where recipient_id = '${patient.userId}' and template = 'lab_report_received'`);
    expect(Number(notices)).toBeGreaterThanOrEqual(1);
    expect(psql(`select count(*) from public.clinical_documents where patient_id = '${patient.userId}' and upload_channel = 'care_coordinator' and not visible_to_patient`)).toBe("1");
  });

  test("3. a doctor opens it side by side, records a review, and the patient sees that", async ({ page, browser }) => {
    await login(page, doctor);
    await gotoRoute(page, `/clinician/patients/${patient.userId}?tab=records`);
    await expect(page.getByText("Records and investigations")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("link", { name: "Discharge summary" }).click();
    await expect(page.getByRole("heading", { name: "Discharge summary" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Earlier of the same kind")).toBeVisible();
    await expect(page.locator("iframe[title^='Original']")).toBeVisible();

    await gotoRoute(page, `/clinician/patients/${patient.userId}?tab=screening-prevention`);
    await expect(page.getByText("Uploaded documents not yet read automatically")).toBeVisible({ timeout: 60_000 });
    await page.getByLabel("Your review").first().fill("[e2e-test] Read. Nothing urgent; discussed at the next visit.");
    await page.getByRole("button", { name: "Mark as reviewed" }).first().click();
    await expect(page.getByText("Review: [e2e-test] Read.")).toBeVisible({ timeout: 30_000 });

    const patientPage = await (await browser.newContext({ extraHTTPHeaders: ownIp() })).newPage();
    await login(patientPage, patient);
    await gotoRoute(patientPage, "/patient/health-records");
    await expect(patientPage.getByText(/Reviewed by a doctor/).first()).toBeVisible({ timeout: 30_000 });
    // The doctor's note is staff-only.
    await expect(patientPage.getByText("Nothing urgent; discussed at the next visit")).toHaveCount(0);
  });
});
