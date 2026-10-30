// Tarragon Health — AbnormalResultHandler (docs/ARCHITECTURE.md §7)
//
// Invoked directly (not on a cron schedule) by the
// private.handle_abnormal_screening_result() trigger via net.http_post the
// instant a screening_results row lands with result_status abnormal|critical
// (see 20260711130000_abnormal_result_handler_trigger.sql). That trigger
// already wrote the screening_upgrades audit row and the clinician_alerts
// row with its two-tier contact SLA (both tiers live in the escalation_slas
// config row and are editable by an admin — never restate a number for them
// here, read it, see tightestSlaMinutes below) in the same
// transaction — that DB-level safety
// net is unconditional and does not depend on this function running at all.
// This function owns the rest of the flow: draft a care_plan or
// specialist_referral for clinician review, and alert the org's clinicians
// (60-second launch gate) + send the patient a follow-up message.
//
// 2026-07-30: the clinician alert is no longer a raw, untracked external API
// call — it now goes through private.enqueue_critical_notification (via the
// public.* service-role wrapper), which starts each clinician's alert on
// escalation_slas' configured first channel (push) and, if nobody confirms
// it, force-escalates through push -> email (the ladder has no sms or voice rung:
// private.normalize_escalation_channels drops them; OQ-727, founder decision
// 2026-10-27). See clinician-page.ts for what happens when nobody can be paged.
// This closes the exact gap this pathway used to have: nothing previously
// confirmed a clinician actually received or opened the alert, and nothing
// re-tried on a different channel if the send silently failed.
//
// 2026-09-05: two further ways this function could page nobody at all were
// closed. (1) The clinician recipient query filtered on `phone is not null`,
// so on a platform where no clinician profile carries a phone it enqueued
// nothing — even though the tracked path starts on push/in-app and needs no
// phone. (2) The patient follow-up message was external-only and the
// external channel was blocked on third-party approvals, so the patient was
// told nothing and no notifications row recorded the attempt; a `clinical`
// in_app row is now always written for a non-sensitive result. Founder
// decision F-02: patient follow-up is in-app only (no external patient send). The
// sensitive-screen suppression is untouched and still absolute.
//
// ML /interpret/screening is deliberately not called here — Sprint 4 (the ML
// microservice) is on hold (CLAUDE.md "Current Sprint") and ml-client.ts has
// no interpretScreening helper yet. Per docs/ARCHITECTURE.md §7, ML
// interpretation is optional/advisory only — the rule-based condition
// inference the trigger already did is sufficient for the upgrade to fire.
//
// Mirrors send-pending-notifications/index.ts: every external call has a
// timeout and never throws past its boundary; missing credentials degrade to
// a recorded audit_log failure, never a crash and never a silent drop.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { withSentry } from "../_shared/observability/sentry.ts";
import { type AlertLevel, pageClinicians } from "./clinician-page.ts";
import { checkJobsSecret } from "./auth.ts";

type UpgradeCondition = "hypertension" | "diabetes" | "cancer_referral" | "other";

interface RequestBody {
  screening_result_id: string;
  screening_upgrade_id: string;
  organisation_id: string;
  patient_id: string;
  condition: UpgradeCondition;
  abnormal_flags: string[];
  result_summary: string | null;
  // Sensitive positives (HIV / hepatitis / cancer) are doctor-delivered — the
  // trigger sets this so the patient auto-message is suppressed (AHC pathway
  // §10/§18.3/§23). Optional for backward-compatibility with older callers.
  sensitive?: boolean;
}

const CONDITION_LABEL: Record<UpgradeCondition, string> = {
  hypertension: "hypertension",
  diabetes: "diabetes",
  cancer_referral: "a cancer screening referral",
  other: "an abnormal result",
};

// Specialist mapped from the flag that triggered the cancer_referral
// condition (trigger's own flag groups — see the migration). Falls back to
// oncologist for any flag combination that doesn't map to a clearer
// specialty.
function inferSpecialistType(flags: string[]): string {
  if (flags.includes("psa")) return "urologist";
  if (flags.includes("cervical")) return "ob_gyn";
  return "oncologist";
}

