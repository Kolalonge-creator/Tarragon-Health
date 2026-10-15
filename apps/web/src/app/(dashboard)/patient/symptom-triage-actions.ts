"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveSubjectId } from "@/lib/acting/acting-for";
import { getActivePathway, getActiveTriageProtocolConfig, isSymptomCheckerOpen } from "@/lib/symptom-triage/protocol";
import { runSymptomCheck } from "@/lib/symptom-triage/safe-run";
import * as Sentry from "@sentry/nextjs";
import { runBestEffort } from "@/lib/sentry/run-best-effort";
import { symptomTriageStepSchema, type SymptomTriageStepInput } from "@/lib/validation/symptom-triage";
import { nextTriageStep } from "@tarragon/symptom-triage-engine";
import type { PresentingComplaintProtocol, QuestionNode } from "@tarragon/symptom-triage-engine";
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
 *
 * S60 (spec 12.8, INV-01, INV-06): FAIL TOWARD ESCALATION. The result is decided by `runSymptomCheck`, which runs the bundled
 * red-flag floor first and treats an engine error, a timeout or a missing protocol as "needs prompt attention", never as "all
 * clear". Recording the check is a separate step that may fail without taking the patient's answer away: if the row cannot be
 * written the patient still sees the result, the failure is reported, and for an emergency the same emergency_events row the
 * trigger would have raised is written directly (the one deliberate exception to "this file never writes to those tables",
 * used only when the trigger path itself is what failed).
 */

export type PresentingComplaintOption = { key: string; label: string };

/** For the complaint-picker step — only pathways in the currently SIGNED config. */
export async function listAvailablePresentingComplaints(): Promise<PresentingComplaintOption[]> {
  if (!(await isSymptomCheckerOpen())) return [];
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
      /** Null when the check could not be recorded (the patient still has the result). */
      assessmentId: string | null;
      /** True when the engine could not answer and the result is the fail-toward-escalation one. */
      degraded: boolean;
      /** False when the check could not be saved; the screen says so. */
      recorded: boolean;
    };

type Subject = { userId: string; subjectId: string; organisationId: string; state: string | null };
/** The person is known but their profile row could not be read: the check cannot be recorded, an emergency can still be raised. */
type KnownPerson = { userId: string; subjectId: string };

