import { expect, test } from "@playwright/test";
import { adminClient, deleteTestPatient, type TestPatient } from "../helpers/supabase-admin";
import { createJourneyPatient, drainEventBus, loginAs, pollWithDrain } from "./journey-helpers";

/**
 * Journey 2 (spec D.7.3): a red reading at night.
 *
 *   "At 2 am a programme member logs 190/120 with a headache. The triage engine grades red before any AI is
 *    involved; offline emergency guidance appears immediately with the nearest emergency facilities; the
 *    on-call clinician is paged through the console; the user's consented Care Circle contact receives a push
 *    alert. The clinician's call and decision are recorded; the next day a follow-up consultation is booked
 *    automatically and the outcomes engine logs the event."
 *
 * LOCAL STACK ONLY (global-setup.ts refuses anything else). All data is is_test.
 *
 * STATUS: written, NOT run in the session that wrote it (no local Supabase stack was started, by instruction).
 * Selectors for the web vitals form are read from vitals-form.tsx; the guidance text assertion in step 2 is the
 * one to confirm first on a real run.
 *
 * Environment knobs, all optional:
 *   PROCESS_EVENTS_SECRET  with `supabase functions serve process-events`: lets the spec drive the event bus the
 *                          way pg_cron does in production. Without it the downstream steps skip, naming why.
 *
 * What each step proves, and what is skipped and why, is tabulated in docs/audit-D7-journeys.md (Journey 2).
 *
 * Shadow mode (OQ-88): until the CMO approves a bp_care_triage rule set the server grades with the bundled draft
 * and every triage_events row is shadow = true, and a shadow event never pages. A fresh `db reset` has no
 * approved set, so step 4 asserts a page only when the graded row is not shadow, and otherwise asserts the
 * opposite (no page), which is the invariant that matters while the set is unsigned.
 */
test.describe.configure({ mode: "serial" });

const runId = Date.now().toString();