Deno.serve(withSentry("abnormal-result-handler", async (req) => {
  // Only the database trigger may call this: it pages clinicians and writes patient notices with the service role, and the
  // function is deployed with verify_jwt off. The trigger sends the shared jobs secret (see auth.ts). A refusal is a 401, never a
  // 200, so it shows in net._http_response; the clinician_alerts row the trigger already wrote is unaffected either way.
  const auth = checkJobsSecret(req.headers.get("x-notification-jobs-secret"), Deno.env.get("NOTIFICATION_JOBS_SECRET"));
  if (auth === "not_configured") return Response.json({ ok: false, error: "not configured" }, { status: 503 });
  if (auth !== "ok") return Response.json({ ok: false, error: "unauthorised" }, { status: 401 });

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 200 });
  }

  const {
    screening_result_id: screeningResultId,
    screening_upgrade_id: screeningUpgradeId,
    organisation_id: organisationId,
    patient_id: patientId,
    condition,
    abnormal_flags: abnormalFlags,
    result_summary: resultSummary,
    sensitive,
  } = body;

  if (!screeningResultId || !organisationId || !patientId || !condition) {
    return Response.json({ ok: false, error: "missing required fields" }, { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const auditEvent = (action: string, entityType: string, entityId: string | null, event: Record<string, unknown>) =>
    supabase.from("audit_log").insert({
      organisation_id: organisationId,
      actor_id: null,
      action,
      entity_type: entityType,
      entity_id: entityId,
      event,
    });

  const [{ data: patient }, { data: clinicians }, { data: alert }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", patientId)
      .single()
      .returns<{ full_name: string | null }>(),
    // NO phone filter. The tracked path below (private.enqueue_critical_notification) starts every clinician's alert on
    // escalation_slas' first channel (push, then email, then in-app), which needs no phone at all. Before 2026-09-05 a
    // `phone is not null` filter here enqueued NOTHING on a platform where no clinician profile carried a phone. No clinician
    // page is ever sent by SMS or voice (OQ-727), so the phone column is not read at all.
    supabase
      .from("profiles")
      .select("id")
      .eq("organisation_id", organisationId)
      .eq("role", "clinician")
      .returns<Array<{ id: string }>>(),
    // The trigger already inserted exactly one clinician_alerts row for this
    // screening result, synchronously, in the same transaction — its `level`
    // (emergency|urgent_escalation) is what selects the right escalation_slas
    // channel ladder below, and its id is the source_id every notification in
    // this alert's chain traces back to.
    supabase
      .from("clinician_alerts")
      .select("id, level")
      .eq("screening_result_id", screeningResultId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .returns<{ id: string; level: AlertLevel } | null>(),
  ]);

  const patientName = patient?.full_name ?? "A patient";
  const conditionLabel = CONDITION_LABEL[condition];

  // Draft the clinician's next action. 'other' gets no auto-draft — the
  // clinician_alerts row the trigger already created is enough for manual
  // triage on a condition the rule-based inference couldn't classify.
  let draftedEntity: { type: string; id: string } | null = null;

  if (condition === "hypertension" || condition === "diabetes") {
    const { data: existing } = await supabase
      .from("care_plans")
      .select("id")
      .eq("patient_id", patientId)
      .eq("condition", condition)
      .in("status", ["draft", "active"])
      .limit(1)
      .maybeSingle();

    if (!existing) {
      const { data: carePlan, error } = await supabase
        .from("care_plans")
        .insert({
          organisation_id: organisationId,
          patient_id: patientId,
          condition,
          status: "draft",
          notes: `Auto-drafted from abnormal screening result ${screeningResultId}${
            resultSummary ? `: ${resultSummary}` : ""
          }.`,
        })
        .select("id")
        .single();
      if (!error && carePlan) {
        draftedEntity = { type: "care_plans", id: carePlan.id };
        await auditEvent("abnormal_result.care_plan_drafted", "care_plans", carePlan.id, {
          screening_result_id: screeningResultId,
          condition,
        });
      }
    }
  } else if (condition === "cancer_referral") {
    const { data: referral, error } = await supabase
      .from("specialist_referrals")
      .insert({
        organisation_id: organisationId,
        patient_id: patientId,
        screening_upgrade_id: screeningUpgradeId,
        specialist_type: inferSpecialistType(abnormalFlags ?? []),
        referral_reason: `Abnormal screening result ${screeningResultId}${
          resultSummary ? `: ${resultSummary}` : ""
        }.`,
        status: "pending",
        // Clinically-triggered, never payment-gated — see the booking_origin
        // enum's contract in the payment rail (payment gates logistics only,
        // never the clinical action itself).
        origin: "clinically_triggered",
      })
      .select("id")
      .single();
    if (!error && referral) {
      draftedEntity = { type: "specialist_referrals", id: referral.id };
      await auditEvent("abnormal_result.specialist_referral_drafted", "specialist_referrals", referral.id, {
        screening_result_id: screeningResultId,
        condition,
      });
    }
  }

  // Clinician alert(s) — broadcast to the org's pooled clinician worklist (patients aren't assigned a fixed clinician until one
  // claims the alert). Each clinician's alert is a tracked, critical-priority notification starting on escalation_slas' first
  // channel (push today); private.escalate_unconfirmed_critical_notifications() moves it push -> email if nobody confirms it, and
  // raises the exhausted-ladder admin alarm at the end. If nothing could be queued at all (no clinician, or every enqueue failed)
  // pageClinicians opens a sev1 ops incident so a named ops person phones the on-call clinician: never an audit row alone.
  const openIncident = async (reference: string, title: string, summary: string): Promise<boolean> => {
    try {
      const { data: existing, error: lookupError } = await supabase
        .from("ops_incidents")
        .select("id")
        .eq("external_reference", reference)
        .not("status", "in", "(resolved,closed)")
        .limit(1)
        .maybeSingle();
      if (!lookupError && existing) {
        // An incident is already open, which is what matters; a failed refresh only keeps the old text.
        await supabase.from("ops_incidents").update({ summary }).eq("id", existing.id);
        return true;
      }
      const nowIso = new Date().toISOString();
      // ack_due_at and resolve_due_at are overwritten by private.ops_incident_set_sla from the severity; they only satisfy NOT NULL.
      const { error } = await supabase.from("ops_incidents").insert({
        organisation_id: organisationId,
        category: "clinical",
        severity: "sev1",
        title,
        summary,
        external_reference: reference,
        ack_due_at: nowIso,
        resolve_due_at: nowIso,
      });
      if (error) console.error("abnormal-result-handler: could not open the page incident", error.message);
      return !error;
    } catch (err) {
      console.error("abnormal-result-handler: could not open the page incident", err instanceof Error ? err.message : err);
      return false;
    }
  };
  const audit = (action: string, entityType: string, entityId: string | null, event: Record<string, unknown>) =>
    auditEvent(action, entityType, entityId, event);

  const pageOutcome = await pageClinicians(supabase, openIncident, audit, {
    organisationId,
    screeningResultId,
    clinicianIds: (clinicians ?? []).map((c) => c.id),
    alert: alert ?? null,
    patientName,
    conditionLabel,
  });
  const clinicianAlertsQueued = pageOutcome.queued;
  const clinicianAlertsFailed = pageOutcome.failed;

  // Patient follow-up message — reassurance, not the clinical detail.
  //
  // Sensitive positives (HIV / hepatitis / cancer) are NEVER auto-messaged:
  // the news is broken by a doctor, with care and immediate linkage (AHC
  // pathway §10/§18.3/§23). The clinician alert above still fired, so the
  // result is never lost — it just waits for a human. This gate is the whole
  // point of the `sensitive` flag; do not "helpfully" send a generic message
  // here on the assumption it's harmless.
  //
  // For every NON-sensitive result the message lands in-app ONLY (founder
  // decision F-02: external patient channels removed; there is no external
  // patient send here at all). Before 2026-09-05 the external legs failed,
  // no `notifications` row was ever written, and this function still
  // returned ok: the patient was told nothing at all and nothing recorded
  // that. The in-app row below is the patient's copy.
  let patientInAppQueued = false;
  if (sensitive) {
    await auditEvent("abnormal_result.patient_notification_suppressed_sensitive", "profiles", patientId, {
      reason: "sensitive result — doctor-delivered per AHC pathway §23",
      condition,
    });
  } else {
    const { error: inAppError } = await supabase.from("notifications").insert({
      organisation_id: organisationId,
      recipient_id: patientId,
      channel: "in_app",
      // Deliberately `clinical`: it says a result needs follow-up. The
      // notifications_no_clinical_on_open_rail CHECK allows clinical content
      // on in_app (it only bars it from sms/email), which is exactly
      // why in_app is the right fallback rail for this message.
      content_class: "clinical",
      priority: "critical",
      template: "abnormal_result_patient_followup",
      payload: { condition, condition_label: conditionLabel },
      source_table: "screening_results",
      source_id: screeningResultId,
    });
    patientInAppQueued = !inAppError;
    if (inAppError) {
      await auditEvent("abnormal_result.patient_in_app_failed", "profiles", patientId, {
        error: inAppError.message,
      });
    }

    // No external patient send (F-02). Audit records that only in-app was queued.
    await auditEvent("abnormal_result.patient_followup_in_app", "profiles", patientId, {
      sent: false,
      in_app_queued: patientInAppQueued,
      reason: "external patient channels removed (in-app only)",
    });
  }

  return Response.json({
    ok: true,
    condition,
    drafted: draftedEntity,
    clinician_alerts_queued: clinicianAlertsQueued,
    clinician_alerts_failed: clinicianAlertsFailed,
    patient_in_app_queued: patientInAppQueued,
    patient_notification_suppressed_sensitive: Boolean(sensitive),
    page_incident_opened: pageOutcome.incidentOpened,
  }, { status: pageOutcome.incidentFailed ? 500 : 200 });
}));
