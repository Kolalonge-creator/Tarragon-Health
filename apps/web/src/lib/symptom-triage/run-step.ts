import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getActivePathway, getActiveTriageProtocolConfig, isSymptomCheckerOpen } from "@/lib/symptom-triage/protocol";
import { runSymptomCheck } from "@/lib/symptom-triage/safe-run";
import { parseCheckContext } from "@/lib/symptom-triage/context";
import { getProposedConfig } from "@tarragon/shared";
import * as Sentry from "@sentry/nextjs";
import { runBestEffort } from "@/lib/sentry/run-best-effort";
import { symptomTriageStepSchema, type SymptomTriageStepInput } from "@/lib/validation/symptom-triage";
import { bundledFloorDrift, nextTriageStep } from "@tarragon/symptom-triage-engine";
import type { PresentingComplaintProtocol, QuestionNode } from "@tarragon/symptom-triage-engine";
import type { Database, Json } from "@tarragon/shared";

/**
 * The one place a symptom check step is run (S59b: lifted out of the web server action so the bearer-authenticated mobile route
 * reuses exactly the same code, never a copy). The caller supplies a Supabase client that acts as the signed-in person (cookie
 * session on the web, bearer token on mobile); everything else, including the fail-toward-escalation behaviour (S60), is here.
 */
export type StepClient = SupabaseClient<Database>;
export type StepContext = {
  supabase: StepClient;
  /** The signed-in person, or null when there is no session. */
  userId: string | null;
  /** Who the check is for: the web resolves acting-for; the mobile route answers only for the person themselves. */
  resolveSubjectId: (userId: string) => Promise<string>;
};

export type CheckerBlockReason = "under_18" | "dob_required";

export type SymptomTriageStepResult =
  | { status: "unavailable" }
  | { status: "blocked"; reason: CheckerBlockReason }
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
      /** The six-level wording, only when a SIGNED urgency map exists; null means show the four-category result only. */
      urgencyLevel: string | null;
      /** The checker is for a child (answered by a parent or carer): the screen leaves out the consultation booking (adults only). */
      forDependant: boolean;
      /** False when the check could not be saved; the screen says so. */
      recorded: boolean;
    };

type Subject = { userId: string; subjectId: string; organisationId: string; state: string | null };
/** The person is known but their profile row could not be read: the check cannot be recorded, an emergency can still be raised. */
type KnownPerson = { userId: string; subjectId: string };

async function resolveSubject(ctx: StepContext): Promise<{ subject: Subject | null; person: KnownPerson | null }> {
  if (!ctx.userId) return { subject: null, person: null };
  // Not guarded on purpose: if who is being acted for cannot be resolved, guessing could raise an emergency for the wrong person.
  const subjectId = await ctx.resolveSubjectId(ctx.userId);
  const person: KnownPerson = { userId: ctx.userId, subjectId };
  let profile: { organisation_id: string | null; state: string | null } | null = null;
  try {
    profile = (await ctx.supabase.from("profiles").select("organisation_id, state").eq("id", subjectId).single()).data;
  } catch {
    profile = null; // the person is still known: an emergency can be raised without it
  }
  if (!profile?.organisation_id) return { subject: null, person };
  return { subject: { userId: ctx.userId, subjectId, organisationId: profile.organisation_id, state: profile.state ?? null }, person };
}

/**
 * Advance the wizard by one step. `input` is the FULL rolling state
 * (capture + answers so far + the question log) — see
 * lib/validation/symptom-triage.ts. Called directly from the client
 * component (not a <form action>), so it receives a real typed object, not
 * FormData; the schema below is defence-in-depth, not the parsing layer.
 */
