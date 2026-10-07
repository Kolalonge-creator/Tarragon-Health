"use server";

import { createClient } from "@/lib/supabase/server";
import { resolveSubjectId } from "@/lib/acting/acting-for";
import { getActiveTriageProtocolConfig, isSymptomCheckerOpen } from "@/lib/symptom-triage/protocol";
import { runSymptomStep, readEligibility, type CheckerBlockReason, type SymptomTriageStepResult } from "@/lib/symptom-triage/run-step";
import { SEED_PATHWAYS } from "@tarragon/symptom-triage-engine";
import type { SymptomTriageStepInput } from "@/lib/validation/symptom-triage";

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

export type PresentingComplaintOption = { key: string; label: string; /** The signed pathway is exactly the bundled copy, so the question walk may run on the device. */ bundledCurrent: boolean };

/** For the complaint-picker step — only pathways in the currently SIGNED config. */
export async function listAvailablePresentingComplaints(): Promise<PresentingComplaintOption[]> {
  if (!(await isSymptomCheckerOpen())) return [];
  const active = await getActiveTriageProtocolConfig();
  if (!active) return [];
  return active.config.pathways.map((p) => ({
    key: p.key,
    label: p.label,
    bundledCurrent: JSON.stringify(SEED_PATHWAYS.find((s) => s.key === p.key) ?? null) === JSON.stringify(p),
  }));
}

export type { SymptomTriageStepResult, CheckerBlockReason } from "@/lib/symptom-triage/run-step";

/**
 * Advance the wizard by one step. `input` is the FULL rolling state (capture + answers so far + the question log). Called directly
 * from the client component (not a <form action>). The work is in lib/symptom-triage/run-step.ts, shared with the mobile route.
 */
export async function stepSymptomTriage(input: SymptomTriageStepInput): Promise<SymptomTriageStepResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return runSymptomStep(input, { supabase, userId: user?.id ?? null, resolveSubjectId });
}

/** Whether the checker can be used for the person it would be for: ok, or why not. The screen shows a calm state for anything else. */
export async function getSymptomCheckerEligibility(): Promise<"ok" | CheckerBlockReason | "error"> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "error";
  const subjectId = await resolveSubjectId(user.id);
  return readEligibility(supabase, subjectId);
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
  | { status: "members_only" }
  | { status: "error" };

/** Ask the care team to look at a check. The database refuses it (42501) while the checker is closed or the check is not theirs. */
export async function requestSymptomReview(assessmentId: string): Promise<RequestReviewResult> {
  if (typeof assessmentId !== "string" || !/^[0-9a-f-]{36}$/i.test(assessmentId)) return { status: "error" };
  if (!(await isSymptomCheckerOpen())) return { status: "unavailable" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_symptom_review", { p_assessment: assessmentId });
  if (error?.code === "42501") return { status: "unavailable" };
  // TM001: the person the check is for is not a Member (a clinician's look at a check is a Membership benefit)
  if (error?.code === "TM001") return { status: "members_only" };
  if (error || !data) return { status: "error" };
  const stated = (data as { stated_minutes?: number | null }).stated_minutes;
  return { status: "requested", stated: typeof stated === "number" ? { stated: true, minutes: stated } : { stated: false } };
}

/** Whether the person a check is for is a Member, so the screen offers the clinician-review request or says it is part of Membership. */
export async function getSymptomReviewEntitled(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const subjectId = await resolveSubjectId(user.id);
  const { data, error } = await supabase.rpc("symptom_review_entitled", { p_subject: subjectId });
  return !error && data === true;
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
