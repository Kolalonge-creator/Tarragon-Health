// Tarragon Health — AbnormalResultHandler (docs/ARCHITECTURE.md §7)
//
// Invoked directly (not on a cron schedule) by the
// private.handle_abnormal_screening_result() trigger via net.http_post the
// instant a screening_results row lands with result_status abnormal|critical
// (see 20260711130000_abnormal_result_handler_trigger.sql). That trigger
// already wrote the screening_upgrades audit row and the clinician_alerts
// row with its two-tier contact SLA (both tiers live in the escalation_slas
// config row and are editable by an admin — never restate a number for them
// here) in the same
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
// it, force-escalates through push -> email -> sms (email replaces the former
// chat-app hop via private.normalize_escalation_channels; SMS here is
// clinician paging, which remains allowed — see critical_notification_engine.sql).
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
// INV-08: this function makes no external call at all; every alert is a queued notification.
// timeout and never throws past its boundary; missing credentials degrade to
// a recorded audit_log failure, never a crash and never a silent drop.

import { createClient } from "jsr:@supabase/supabase-js@2";

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

/** The service-role client this function runs everything through. */
type ServiceClient = ReturnType<typeof createClient>;

Deno.serve(async (req) => {
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
      .select("full_name, phone")
      .eq("id", patientId)
      .single()
      .returns<{ full_name: string | null; phone: string | null }>(),
    // NO phone filter. The tracked path below
    // (private.enqueue_critical_notification) starts every clinician's alert
    // on escalation_slas' first channel — push/in-app — which needs no phone
    // at all, and send-pending-notifications already skips a phone-less hop
    // per channel. Filtering on `phone is not null` here meant that on a
    // platform where no clinician profile carries a phone (live, 2026-09-05:
    // 7 clinicians, 0 with a phone) this function enqueued NOTHING and wrote
    // an `abnormal_result.no_clinician_available` audit row instead — pageing
    // nobody about a Priority 1 result over channels that never needed a
    // phone number. Only the legacy direct-send fallback genuinely requires
    // one, and it filters for itself.
    supabase
      .from("profiles")
      .select("id, phone")
      .eq("organisation_id", organisationId)
      .eq("role", "clinician")
      .returns<Array<{ id: string; phone: string | null }>>(),
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
      .returns<{ id: string; level: "clinician_review" | "urgent_escalation" | "emergency" | "routine" } | null>(),
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

  // Clinician alert(s) — broadcast to the org's pooled clinician worklist
  // (patients aren't assigned a fixed clinician until one claims the alert).
  // Each clinician's alert is enqueued as a tracked, critical-priority
  // notification starting on escalation_slas' configured first channel
  // (push today) — private.escalate_unconfirmed_critical_notifications()
  // force-escalates it through push -> email -> sms if nobody confirms it,
  // rather than this function firing one untracked blast and hoping.
  const clinicianList = clinicians ?? [];
  let clinicianAlertsQueued = 0;
  let clinicianAlertsFailed = 0;

  if (clinicianList.length === 0) {
    // Genuinely nobody to page: this org has no clinician profile at all.
    // (Before 2026-09-05 this branch also caught the far more common case of
    // clinicians who simply have no phone number on file — see the recipient
    // query above.)
    await auditEvent("abnormal_result.no_clinician_available", "screening_results", screeningResultId, {
      organisation_id: organisationId,
    });
  } else if (!alert) {
    // Should be structurally impossible: the trigger inserts this row in the same transaction that invokes this function. Never silently
    // drop a Priority 1 alert on an unexpected gap, and never fall back to SMS (INV-08, decision D-12: push, console and email only).
    // Queue the same tracked notification the normal path uses, sourced from the screening result itself, so it travels the same push then
    // email ladder and is recorded; and write an audit event so the gap is visible.
    const results = await Promise.all(
      clinicianList.map((clinician) =>
        supabase.rpc("enqueue_critical_notification", {
          p_organisation_id: organisationId,
          p_recipient_id: clinician.id,
          p_template: "abnormal_result_clinician_alert",
          p_payload: { patient_name: patientName, condition_label: conditionLabel },
          p_pathway: "screening_abnormal_result",
          p_alert_tier: "urgent_escalation",
          p_source_table: "screening_results",
          p_source_id: screeningResultId,
        })
      ),
    );
    clinicianAlertsQueued = results.filter((r) => !r.error).length;
    clinicianAlertsFailed = results.length - clinicianAlertsQueued;
    await auditEvent("abnormal_result.clinician_alert_row_missing_fallback_queued", "screening_results", screeningResultId, {
      queued: clinicianAlertsQueued,
      failed: clinicianAlertsFailed,
      recipients: clinicianList.length,
    });
  } else {
    const results = await Promise.all(
      clinicianList.map((clinician) =>
        supabase.rpc("enqueue_critical_notification", {
          p_organisation_id: organisationId,
          p_recipient_id: clinician.id,
          p_template: "abnormal_result_clinician_alert",
          p_payload: { patient_name: patientName, condition_label: conditionLabel },
          p_pathway: "screening_abnormal_result",
          p_alert_tier: alert.level,
          p_source_table: "clinician_alerts",
          p_source_id: alert.id,
        })
      ),
    );
    clinicianAlertsQueued = results.filter((r) => !r.error).length;
    clinicianAlertsFailed = results.length - clinicianAlertsQueued;
    await auditEvent("abnormal_result.clinician_alerts_queued", "screening_results", screeningResultId, {
      queued: clinicianAlertsQueued,
      failed: clinicianAlertsFailed,
      recipients: clinicianList.length,
      alert_level: alert.level,
    });
  }

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
  });
});