test.describe("journey 2: a red reading at night", () => {
  let patient: TestPatient;
  let readingId: string;
  let triageEventId: string;
  let triageIsShadow = false;
  let busAvailable = false;

  test.beforeAll(async () => {
    patient = await createJourneyPatient(runId);
    // The headache the patient reports. Inserted before the reading: triage_context_for_observation reads
    // symptoms within 10 minutes either side of the reading, and a symptom arriving after is regraded by trigger.
    const { error } = await adminClient.from("symptoms").insert({
      organisation_id: patient.organisationId,
      patient_id: patient.userId,
      description: "[e2e-test] Severe headache",
      symptom_type: "severe_headache",
      is_red_flag: true,
      severity: 8,
    });
    if (error) throw error;
  });

  test.afterAll(async () => {
    if (patient) await deleteTestPatient(patient);
  });

  test("step 1: 190/120 is saved through the real form and emits an observation.recorded event", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, patient);
    await page.goto("/patient/vitals");

    await page.locator("#systolic").fill("190");
    await page.locator("#diastolic").fill("120");
    await page.getByRole("button", { name: "Save reading" }).click();

    const reading = await pollWithDrain(async () => {
      const { data } = await adminClient
        .from("vitals_readings")
        .select("id, systolic, diastolic")
        .eq("patient_id", patient.userId)
        .eq("vital_type", "blood_pressure")
        .maybeSingle();
      return data;
    });
    expect(reading.systolic).toBe(190);
    expect(reading.diastolic).toBe(120);
    readingId = reading.id;

    const { data: events } = await adminClient
      .from("domain_events")
      .select("id, is_test, patient_id")
      .eq("event_type", "observation.recorded")
      .eq("aggregate_id", readingId);
    expect(events?.length ?? 0).toBeGreaterThanOrEqual(1);
    // INV-13: the bus stamps is_test from the patient, so metrics and payouts exclude this journey.
    expect(events?.every((e) => e.is_test)).toBe(true);
  });

  test("step 2: the patient sees emergency guidance immediately, not after a clinician answers", async ({ page }) => {
    await loginAs(page, patient);
    await page.goto("/patient/vitals");
    // Guidance must name going in person to a hospital (Nigeria has no single reliable emergency number, so the
    // copy never tells the patient to wait for a call). Wording is signed content (EMG-001 family), so assert the
    // stable phrase, not the whole sentence.
    await expect(page.getByText(/nearest hospital/i).first()).toBeVisible({ timeout: 30_000 });
  });

  test("step 3: the server grades the reading red from the rule set, with the version recorded, before any AI", async () => {
    busAvailable = await drainEventBus();
    test.skip(
      !busAvailable,
      "Blocked on environment, not product: set PROCESS_EVENTS_SECRET and run `supabase functions serve process-events` so the bus is processed (pg_cron does it in production).",
    );

    const triage = await pollWithDrain(async () => {
      const { data } = await adminClient
        .from("triage_events")
        .select("id, grade, rule_set_code, rule_set_version, rule_set_status, shadow, is_test, basis")
        .eq("trigger_id", readingId)
        .eq("trigger_type", "observation")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    });

    expect(triage.grade).toBe("red");
    // INV-16: every decision records the rule set version it used.
    expect(triage.rule_set_code).toBe("bp_care_triage");
    expect(triage.rule_set_version).toBeGreaterThan(0);
    // INV-01: the grade comes from a rule set row, never a model. There is no model-call column to read, so the
    // proof is structural: the row cites a rule set and a basis, and the handler path (supabase/functions/_shared/
    // triage/observation-handler.ts) imports no model client (asserted by a repo scan, see audit D.7).
    expect(triage.basis).toBeTruthy();
    expect(triage.is_test).toBe(true);
    triageEventId = triage.id;
    triageIsShadow = triage.shadow;
  });

  test("step 4: the on-call clinician is paged, unless the rule set is still an unsigned draft", async () => {
    test.skip(!busAvailable, "Needs the event bus processed, see step 3.");

    if (triageIsShadow) {
      // OQ-88: a shadow red must NOT page. This is the safe behaviour until the CMO signs the rule set.
      await drainEventBus();
      const { data } = await adminClient.from("pages").select("id").eq("triage_event_id", triageEventId);
      expect(data ?? []).toHaveLength(0);
      test.info().annotations.push({
        type: "shadow-mode",
        description: "Graded red but shadow: no page by design (OQ-88). Approve a bp_care_triage rule set locally to exercise paging.",
      });
      return;
    }

    const page = await pollWithDrain(async () => {
      const { data } = await adminClient
        .from("pages")
        .select("id, is_test, no_cover, role, config_version")
        .eq("triage_event_id", triageEventId)
        .is("parent_page_id", null)
        .maybeSingle();
      return data;
    });
    // INV-05: a page row exists, not only a queue task. With no rota seeded locally it is the safety-case-9
    // "no cover" page that goes straight to leadership, which is still a page and not a silent queue item.
    expect(page.is_test).toBe(true);
    expect(page.config_version).toBeGreaterThan(0);
  });

  test("offline: the web form refuses to look saved when the network is down", async ({ page, context }) => {
    // The mobile app evaluates red rules on device (INV-06, covered by the Maestro flow). On the web the honest
    // behaviour is a clear offline notice, never a silent success. Copy from vitals-form.tsx.
    await loginAs(page, patient);
    await page.goto("/patient/vitals");
    await page.locator("#systolic").fill("185");
    await page.locator("#diastolic").fill("115");
    await context.setOffline(true);
    await page.getByRole("button", { name: "Save reading" }).click();
    await expect(page.getByText(/You're offline\. Reconnect, then press Save reading again\./)).toBeVisible({ timeout: 10_000 });
    await context.setOffline(false);
  });

  // ---- Steps that cannot be written yet, each with the blocker named ----------------------------------------

  test.skip("step 5: the consented Care Circle member receives a neutral push alert", async () => {
    // BLOCKER (helper, not product): needs a care_circle_members row holding the red_alerts permission, which is
    // created by accept_care_circle_invite under the supporter's own JWT. The trigger that sends the alert is
    // pages_notify_circle (S29) and it IS proven at DB level in packages/db/tests/s29_care_circle.sql. Add a
    // supporter-session helper, then assert one notification exists whose text matches no clinical term (INV-07).
  });

  test.skip("step 6: the clinician's call and decision are recorded", async () => {
    // BLOCKER OQ-212: no seeded clinician fixture for browser tests (a clinician needs clinical_staff, a rota
    // row, competencies and a signed-in console session on apps/console). DB level: s19_red_event_paging.sql
    // (acknowledge_page, close_page) and s16/s17 (task claim and completion).
  });

  test.skip("step 7: the next day a follow-up consultation is booked automatically", async () => {
    // BLOCKER (missing producer): nothing in the repository books a follow-up consultation off a red page or a
    // red triage event. Verified by repository search on 2026-10-07, see docs/audit-D7-journeys.md finding F-4.
    // Build the producer first (encounter.scheduled exists, S21), then write this assertion.
  });

  test.skip("step 8: the outcomes engine logs the event", async () => {
    // BLOCKER (no API surface): S38 computes snapshots in a daily private job (private.compute_outcome_snapshots,
    // emits outcome.snapshot_computed) and nothing subscribes to triage.graded or pages. Covered at DB level by
    // s38_outcome_snapshots_and_analytics.sql. A red-event outcome row is a spec gap, see audit finding F-5.
  });
});
