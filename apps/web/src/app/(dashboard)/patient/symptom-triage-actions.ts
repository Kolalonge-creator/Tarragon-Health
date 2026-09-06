"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveSubjectId } from "@/lib/acting/acting-for";
import { getActivePathway, getActiveTriageProtocolConfig } from "@/lib/symptom-triage/protocol";
import { symptomTriageStepSchema, type SymptomTriageStepInput } from "@/lib/validation/symptom-triage";
import { nextTriageStep, runTriage } from "@tarragon/symptom-triage-engine";
import type { QuestionNode } from "@tarragon/symptom-triage-engine";
import type { Json } from "@tarragon/shared";

/**
 * Symptom Assessment & Triage Engine (platform brief §37) — patient-facing
 * wizard actions. Every step re-derives the current question/outcome from
 * scratch by re-running the pure interpreter against the SIGNED, ACTIVE
 * protocol config (never trusts a client-claimed question index or
 * category — same discipline as mental_health_screens/prevention_risk_scores:
 * the classification is always recomputed server-side). The final insert
 * goes through the service role (symptom_triage_assessments has no INSERT
 * grant to `authenticated` at all), and the DB's own escalation trigger
 * (private.handle_symptom_triage_assessment) is what actually raises any
 * clinician_alerts/emergency_events row — this file never writes to those
 * tables itself, so the escalation can't be silently dropped by a
 * missing/buggy step here (same reasoning as private.handle_symptom_red_flag).
 */

export type PresentingComplaintOption = { key: string; label: string };

/** For the complaint-picker step — only pathways in the currently SIGNED config. */
export async function listAvailablePresentingComplaints(): Promise<PresentingComplaintOption[]> {
  const active = await getActiveTriageProtocolConfig();
  if (!active) return [];
  return active.config.pathways.map((p) => ({ key: p.key, label: p.label }));
}

export type SymptomTriageStepResult =
  | { status: "unavailable" }
  | { status: "error"; error: string }
  | {
      status: "in_progress";
      question: QuestionNode;
      state: SymptomTriageStepInput;
    }
  | {
      status: "complete";
      category: string;
      clinicianReviewRequired: boolean;
      safetyNetMessageKey: string;
      assessmentId: string;
    };

/**
 * Advance the wizard by one step. `input` is the FULL rolling state
 * (capture + answers so far + the question log) — see
 * lib/validation/symptom-triage.ts. Called directly from the client
 * component (not a <form action>), so it receives a real typed object, not
 * FormData; the schema below is defence-in-depth, not the parsing layer.
 */
export async function stepSymptomTriage(input: SymptomTriageStepInput): Promise<SymptomTriageStepResult> {
  const parsed = symptomTriageStepSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { capture, answers, questionLog } = parsed.data;

  const active = await getActivePathway(capture.presentingComplaintKey);
  if (!active) return { status: "unavailable" };
  const { pathway, protocolVersion } = active;

  const result = runTriage(pathway, capture, answers, questionLog);

  if (result.nextQuestion) {
    return {
      status: "in_progress",
      question: result.nextQuestion,
      state: { capture, answers, questionLog: result.questionsAsked },
    };
  }

  // Done — persist the full audit trail (§37.10) and let the DB trigger
  // drive escalation. Re-run the walk one more time via nextTriageStep to
  // capture the FINAL questionsAsked log (runTriage's questionsAsked is only
  // populated on the completing call, which is exactly this one).
  const finalStep = nextTriageStep(pathway, answers, questionLog);
  const finalQuestionsAsked = finalStep.done ? finalStep.questionsAsked : questionLog;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", error: "Not signed in" };

  const subjectId = await resolveSubjectId(user.id);
  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", subjectId)
    .single();
  if (!profile?.organisation_id) {
    return { status: "error", error: "No organisation on file" };
  }

  const service = createServiceRoleClient();
  const { data: inserted, error: insertError } = await service
    .from("symptom_triage_assessments")
    .insert({
      organisation_id: profile.organisation_id,
      patient_id: subjectId,
      logged_by_profile_id: user.id === subjectId ? null : user.id,
      presenting_complaint_key: capture.presentingComplaintKey,
      protocol_version: protocolVersion,
      initial_capture: capture as unknown as Json,
      questions_asked: finalQuestionsAsked as unknown as Json,
      red_flag_screen: result.redFlagScreen as unknown as Json,
      category: result.category,
      clinician_review_required: result.clinicianReviewRequired,
      safety_net_message_key: result.safetyNetMessageKey,
      rationale: result.rationale,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return { status: "error", error: insertError?.message ?? "Could not record the assessment" };
  }

  return {
    status: "complete",
    category: result.category,
    clinicianReviewRequired: result.clinicianReviewRequired,
    safetyNetMessageKey: result.safetyNetMessageKey,
    assessmentId: inserted.id,
  };
}
