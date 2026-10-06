"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import type { Json } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { suggestTitration } from "@/lib/care-changes/suggest-titration";
import { parseSafetyError, type SafetyError } from "@/lib/prescriptions/parse-safety-error";
import { parseStaffCareChanges, staffIdsIn, type StaffCareChange } from "./change-model";
import {
  buildMedicineProposal,
  buildScheduleProposal,
  buildTargetProposal,
  patientIdSchema,
  proposeMedicineChangeSchema,
  proposeScheduleChangeSchema,
  proposeTargetChangeSchema,
  rejectChangeSchema,
  signChangeSchema,
  type ProposeMedicineChangeInput,
  type ProposeScheduleChangeInput,
  type ProposeTargetChangeInput,
  type RejectChangeInput,
  type SignChangeInput,
} from "./schemas";

/**
 * S24: server actions for the "Care plan changes" panel on the clinician chart. Each one validates its input with Zod, runs the matching
 * database function under the signed-in clinician's own session (nothing here uses a service role), and turns a refusal into a sentence a
 * clinician can read. The functions are the gate: tied prescriber only, the signature stamped from the session, the safety checks, the
 * legal state moves. Nothing here can change what a patient takes: a signed change only applies when the patient confirms it.
 */

export type CareChangeActionResult = { ok: true; id?: string } | { ok: false; error: string; safety?: SafetyError };

export type CareChangeListResult = { ok: true; changes: StaffCareChange[] } | { ok: false; error: string };

export type SuggestNextStepResult =
  | { ok: true; kind: "proposed"; changeId: string }
  | { ok: true; kind: "no_proposal"; reasons: { code: string; detail?: string }[] }
  | { ok: true; kind: "no_protocol" }
  | { ok: false; error: string };

const NOT_SIGNED_IN = "You are not signed in. Sign in again and retry.";
const GENERIC = "Something went wrong and nothing was changed. Try again, and tell the care team lead if it keeps happening.";
const NOT_ALLOWED = "You are not allowed to do this for this patient. Only a prescriber tied to this patient can propose or sign a change.";

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the details and try again.";
}

/** Database refusals the panel can show as written; everything else gets a generic line (no codes, no internals). */
function readableError(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return GENERIC;
  if (error.code === "42501") return NOT_ALLOWED;
  // 22023 (invalid parameter) and P0001 (a rule the function states) carry messages written for the signer.
  if ((error.code === "22023" || error.code === "P0001" || error.code === "23514") && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return GENERIC;
}

function refresh(patientId: string) {
  revalidatePath(`/clinician/patients/${patientId}`);
}

async function signedInClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? supabase : null;
}

/** Every change for this patient, newest first, through the audited read (INV-10). */
export async function listCareChanges(input: { patientId: string }): Promise<CareChangeListResult> {
  const parsed = patientIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const supabase = await signedInClient();
  if (!supabase) return { ok: false, error: NOT_SIGNED_IN };
  const { data, error } = await supabase.rpc("list_care_plan_changes", {
    p_patient: parsed.data.patientId,
    p_reason: "Clinician opened care plan changes on the patient chart",
  });
  if (error) return { ok: false, error: readableError(error) };
  // Names are a convenience: if the directory cannot be read, the panel simply does not print a name (it never prints an id).
  const names: Record<string, string> = {};
  const ids = staffIdsIn(data);
  if (ids.length > 0) {
    const { data: staff } = await supabase.from("clinical_staff_directory").select("profile_id, full_name").in("profile_id", ids);
    for (const row of staff ?? []) {
      if (row.profile_id && row.full_name) names[row.profile_id] = row.full_name;
    }
  }
  return { ok: true, changes: parseStaffCareChanges(data, names) };
}