export async function runSymptomStep(input: SymptomTriageStepInput, ctx: StepContext): Promise<SymptomTriageStepResult> {
  const parsed = symptomTriageStepSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { capture, answers, questionLog } = parsed.data;

  // F1 (INV-14): closed means closed, whatever the client sent. The database refuses the insert as well.
  // The fail-safe below never reaches around this: a closed checker answers nothing and records nothing.
  if (!(await isSymptomCheckerOpen(ctx.supabase))) return { status: "unavailable" };

  // Who the check is for. If this cannot be read the patient STILL gets their answer (it is worked out from what they ticked,
  // not from their profile); it just cannot be recorded, and an emergency is still raised if the person is known. Fail toward
  // escalation: never an error instead of an emergency.
  let who: { subject: Subject | null; person: KnownPerson | null } = { subject: null, person: null };
  try {
    who = await resolveSubject(ctx);
  } catch {
    who = { subject: null, person: null };
  }
  const subject = who.subject;

  // S59b (founder 2026-10-07): under 18 is refused until a paediatric protocol is signed, and no date of birth is refused too. Checked
  // in the database as well (trigger symptom_triage_assessments_01_age_gate). If the answer cannot be read the check does not run
  // (closed), because guessing an age is the one thing this rule exists to stop; the on-device red-flag floor is unaffected.
  if (who.person) {
    const eligibility = await readEligibility(ctx.supabase, who.person.subjectId);
    if (eligibility !== "ok") return eligibility === "error" ? { status: "unavailable" } : { status: "blocked", reason: eligibility };
  }

  // The protocol may be unreadable (a database error): that is a degraded run, not a reason to say nothing.
  let active: { pathway: PresentingComplaintProtocol; protocolVersion: number } | null = null;
  try {
    active = await getActivePathway(capture.presentingComplaintKey, ctx.supabase);
  } catch {
    active = null;
  }
  // The bundled on-device floor must equal the SIGNED protocol. If a signed pathway's red flags differ (for example the chest pain draft was
  // signed and the bundled copy was not updated) the phone's offline floor is looser than the signed rules: report it loudly, every time.
  if (active) {
    try {
      if (bundledFloorDrift([active.pathway]).length > 0) {
        Sentry.captureException(new Error(`bundled red-flag floor differs from the signed protocol for ${active.pathway.key}: update the bundled floor and db-seed-fixture.json`));
      }
    } catch {
      // the drift report must never take a patient's answer away
    }
  }

  // What the record says (age, pregnancy, conditions, medicines, readings): only ever tightens. If it cannot be read the check
  // still runs with nothing known, which can only mean fewer layers apply, never a lower result.
  let context = parseCheckContext(null);
  if (subject) {
    try {
      const windowDays = Number(getProposedConfig("symptom.context_window_days").value);
      const { data } = await ctx.supabase.rpc("symptom_check_context", { p_subject: subject.subjectId, p_window_days: windowDays });
      context = parseCheckContext(data);
    } catch (e) {
      Sentry.captureException(e, { extra: { where: "symptom_check_context" } });
    }
  }
  const result = await runSymptomCheck({ pathway: active?.pathway ?? null, capture, answers, questionLog, state: subject?.state ?? null, context });

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
      protocolVersion = (await getActiveTriageProtocolConfig(ctx.supabase))?.protocolVersion ?? null;
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
    urgencyLevel: result.urgencyLevel as string | null,
    forDependant: subject !== null && subject.userId !== subject.subjectId,
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
      engine: result.engine,
      engine_version: result.engineVersion,
      inputs_used: result.inputsPresent as unknown as Json,
      raised_by: result.raisedBy,
      urgency_level: result.urgencyLevel,
      urgency_map_version: result.urgencyMapVersion,
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


/** ok | under_18 | dob_required, or "error" when it could not be read (treated as closed). */
export async function readEligibility(supabase: StepClient, subjectId: string): Promise<"ok" | CheckerBlockReason | "error"> {
  try {
    const { data, error } = await supabase.rpc("symptom_checker_eligibility", { p_subject: subjectId });
    if (error) return "error";
    const status = (data as { status?: string } | null)?.status;
    return status === "ok" || status === "under_18" || status === "dob_required" ? status : "error";
  } catch {
    return "error";
  }
}
