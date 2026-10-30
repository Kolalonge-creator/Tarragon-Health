import { expect, test } from "@playwright/test";
import { deleteTestPatient, seedActiveServicePurchase, type TestPatient } from "./helpers/supabase-admin";
import { createJourneyPatient } from "./journeys/journey-helpers";
import { deleteAccount, gotoRoute, login, makeDoctor, psql, type Account } from "./helpers/staff-session";
import { ownIp } from "./helpers/own-ip";

// Events harness E6 in a real browser (docs/design/DASHBOARD-PROGRAMME-CLINICIAN-FIRST.md section 4). One booking followed across the people
// who touch it: a doctor has a working day, the patient books a slot from the app, the patient is told once in the bell, the doctor sees
// the visit on their appointments screen, the patient cancels, the patient is told again, and the slot is bookable once more.
//
// The database side (overlap, holds, a second patient refused, the reminder sweep) is packages/db/tests/events_booking_round_trip.sql.
// This proves the screens agree with it. Local stack only (global-setup refuses anything else); every account and row is is_test and
// prefixed [e2e-test]. Test accounts are used because remote consultations are refused for real people while the clinical-operations
// guard is off.

// The suffix keeps this spec's accounts apart from the other events specs, which Playwright may start in the same millisecond.
// Digits only: the run id also feeds the test phone number, which must stay valid E.164.
const runId = `${Date.now()}6`;

test.describe("E6: a booking makes the round trip across patient and doctor screens", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);

  let patient: TestPatient;
  let doctor: Account & { staffId: string };

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    patient = await createJourneyPatient(runId);
    psql(`update public.profiles set full_name = '[e2e-test] Booking Patient' where id = '${patient.userId}'`);
    doctor = await makeDoctor("book-doctor", runId, patient.organisationId);
    // A video visit is a paid type; the patient holds a visit credit, seeded the way the payment trigger would leave it (no Paystack).
    await seedActiveServicePurchase(patient.userId, patient.organisationId, "video_visit_credit", runId);
    // The patient screen books a doctor visit from time the doctor declared and the rota confirmed (S21), so seed exactly that: six
    // hours of confirmed bookable time three days ahead, marked is_test like the patient (test and real time never mix).
    psql(`update public.clinical_staff set care_role = 'doctor' where id = '${doctor.staffId}'`);
    psql(`insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, state, is_test, confirmed_at)
      values ('${patient.organisationId}', '${doctor.userId}', date_trunc('day', now() + interval '3 days') + interval '8 hours',
        date_trunc('day', now() + interval '3 days') + interval '14 hours', 'bookable_consultations', 'confirmed', true, now())`);
  });

  test.afterAll(async () => {
    if (patient) await deleteTestPatient(patient);
    if (doctor) {
      try {
        psql(`delete from public.availability_blocks where clinician_id = '${doctor.userId}'`);
      } catch {
        // best effort: throwaway local database
      }
    }
    await deleteAccount(doctor?.userId);
  });

  test("patient books; both sides see it; patient cancels; the slot comes back", async ({ browser }) => {
    // 1. The patient books the first offered slot.
    const patientContext = await browser.newContext({ extraHTTPHeaders: ownIp() });
    const patientPage = await patientContext.newPage();
    await login(patientPage, patient, /\/patient/);
    await gotoRoute(patientPage, "/patient/appointments");
    await patientPage.getByLabel("Appointment type").selectOption("telemedicine");
    await expect(patientPage.getByRole("button", { name: "Book", exact: true }).first()).toBeVisible({ timeout: 60_000 });
    const offeredBefore = await patientPage.getByRole("button", { name: "Book", exact: true }).count();
    await patientPage.getByRole("button", { name: "Book", exact: true }).first().click();
    await expect(patientPage.getByText(/^Booked for /)).toBeVisible({ timeout: 60_000 });

    // The database agrees: one confirmed appointment with this doctor, and one in-app confirmation for the patient.
    const booked = psql(
      `select count(*) || ',' || coalesce(min(status::text), '') from public.appointments
        where patient_id = '${patient.userId}' and clinician_id = '${doctor.userId}'`,
    );
    expect(booked).toBe("1,confirmed");
    const confirmations = psql(
      `select count(*) from public.notifications where recipient_id = '${patient.userId}' and template = 'appointment_booking_confirmation' and status <> 'suppressed'`,
    );
    expect(confirmations).toBe("1");

    // 2. E7 for the booking: the patient's bell has one unread notice, in words, and it opens the appointments screen.
    await gotoRoute(patientPage, "/patient");
    // The bell also carries unrelated notices (a first sign-in raises a "new device" security notice), so assert on the booking notice itself.
    const bell = patientPage.getByRole("button", { name: /^Notifications, \d+ unread/ });
    await expect(bell).toBeVisible({ timeout: 60_000 });
    await bell.click();
    const booking = patientPage.getByText(/^Your appointment is booked for /);
    await expect(booking.first()).toBeVisible();
    expect(await booking.count()).toBe(1);

    // 3. The doctor sees the visit on their appointments screen.
    const doctorContext = await browser.newContext({ extraHTTPHeaders: ownIp() });
    const doctorPage = await doctorContext.newPage();
    await login(doctorPage, doctor);
    await gotoRoute(doctorPage, "/clinician/appointments");
    await expect(doctorPage.getByText("[e2e-test] Booking Patient").first()).toBeVisible({ timeout: 60_000 });

    // 4. The patient cancels from "Your upcoming appointments".
    await gotoRoute(patientPage, "/patient/appointments");
    await patientPage.getByRole("button", { name: "Cancel", exact: true }).first().click();
    await expect
      .poll(() => psql(`select status::text from public.appointments where patient_id = '${patient.userId}'`), { timeout: 30_000 })
      .toMatch(/cancelled/);

    // The patient is told, in words, once.
    await gotoRoute(patientPage, "/patient");
    await patientPage.getByRole("button", { name: /^Notifications/ }).click();
    const cancelled = patientPage.getByText(/^Your appointment on .* was cancelled$/);
    await expect(cancelled.first()).toBeVisible({ timeout: 60_000 });
    expect(await cancelled.count()).toBe(1);

    // 5. The slot is offered again: the same number of Book buttons as before the booking.
    await gotoRoute(patientPage, "/patient/appointments");
    await patientPage.getByLabel("Appointment type").selectOption("telemedicine");
    await expect(patientPage.getByRole("button", { name: "Book", exact: true })).toHaveCount(offeredBefore, { timeout: 60_000 });

    await doctorContext.close();
    await patientContext.close();
  });
});