/** Runs the titration evaluator under this clinician's session. A proposal is a draft: nothing reaches the patient until it is signed. */
export async function suggestNextStep(input: { patientId: string }): Promise<SuggestNextStepResult> {
  const parsed = patientIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const supabase = await signedInClient();
  if (!supabase) return { ok: false, error: NOT_SIGNED_IN };
  try {
    const outcome = await suggestTitration(parsed.data.patientId);
    if (outcome.kind === "proposed") {
      refresh(parsed.data.patientId);
      return { ok: true, kind: "proposed", changeId: outcome.changeId };
    }
    if (outcome.kind === "no_proposal") return { ok: true, kind: "no_proposal", reasons: outcome.reasons };
    if (outcome.kind === "no_protocol") return { ok: true, kind: "no_protocol" };
    return { ok: false, error: outcome.message?.trim() ? outcome.message : GENERIC };
  } catch {
    return { ok: false, error: GENERIC };
  }
}

async function propose(
  patientId: string,
  kind: "medication" | "target" | "reading_schedule",
  proposal: Record<string, unknown>,
  rationale: string,
  carePlanId?: string
): Promise<CareChangeActionResult> {
  const supabase = await signedInClient();
  if (!supabase) return { ok: false, error: NOT_SIGNED_IN };
  const { data, error } = await supabase.rpc("propose_care_plan_change", {
    p_patient: patientId,
    p_kind: kind,
    p_proposal: proposal as Json,
    p_rationale: rationale,
    p_care_plan_id: carePlanId,
    p_proposed_by: "clinician",
  });
  if (error) return { ok: false, error: readableError(error) };
  refresh(patientId);
  return { ok: true, id: typeof data === "string" ? data : undefined };
}

export async function proposeMedicineChange(input: ProposeMedicineChangeInput): Promise<CareChangeActionResult> {
  const parsed = proposeMedicineChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  return propose(parsed.data.patientId, "medication", buildMedicineProposal(parsed.data), parsed.data.rationale);
}

export async function proposeTargetChange(input: ProposeTargetChangeInput): Promise<CareChangeActionResult> {
  const parsed = proposeTargetChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  return propose(parsed.data.patientId, "target", buildTargetProposal(parsed.data), parsed.data.rationale, parsed.data.carePlanId);
}

export async function proposeScheduleChange(input: ProposeScheduleChangeInput): Promise<CareChangeActionResult> {
  const parsed = proposeScheduleChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  return propose(parsed.data.patientId, "reading_schedule", buildScheduleProposal(parsed.data), parsed.data.rationale, parsed.data.carePlanId);
}

/**
 * Signs a proposed change. The summary is what the patient will read, typed by the signer. A safety stop comes back as `safety` so the
 * panel can ask for the allergy-list confirmation and a reason, then send this again; a controlled medicine comes back as `blocked`.
 */
export async function signCareChange(input: SignChangeInput): Promise<CareChangeActionResult> {
  const parsed = signChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const supabase = await signedInClient();
  if (!supabase) return { ok: false, error: NOT_SIGNED_IN };
  const { error } = await supabase.rpc("sign_care_plan_change", {
    p_change: parsed.data.changeId,
    p_patient_summary: parsed.data.patientSummary,
    p_allergies_confirmed: parsed.data.allergiesConfirmed,
    p_safety_override_reason: parsed.data.overrideReason,
  });
  if (error) {
    const safety = parseSafetyError(error);
    if (safety) return { ok: false, error: safety.kind === "blocked" ? "TarragonHealth does not prescribe controlled medicines." : "A safety check needs your attention before this can be signed.", safety };
    return { ok: false, error: readableError(error) };
  }
  refresh(parsed.data.patientId);
  return { ok: true, id: parsed.data.changeId };
}

export async function rejectCareChange(input: RejectChangeInput): Promise<CareChangeActionResult> {
  const parsed = rejectChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const supabase = await signedInClient();
  if (!supabase) return { ok: false, error: NOT_SIGNED_IN };
  const { error } = await supabase.rpc("reject_care_plan_change", { p_change: parsed.data.changeId, p_reason: parsed.data.reason });
  if (error) return { ok: false, error: readableError(error) };
  refresh(parsed.data.patientId);
  return { ok: true, id: parsed.data.changeId };
}
