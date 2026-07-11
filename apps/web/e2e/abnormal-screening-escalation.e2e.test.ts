// E2E test for the Cat 2 -> Cat 1 abnormal-screening escalation pipeline
// (CLAUDE.md "Abnormal screening result handling"; docs/ARCHITECTURE.md §7).
//
// Runs against the real linked Supabase project — there is no local/CLI
// Supabase stack in this environment and branching (which would give this
// test a disposable database) needs a Pro-plan upgrade the org doesn't have
// yet. Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the
// shell env; the whole suite is skipped if they're missing. Not part of
// `pnpm test` — run explicitly with `pnpm test:e2e` (see jest.e2e.config.mjs).
//
// Cleanup caveat (see supabase/migrations/20260711140000_audit_log_organisation_restrict.sql):
// audit_log is append-only and its organisation_id FK is 'on delete
// restrict', so once the Edge Function writes an audit_log row for this
// run's organisation, that organisation can never be deleted. Cleanup
// removes everything it can (both auth users, which cascades their
// profiles/screening_results/screening_upgrades/clinician_alerts/care_plans)
// but the organisation row and its audit_log trail are permanent by design —
// hence the '[e2e-test]' name prefix, so any that need pruning later are easy
// to find.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const maybeDescribe = SUPABASE_URL && SERVICE_ROLE_KEY ? describe : describe.skip;

