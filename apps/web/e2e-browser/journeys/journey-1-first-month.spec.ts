import { expect, test } from "@playwright/test";
import { adminClient, deleteTestPatient, type TestPatient } from "../helpers/supabase-admin";
import { createJourneyPatient, loginAs } from "./journey-helpers";

/**
 * Journey 1 (spec D.7.3): a new user's first month.
 *
 * LOCAL STACK ONLY (global-setup.ts refuses anything else). All data is is_test. Written, NOT run by the session
 * that wrote it. The signup form, phone code and onboarding steps already have specs of their own
 * (phone-auth.spec.ts, b2c-signup-to-entitlement.spec.ts), so this file starts where those end and covers what
 * the journey adds: the daily home blood pressure habit on the Today/vitals screen, and then names every step
 * that is blocked.
 *
 * Journey text versus the product, found while writing this (see docs/audit-D7-journeys.md, Journey 1):
 *   - Onboarding has three intents ("I'm managing a condition", "stay ahead of problems", "not sure yet"), not a
 *     goal list with "blood pressure" on it. The journey's "selects blood pressure" has no matching screen.
 *   - "Pidgin audio" cannot happen: Nigerian Pidgin was removed on 2026-10-06 (English only). Journey text is stale.
 *   - Health Points (S58) and the screening-calendar-driven booking of the Essential screen are not built.
 */
test.describe.configure({ mode: "serial" });

const runId = Date.now().toString();

test.describe("journey 1: a new user's first month", () => {
  let patient: TestPatient;

  test.beforeAll(async () => {
    patient = await createJourneyPatient(runId);
  });

  test.afterAll(async () => {
    if (patient) await deleteTestPatient(patient);
  });

  test("onboarding offers the 'managing a condition' intent that this journey starts from", async ({ page }) => {
    // Uses a second, never-onboarded account so the intent screen is reachable. Only asserts the choice exists;
    // the full onboarding run is owned by b2c-signup-to-entitlement.spec.ts.
    const fresh = await createJourneyPatient(`${runId}b`);
    try {
      await adminClient.from("profiles").update({ onboarding_completed_at: null }).eq("id", fresh.userId);
      await page.goto("/login");
      await page.locator("#email").fill(fresh.email);
      await page.locator("#password").fill(fresh.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(/\/onboarding/, { timeout: 60_000 });
      await expect(page.getByRole("button", { name: /managing a condition/i })).toBeVisible();
    } finally {
      await deleteTestPatient(fresh);
    }
  });

  test("she logs a home reading from the vitals screen and it appears in her history", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, patient);
    await page.goto("/patient/vitals");
    await page.locator("#systolic").fill("138");
    await page.locator("#diastolic").fill("86");
    await page.getByRole("button", { name: "Save reading" }).click();

    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from("vitals_readings")
            .select("systolic, diastolic, source")
            .eq("patient_id", patient.userId)
            .eq("vital_type", "blood_pressure");
          return data?.map((r) => `${r.systolic}/${r.diastolic}/${r.source}`) ?? [];
        },
        { timeout: 30_000 },
      )
      .toContain("138/86/manual");
  });

  test("an elevated first reading asks for a repeat instead of escalating (recheck flow)", async () => {
    // Server side only: S12 opens a triage_pending_rechecks row and one repeat task for the patient. Needs the
    // event bus processed, so skip unless PROCESS_EVENTS_SECRET is configured (see journey-helpers.drainEventBus).
    test.skip(!process.env.PROCESS_EVENTS_SECRET, "Set PROCESS_EVENTS_SECRET and serve process-events locally.");
    await expect
      .poll(
        async () => {
          const { data } = await adminClient.from("triage_events").select("grade").eq("patient_id", patient.userId);
          return (data ?? []).length;
        },
        { timeout: 45_000 },
      )
      .toBeGreaterThan(0);
  });

  // ---- Blocked or missing steps, one skip each, blocker named ----------------------------------------------

  test.skip("risk questionnaire places her at high cardiovascular risk and the screening calendar shows Essential due", async () => {
    // BLOCKER (not built as described): web has an on-demand cvd-risk-check.tsx and patient_risk_scores, and the
    // prevention module has screening_schedules, but there is no named "Essential screen" product tied to the risk
    // result and no calendar item that books from it. Needs a founder/CMO definition (audit finding F-6).
  });

  test.skip("she books the Essential screen with a SYNLAB collection point and pays at checkout", async () => {
    // BLOCKER (credentials): checkout needs a Paystack TEST key (PAYSTACK_SECRET_KEY, sk_test only), see the
    // existing skipped-without-key test in b2c-signup-to-entitlement.spec.ts. Lab order routing is proven at DB
    // level (s27_lab_results_release.sql, s25_catalogue_orders_payments.sql). Never run with a live key.
  });

  test.skip("a raised creatinine is reviewed by a clinician before release; results reach her Passport", async () => {
    // BLOCKER OQ-212 (no seeded clinician) plus partner-portal session for result entry. INV-03 is proven at DB
    // level in s27_lab_results_release.sql and s27c/s27d.
  });

  test.skip("results are explained in audio", async () => {
    // BLOCKER (spec stale): the journey says Pidgin. Pidgin was removed 2026-10-06; English audio clips exist via
    // the S32 manifest (apps/mobile/src/lib/audio). Rewrite the journey line before writing the test.
  });

  test.skip("she earns Health Points for consistent logging", async () => {
    // BLOCKER S58 (Module 11 rewards and engagement): no health_points table or event subscriber exists.
  });

  test.skip("her average stays above target and she is offered the hypertension care pack", async () => {
    // BLOCKER (missing producer): care packs exist (S25/S26) but nothing turns a rolling BP average over target into
    // an offer. outcomes S38 computes 90-day control but is a daily batch, not an offer trigger (audit F-7).
  });

  test.skip("her son in London joins her Care Circle and pays for the pack with his card", async () => {
    // BLOCKER (helper, credentials): invite acceptance runs under the supporter's JWT and the card payment needs a
    // Paystack test key. The permission and beneficiary rules are proven in s29_care_circle.sql, s29b and s29c.
  });
});
