import { expect, test } from "@playwright/test";
import { deleteTestPatient, type TestPatient } from "./helpers/supabase-admin";
import { createJourneyPatient } from "./journeys/journey-helpers";
import { lit, sql, sqlValue } from "./journeys/harness/sql";
import { deleteAccount, gotoRoute, login, makeDoctor, type Account } from "./helpers/staff-session";
import { ownIp } from "./helpers/own-ip";

// Patient dashboard 2.0, slice H, the journeys for the two slices that were still open PRs when this was written:
//   E. Care plan "what changed" (PD-06, PR #1806): a doctor saves a change with "Patient must acknowledge"; the patient sees
//      "Your care plan has changed", taps Got it, the box goes away, and the acknowledgement is on the row.
//   G. Medicines "Not sure" (P16, PR #1807): "I'm not sure" on the medicine-list confirmation raises exactly one routine
//      medication_dispense_flags patient_query row; a second tap the same day adds none.
//   H. Record search (P23, PR #1807): Ctrl-K, a seeded medicine name, found under Medicines.
// Each journey checks that its feature is present (its table, index or route) and skips with that reason when it is not, so this file
// is green on a main-dev without those PRs and becomes a real check the moment they merge. Shipped journeys: patient-dashboard-2.spec.ts.
// Local stack only (global-setup refuses anything else); every account and row is is_test and prefixed.

const runId = `${Date.now()}9`;
const MEDICINE = "Amlodipine";
const CHANGE_NOTE = "We added a morning blood pressure check before breakfast.";

