import { test } from "@playwright/test";

/**
 * Journey 3 (spec D.7.3): from symptom to treatment.
 *
 *   "A user with burning urination opens the symptom checker. It asks structured questions, suggests the most
 *    likely causes in plain language with how common each is, grades urgency as 'see a doctor within 24 hours',
 *    and offers an asynchronous consultation. The doctor sees the symptom summary, confirms a likely urinary
 *    infection, requests a urine test at a partner lab, and prescribes. The prescription goes to the user's chosen
 *    partner pharmacy for collection; the course is added to the medicine schedule; the assistant checks in on
 *    day three; the symptom checker's suggestion and the doctor's diagnosis are compared in the monthly accuracy
 *    audit."
 *
 * Nothing can be driven end to end today: the entry point (the symptom checker, Module 12, sessions S59 and S60)
 * is not built. This file exists so the journey has a named home, and so each downstream piece that IS built has
 * its proof pointer recorded in one place. Every test is skipped with its blocker; none is a silent pass.
 *
 * Pieces that exist and have DB-level proofs, to be stitched in once S59/S60 land:
 *   written question to a doctor      s22_written_questions_and_notes.sql (async_question.submitted/answered)
 *   doctor signs, prescribes          s24_prescriptions_and_care_plan_changes.sql (INV-02)
 *   prescription to chosen pharmacy   s28_pharmacy_collection_and_dispensing.sql (prescription.sent/dispensed)
 *   lab order from a clinician        s27_lab_results_release.sql
 *   triage accuracy audit             s38e_sponsor_cohorts_and_triage_accuracy.sql (triage agreement, not a
 *                                      symptom-checker-versus-diagnosis comparison)
 */
test.describe("journey 3: from symptom to treatment", () => {
  test.skip("symptom checker asks structured questions and grades urgency 'see a doctor within 24 hours'", async () => {
    // BLOCKER S59 and S60: no symptom checker module, no checker tables, no event. INV-01 applies: grading is
    // deterministic code in packages/clinical, never a model.
  });

  test.skip("the checker offers an asynchronous consultation and the doctor sees the symptom summary", async () => {
    // BLOCKER S59/S60 for the summary; the written-question flow itself (S22) is built. Also OQ-212 (no clinician
    // fixture) for the doctor side in a browser.
  });

  test.skip("the doctor requests a urine test at a partner lab and prescribes", async () => {
    // BLOCKER OQ-212 plus S59/S60. Prescription signing (INV-02) and lab ordering are proven at DB level.
  });

  test.skip("the prescription reaches the chosen pharmacy and the course joins the medicine schedule", async () => {
    // BLOCKER: no active pharmacy partner exists yet (memory: S28, release blockers checklist). prescription.sent
    // is emitted by S28 but has no subscriber; the schedule insert after the user confirms is the S24
    // care_plan_change.confirmed path, not a bus reaction (audit event map row 4).
  });

  test.skip("the assistant checks in on day three", async () => {
    // BLOCKER (missing producer): no scheduled check-in is created from a prescription or a consultation.
  });

  test.skip("the monthly accuracy audit compares the checker's suggestion with the doctor's diagnosis", async () => {
    // BLOCKER S59/S60 (no suggestion is stored) and S75 (analytics). The existing triage accuracy report compares
    // triage grades with clinician judgement, which is a different measure.
  });
});