async function pollUntil<T>(
  fn: () => Promise<T | null>,
  { timeoutMs = 20_000, intervalMs = 1_000 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() >= deadline) {
      throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

maybeDescribe("abnormal screening result -> Category 1 escalation", () => {
  const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
  const runId = Date.now().toString();

  let organisationId: string;
  let clinicianUserId: string;
  let patientUserId: string;

  beforeAll(async () => {
    const { data: org, error: orgError } = await supabase
      .from("organisations")
      .insert({
        name: `[e2e-test] Abnormal Screening Escalation ${runId}`,
        type: "clinic",
        metadata: { e2e_test: true },
      })
      .select("id")
      .single();
    if (orgError || !org) throw orgError ?? new Error("organisation insert returned no row");
    organisationId = org.id;

    // Created by email, not phone, and role/organisation_id/phone are set via
    // a follow-up UPDATE rather than trusted to private.handle_new_user() —
    // two unrelated bugs in that trigger, found while writing this test, mean
    // it can't be relied on:
    // (1) supabase.auth.admin.createUser({ phone }) strips the leading '+'
    //     before the trigger copies it into profiles.phone, violating
    //     profiles_phone_e164.
    // (2) The trigger fires on auth.users' initial INSERT, before GoTrue's
    //     follow-up UPDATE actually attaches the app_metadata passed to
    //     createUser — so role/organisation_id are never picked up and every
    //     programmatically-created user ends up a patient with a hardcoded
    //     default org. The live function also has a coalesce-to-default-org
    //     fallback that doesn't exist in any local migration (drift).
    // Both are pre-existing product bugs, flagged to the user, not fixed here.
    const { data: clinician, error: clinicianError } = await supabase.auth.admin.createUser({
      email: `e2e-test-clinician-${runId}@example.com`,
      email_confirm: true,
      user_metadata: { full_name: "[e2e-test] Clinician" },
    });
    if (clinicianError || !clinician.user) throw clinicianError ?? new Error("clinician user create failed");
    clinicianUserId = clinician.user.id;

    const { data: patient, error: patientError } = await supabase.auth.admin.createUser({
      email: `e2e-test-patient-${runId}@example.com`,
      email_confirm: true,
      user_metadata: { full_name: "[e2e-test] Patient" },
    });
    if (patientError || !patient.user) throw patientError ?? new Error("patient user create failed");
    patientUserId = patient.user.id;

    // private.handle_new_user() provisions the profile row on the auth.users
    // insert trigger — wait for it, then set the fields that trigger can't be
    // trusted to set correctly (see above).
    await pollUntil(async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id")
        .in("id", [clinicianUserId, patientUserId]);
      return data && data.length === 2 ? data : null;
    });

    await supabase
      .from("profiles")
      .update({ role: "clinician", organisation_id: organisationId, phone: `+2341${runId.slice(-9)}` })
      .eq("id", clinicianUserId);
    await supabase
      .from("profiles")
      .update({ role: "patient", organisation_id: organisationId, phone: `+2342${runId.slice(-9)}` })
      .eq("id", patientUserId);
  });

  afterAll(async () => {
    if (patientUserId) await supabase.auth.admin.deleteUser(patientUserId);
    if (clinicianUserId) await supabase.auth.admin.deleteUser(clinicianUserId);
    if (organisationId) {
      // Expected to fail once the Edge Function has written an audit_log row
      // for this organisation_id — see the module-level comment. That's the
      // correct, intentional behaviour, not a test bug.
      const { error } = await supabase.from("organisations").delete().eq("id", organisationId);
      if (error) {
        console.warn(
          `[e2e-test] organisation ${organisationId} left in place (has audit_log history, ` +
            `which is permanent by design): ${error.message}`,
        );
      }
    }
  });

  test("insert triggers the DB safety net synchronously and the Edge Function drafts a care plan and logs notification attempts", async () => {
    const { data: screeningResult, error: insertError } = await supabase
      .from("screening_results")
      .insert({
        organisation_id: organisationId,
        patient_id: patientUserId,
        result_status: "abnormal",
        abnormal_flags: ["bp", "blood_pressure"],
        result_summary: "[e2e-test] BP 172/108 at home reading",
      })
      .select("id")
      .single();
    if (insertError || !screeningResult) throw insertError ?? new Error("screening_results insert returned no row");
    const screeningResultId = screeningResult.id;

    // DB-level safety net (private.handle_abnormal_screening_result): runs in
    // the same transaction as the insert above, so it must already be visible.
    const { data: upgrades } = await supabase
      .from("screening_upgrades")
      .select("id, condition_triggered")
      .eq("screening_result_id", screeningResultId);
    expect(upgrades).toHaveLength(1);
    expect(upgrades![0].condition_triggered).toBe("hypertension");

    const { data: alerts } = await supabase
      .from("clinician_alerts")
      .select("id, level, status, sla_due_at")
      .eq("patient_id", patientUserId);
    expect(alerts).toHaveLength(1);
    expect(alerts![0].level).toBe("urgent_escalation");
    expect(alerts![0].status).toBe("open");
    expect(alerts![0].sla_due_at).not.toBeNull();

    // The trigger's net.http_post call to abnormal-result-handler is async —
    // poll for its side effects rather than asserting immediately.
    const carePlan = await pollUntil(async () => {
      const { data } = await supabase
        .from("care_plans")
        .select("id, status, condition")
        .eq("patient_id", patientUserId)
        .eq("condition", "hypertension")
        .maybeSingle();
      return data;
    });
    expect(carePlan.status).toBe("draft");

    const clinicianAlertEvent = await pollUntil(async () => {
      const { data } = await supabase
        .from("audit_log")
        .select("event")
        .eq("action", "abnormal_result.clinician_alerts_sent")
        .eq("entity_id", screeningResultId)
        .maybeSingle();
      return data;
    });
    // WHATSAPP_TOKEN/TERMII_API_KEY secrets aren't set on this project yet
    // (CLAUDE.md "Current Sprint"), so sends fail closed — the pipeline's job
    // is to record that failure, not to have actually delivered a message.
    expect(clinicianAlertEvent.event.recipients).toBe(1);
    expect(clinicianAlertEvent.event.sent + clinicianAlertEvent.event.failed).toBe(1);

    const patientNotifiedEvent = await pollUntil(async () => {
      const { data } = await supabase
        .from("audit_log")
        .select("event")
        .eq("action", "abnormal_result.patient_notified")
        .eq("entity_id", patientUserId)
        .maybeSingle();
      return data;
    });
    expect(patientNotifiedEvent.event).toHaveProperty("sent");
  });
});
