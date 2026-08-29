import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import { patientHasVitalsEscalationAccess } from "@/lib/clinical/vitals-escalation-access";
import type { InitialCapture, OutcomeNode, RedFlagScreenEntry } from "./types";
import type { NodeAnswers } from "./engine";

type PersistParams = {
  organisationId: string;
  patientId: string;
  loggedByProfileId: string;
  presentingComplaintKey: string;
  protocolVersion: number;
  capture: InitialCapture;
  answers: NodeAnswers;
  redFlag: RedFlagScreenEntry | null;
  outcome: OutcomeNode;
};

/**
 * Persists one symptom_triage_assessments row and, depending on the
 * resolved category, raises the same downstream rows the platform's other
 * deterministic triggers already raise -- this module never invents its own
 * escalation path where a proven one exists.
 *
 * category === "emergency": inserts emergency_events (source:
 * "symptom_triage"), same single-row pattern as
 * danger-symptom-check/actions.ts's reportDangerSymptoms. The platform's
 * existing emergency_events trigger fans this out to a clinician_alerts row
 * on its own -- including applying the vitals_red_flag_doctor_escalation
 * paid-plan gate CLAUDE.md documents for that trigger (Free tier still gets
 * the full non-clinician safety net; the doctor page is what's gated, not
 * the patient's own guidance). This function does not re-implement that
 * gate for the emergency path -- doing so here would risk drifting from the
 * one real gate.
 *
 * category === "urgent", or "routine" with clinicianReviewRequired: no DB
 * trigger covers this path (it isn't an emergency_events row), so this is
 * exactly the "app-layer" case vitals-escalation-access.ts's own docstring
 * describes -- patientHasVitalsEscalationAccess is checked directly here,
 * reusing the same feature flag rather than inventing a second one.
 *
 * Always throws-never: the assessment row itself is the source of truth for
 * what happened, even if a downstream alert insert fails -- same
 * additive-must-not-lose-the-persisted-row discipline as
 * ai-coach/escalate.ts's emergency_events step.
 */
export async function persistTriageAssessment(
  serviceRoleSupabase: SupabaseClient<Database>,
  params: PersistParams
): Promise<{ assessmentId: string }> {
  const {
    organisationId,
    patientId,
    loggedByProfileId,
    presentingComplaintKey,
    protocolVersion,
    capture,
    answers,
    redFlag,
    outcome,
  } = params;

  let emergencyEventId: string | null = null;
  let clinicianAlertId: string | null = null;

  if (outcome.category === "emergency") {
    const { data: event, error } = await serviceRoleSupabase
      .from("emergency_events")
      .insert({
        organisation_id: organisationId,
        patient_id: patientId,
        source: "symptom_triage",
        trigger_detail: redFlag ? redFlag.label : outcome.rationale,
        status: "active",
      })
      .select("id")
      .single();
    if (error) console.error("symptom-triage: could not create emergency_events row", error);
    emergencyEventId = event?.id ?? null;
  } else if (outcome.clinicianReviewRequired) {
    const hasAccess = await patientHasVitalsEscalationAccess(serviceRoleSupabase, patientId);
    if (hasAccess) {
      const isUrgent = outcome.category === "urgent";
      const { data: alert, error } = await serviceRoleSupabase
        .from("clinician_alerts")
        .insert({
          organisation_id: organisationId,
          patient_id: patientId,
          level: isUrgent ? "urgent_escalation" : "clinician_review",
          status: "open",
          title: isUrgent ? "Symptom checker: needs prompt review" : "Symptom checker: needs review",
          detail: outcome.rationale,
          sla_due_at: new Date(Date.now() + (isUrgent ? 24 : 72) * 60 * 60 * 1000).toISOString(),
          category: "clinical",
          type_code: "symptom_escalation",
        })
        .select("id")
        .single();
      if (error) console.error("symptom-triage: could not create clinician_alerts row", error);
      clinicianAlertId = alert?.id ?? null;
    }
  }

  const { data: assessment, error: assessmentError } = await serviceRoleSupabase
    .from("symptom_triage_assessments")
    .insert({
      organisation_id: organisationId,
      patient_id: patientId,
      logged_by_profile_id: loggedByProfileId,
      entry_point: "patient_app",
      presenting_complaint_key: presentingComplaintKey,
      protocol_version: protocolVersion,
      initial_capture: capture as unknown as Json,
      questions_asked: answers as unknown as Json,
      red_flag_screen: (redFlag ?? {}) as unknown as Json,
      category: outcome.category,
      clinician_review_required: outcome.clinicianReviewRequired,
      safety_net_message_key: outcome.safetyNetMessageKey,
      rationale: outcome.rationale,
      emergency_event_id: emergencyEventId,
      clinician_alert_id: clinicianAlertId,
    })
    .select("id")
    .single();
  if (assessmentError || !assessment) {
    throw new Error(assessmentError?.message ?? "Could not save this assessment");
  }

  return { assessmentId: assessment.id };
}