test.describe("Patient dashboard 2.0: care plan changes, Not sure, record search", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);
  test.use({ extraHTTPHeaders: ownIp() });

  let patient: TestPatient;
  let doctor: (Account & { staffId: string }) | undefined;
  let carePlanId = "";

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    patient = await createJourneyPatient(runId);
    sql(`update public.profiles set full_name = '[e2e-test] Care Plan Patient' where id = ${lit(patient.userId)};`);
    sql(`insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active)
         values (${lit(patient.organisationId)}, ${lit(patient.userId)}, ${lit(MEDICINE)}, '5 mg', 'once daily', 'patient', true);`);
  });

  test.afterAll(async () => {
    // The patient first: care_team_assignment restricts deleting the doctor while it still points at them.
    if (patient) await deleteTestPatient(patient);
    await deleteAccount(doctor?.userId);
  });

  test("E. A doctor publishes a change the patient must acknowledge; Got it records it", async ({ browser }) => {
    test.skip(sqlValue<string>(`select to_regclass('public.care_plan_revisions')::text`) === null, "care_plan_revisions is not in this database yet (PR #1806)");

    doctor = await makeDoctor("pd2-cp-doctor", runId, patient.organisationId);
    sql(`insert into public.care_team_assignment (organisation_id, patient_id, clinician_id)
         values (${lit(patient.organisationId)}, ${lit(patient.userId)}, ${lit(doctor.userId)});`);
    carePlanId = sql(`insert into public.care_plans (organisation_id, patient_id, condition, status, assigned_clinician_id)
         values (${lit(patient.organisationId)}, ${lit(patient.userId)}, 'hypertension', 'active', ${lit(doctor.userId)}) returning id;`).split("\n")[0]!.trim();

    // The doctor saves a plain-words change and ticks "Patient must acknowledge this change".
    const doctorContext = await browser.newContext({ extraHTTPHeaders: ownIp() });
    const doctorPage = await doctorContext.newPage();
    await login(doctorPage, doctor);
    await gotoRoute(doctorPage, `/clinician/patients/${patient.userId}`);
    await doctorPage.getByRole("tab", { name: "Care plan" }).click();
    await doctorPage.getByPlaceholder(/What changed, in plain words/).fill(CHANGE_NOTE);
    await doctorPage.getByLabel("Patient must acknowledge this change").check();
    await doctorPage.getByRole("button", { name: "Save plan change" }).click();
    await expect(doctorPage.getByText("Plan change saved. The patient will see it on their care plan.")).toBeVisible({ timeout: 30_000 });
    expect(
      sqlValue<string>(`select count(*)::text || '|' || bool_and(needs_acknowledgement)::text || '|' || bool_and(acknowledged_at is null)::text
                          from public.care_plan_revisions where care_plan_id = ${lit(carePlanId)}`),
    ).toBe("1|true|true");
    await doctorContext.close();

    // The patient sees the box, taps Got it, and it goes away (and stays away after a reload).
    const patientContext = await browser.newContext({ extraHTTPHeaders: ownIp() });
    const patientPage = await patientContext.newPage();
    await login(patientPage, patient, /\/patient/);
    await gotoRoute(patientPage, "/patient/care");
    const notice = patientPage.getByRole("region", { name: "Your care plan has changed" });
    await expect(notice).toBeVisible({ timeout: 60_000 });
    await expect(notice).toContainText(CHANGE_NOTE);
    await notice.getByRole("button", { name: "Got it" }).click();
    await expect(notice).toBeHidden({ timeout: 30_000 });

    await expect
      .poll(
        () =>
          sqlValue<string>(`select (acknowledged_at is not null)::text || '|' || (acknowledged_by = patient_id)::text
                              from public.care_plan_revisions where care_plan_id = ${lit(carePlanId)}`),
        { timeout: 30_000 },
      )
      .toBe("true|true");
    await patientPage.reload();
    await expect(patientPage.getByRole("region", { name: "Your care plan has changed" })).toHaveCount(0);
    await patientContext.close();
  });

  test("G. I'm not sure raises exactly one routine task, and a second tap the same day adds none", async ({ page }) => {
    test.skip(
      sqlValue<string>(`select indexname from pg_indexes where schemaname = 'public' and indexname = 'medication_dispense_flags_not_sure_one_per_day'`) === null,
      "the one-per-day Not sure index is not in this database yet (PR #1807)",
    );
    const notSureRows = () =>
      sqlValue<string>(
        `select count(*)::text from public.medication_dispense_flags
          where patient_id = ${lit(patient.userId)} and flag_type = 'patient_query' and note like 'Patient answered "Not sure"%'`,
      );
    expect(notSureRows()).toBe("0");

    await login(page, patient, /\/patient/);
    await gotoRoute(page, "/patient/medications");
    const notSure = page.getByRole("button", { name: "I'm not sure", exact: true });
    await expect(notSure).toBeVisible({ timeout: 60_000 });
    await notSure.click();
    await expect(page.getByText(/That's fine\. Your list stays unconfirmed for now\./)).toBeVisible({ timeout: 30_000 });
    await expect.poll(notSureRows, { timeout: 30_000 }).toBe("1");
    // Routine: the note says so, it is open, and it stays on the existing medicine-issue worklist (no new urgency or page).
    expect(
      sqlValue<string>(
        `select status::text || '|' || (note like '%Routine:%')::text from public.medication_dispense_flags
          where patient_id = ${lit(patient.userId)} and flag_type = 'patient_query' and note like 'Patient answered "Not sure"%'`,
      ),
    ).toBe("open|true");

    // A second tap the same day: the database refuses the duplicate and the app reports it as already done, never as an error.
    await expect(notSure).toBeEnabled({ timeout: 30_000 });
    await notSure.click();
    await expect(notSure).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByText("We couldn't let your care team know just now. Please try again.")).toHaveCount(0);
    expect(notSureRows()).toBe("1");
  });

  test("H. Ctrl-K finds a medicine on the record under Medicines", async ({ page }) => {
    await login(page, patient, /\/patient/);
    const probe = await page.request.get("/api/patient/search?q=xx");
    test.skip(probe.status() === 404, "the patient record search route is not on this build yet (PR #1807)");

    await gotoRoute(page, "/patient");
    await expect(page.getByRole("button", { name: "Search Tarragon" }).first()).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search Tarragon" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox").or(dialog.locator("input")).first().fill("amlodip");
    const results = dialog.getByRole("listbox");
    await expect(results.locator('li[role="presentation"]').filter({ hasText: /^Medicines$/ })).toBeVisible({ timeout: 30_000 });
    const hit = results.getByRole("option").filter({ hasText: MEDICINE });
    await expect(hit).toBeVisible();
    await expect(hit).toContainText("5 mg");
  });
});