async function resolveSubject(): Promise<{ subject: Subject | null; person: KnownPerson | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { subject: null, person: null };
  // Not guarded on purpose: if who is being acted for cannot be resolved, guessing could raise an emergency for the wrong person.
  const subjectId = await resolveSubjectId(user.id);
  const person: KnownPerson = { userId: user.id, subjectId };
  let profile: { organisation_id: string | null; state: string | null } | null = null;
  try {
    profile = (await supabase.from("profiles").select("organisation_id, state").eq("id", subjectId).single()).data;
  } catch {
    profile = null; // the person is still known: an emergency can be raised without it
  }
  if (!profile?.organisation_id) return { subject: null, person };
  return { subject: { userId: user.id, subjectId, organisationId: profile.organisation_id, state: profile.state ?? null }, person };
}

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

  // F1 (INV-14): closed means closed, whatever the client sent. The database refuses the insert as well.
  // The fail-safe below never reaches around this: a closed checker answers nothing and records nothing.
  if (!(await isSymptomCheckerOpen())) return { status: "unavailable" };

  // Who the check is for. If this cannot be read the patient STILL gets their answer (it is worked out from what they ticked,
  // not from their profile); it just cannot be recorded, and an emergency is still raised if the person is known. Fail toward
  // escalation: never an error instead of an emergency.
  let who: { subject: Subject | null; person: KnownPerson | null } = { subject: null, person: null };
  try {
    who = await resolveSubject();
  } catch {
    who = { subject: null, person: null };
  }
  const subject = who.subject;

  // The protocol may be unreadable (a database error): that is a degraded run, not a reason to say nothing.
  let active: { pathway: PresentingComplaintProtocol; protocolVersion: number } | null = null;
  try {
    active = await getActivePathway(capture.presentingComplaintKey);
  } catch {
    active = null;
  }

  const result = await runSymptomCheck({ pathway: active?.pathway ?? null, capture, answers, questionLog, state: subject?.state ?? null });

  if (result.nextQuestion) {
    return {
      status: "in_progress",
      question: result.nextQuestion,
      state: { capture, answers, questionLog: result.questionsAsked },
    };
  }

  // Done. Re-run the walk once more via nextTriageStep to capture the FINAL questionsAsked log (only on a healthy run).
  let finalQuestionsAsked = questionLog;
  if (active && !result.degraded) {
    try {
      const finalStep = nextTriageStep(active.pathway, answers, questionLog);
      finalQuestionsAsked = finalStep.done ? finalStep.questionsAsked : questionLog;
    } catch {
      finalQuestionsAsked = questionLog;
    }
  }

  // The protocol version is a required, signed reference on the row. When the protocol itself could not be read, try the
  // active config once more for its version only; with none, the check cannot be recorded but the answer is still given.
  let protocolVersion = active?.protocolVersion ?? null;
  if (protocolVersion === null) {
    try {
      protocolVersion = (await getActiveTriageProtocolConfig())?.protocolVersion ?? null;
    } catch {
      protocolVersion = null;
    }
  }

  const complete = {
    status: "complete" as const,
    category: result.category,
    clinicianReviewRequired: result.clinicianReviewRequired,
    safetyNetMessageKey: result.safetyNetMessageKey,
    degraded: result.degraded,
  };

  if (subject === null) {
    await escalateUnrecorded(who.person, null, capture.presentingComplaintKey, result.category, "subject lookup failed");
    return { ...complete, assessmentId: null, recorded: false };
  }
  if (protocolVersion === null) {
    await escalateUnrecorded(subject, subject, capture.presentingComplaintKey, result.category, "no protocol version available");
    return { ...complete, assessmentId: null, recorded: false };
  }

  const service = createServiceRoleClient();
  const { data: inserted, error: insertError } = await service
    .from("symptom_triage_assessments")
    .insert({
      organisation_id: subject.organisationId,
      patient_id: subject.subjectId,
      logged_by_profile_id: subject.userId === subject.subjectId ? null : subject.userId,
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

  // 42501: the database closed the door (the guard, for the person being acted for). Same calm state as the screen.
  if (insertError?.code === "42501") return { status: "unavailable" };

  if (insertError || !inserted) {
    // The patient keeps their answer. The failure is loud (Sentry) and an emergency is still raised.
    await escalateUnrecorded(subject, subject, capture.presentingComplaintKey, result.category, insertError?.message ?? "no row returned");
    return { ...complete, assessmentId: null, recorded: false };
  }

  return { ...complete, assessmentId: inserted.id, recorded: true };
}

/**
 * The check could not be saved. Report it, and make sure a human is told: an emergency writes the emergency event the database
 * trigger would have written, and BOTH an emergency and an urgent result open a durable incident and a follow-up task through
 * `report_unrecorded_symptom_check` (neutral text, no model; INV-01, INV-06, INV-07). A failure to tell anyone is itself loud (Sentry),
 * never swallowed: an unrecorded urgent result must not depend on a log line alone.
 */
async function escalateUnrecorded(
  person: KnownPerson | null,
  subject: Subject | null,
  complaintKey: string,
  category: string,
  why: string,
): Promise<void> {
  Sentry.captureException(new Error(`symptom check could not be recorded (${category}): ${why}`), {
    extra: { complaintKey, category, subject: person?.subjectId ?? null },
  });
  if ((category !== "emergency" && category !== "urgent") || !person) return;
  if (category === "emergency") {
    await runBestEffort(
      async () => {
        const service = createServiceRoleClient();
        let organisationId = subject?.organisationId ?? null;
        if (!organisationId) {
          // the profile could not be read with the person's own session: try once more with the service role, for the one write that matters
          const { data } = await service.from("profiles").select("organisation_id").eq("id", person.subjectId).maybeSingle();
          organisationId = data?.organisation_id ?? null;
        }
        if (!organisationId) throw new Error("emergency event fallback: no organisation for the person");
        const { error } = await service.from("emergency_events").insert({
          organisation_id: organisationId,
          patient_id: person.subjectId,
          source: "symptom_triage",
          trigger_detail: `Symptom triage (${complaintKey}): emergency result that could not be recorded as an assessment (${why})`,
          status: "active",
          logged_by_profile_id: person.userId === person.subjectId ? null : person.userId,
        });
        if (error) throw new Error(`emergency event fallback failed: ${error.message}`);
      },
      { complaintKey, subject: person.subjectId },
    );
  }
  // The durable path for urgent (and a second net for emergency): an incident the on-call team sees, plus a follow-up task.
  await runBestEffort(
    async () => {
      const service = createServiceRoleClient();
      const { data, error } = await service.rpc("report_unrecorded_symptom_check", { p_patient: person.subjectId, p_category: category });
      if (error) throw new Error(`unrecorded symptom check report failed: ${error.message}`);
      const ok = (data as { ok?: boolean } | null)?.ok === true;
      if (!ok) throw new Error(`unrecorded symptom check was not reported: ${JSON.stringify(data)}`);
    },
    { complaintKey, subject: person.subjectId, category },
  );
}

// ---------------------------------------------------------------------------
// Doctor review of a check (spec 12.10)
// ---------------------------------------------------------------------------

export type ReviewTime = { stated: false } | { stated: true; minutes: number };

/** The review time to promise, read from the ACTIVE signed escalation SLA. Never a number from here. */
export async function getSymptomReviewTime(): Promise<ReviewTime> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("symptom_review_stated_time");
  const row = (data ?? null) as { stated?: boolean; minutes?: number } | null;
  if (error || !row || row.stated !== true || typeof row.minutes !== "number") return { stated: false };
  return { stated: true, minutes: row.minutes };
}

export type RequestReviewResult =
  | { status: "requested"; stated: ReviewTime }
  | { status: "unavailable" }
  | { status: "error" };

/** Ask the care team to look at a check. The database refuses it (42501) while the checker is closed or the check is not theirs. */
export async function requestSymptomReview(assessmentId: string): Promise<RequestReviewResult> {
  if (typeof assessmentId !== "string" || !/^[0-9a-f-]{36}$/i.test(assessmentId)) return { status: "error" };
  if (!(await isSymptomCheckerOpen())) return { status: "unavailable" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_symptom_review", { p_assessment: assessmentId });
  if (error?.code === "42501") return { status: "unavailable" };
  if (error || !data) return { status: "error" };
  const stated = (data as { stated_minutes?: number | null }).stated_minutes;
  return { status: "requested", stated: typeof stated === "number" ? { stated: true, minutes: stated } : { stated: false } };
}

export type MyReviewState = { status: "none" } | { status: "requested"; dueAt: string | null } | { status: "completed"; message: string | null };

/** What the patient may see of a review of their own check: its state and the clinician's plain message. Nothing else. */
export async function getMySymptomReview(assessmentId: string): Promise<MyReviewState> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("symptom_reviews")
    .select("status, due_at, patient_message")
    .eq("assessment_id", assessmentId)
    .maybeSingle();
  if (!data) return { status: "none" };
  if (data.status === "completed") return { status: "completed", message: data.patient_message };
  return { status: "requested", dueAt: data.due_at };
}
