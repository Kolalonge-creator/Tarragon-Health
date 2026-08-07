"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Json, Tables } from "@tarragon/shared";
import { loadCaseFacts } from "./facts";
import { proposeActions, PROPOSAL_ENGINE_VERSION, type ProposedPayload } from "./propose";

export interface ActionResult {
  success: boolean;
  /** Shown to the doctor verbatim. Written for a clinician, not a log. */
  message?: string;
}

/**
 * Regenerates the proposal set for a case.
 *
 * Idempotent by construction: any still-'proposed' row is superseded first,
 * then the current engine output is inserted. A doctor therefore never sees a
 * stale suggestion left over from before they logged a reading, and never sees
 * the same suggestion twice (case_review_actions_one_live_per_type enforces
 * that at the schema level, not just here).
 *
 * Reads run on the CALLER'S session so RLS decides what they may see; only the
 * insert uses the service role, because case_review_actions deliberately has
 * no INSERT policy -- proposals come from the engine, never from a session.
 */
export async function proposeCaseActionsAction(clinicianAlertId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "Not signed in." };

  const loaded = await loadCaseFacts(supabase, clinicianAlertId);
  if (!loaded) return { success: false, message: "This case is not available to you." };

  const proposals = proposeActions(loaded.facts);
  const service = createServiceRoleClient();

  // Supersede before inserting, so the partial unique index can never be
  // violated by a re-run and a doctor never works from a stale set.
  const { error: supersedeError } = await service
    .from("case_review_actions")
    .update({ status: "superseded" })
    .eq("clinician_alert_id", clinicianAlertId)
    .eq("status", "proposed");

  if (supersedeError) {
    console.error("case-cockpit: could not supersede stale proposals", supersedeError);
    return { success: false, message: "Could not refresh suggested actions." };
  }

  if (proposals.length === 0) return { success: true };

  const { error: insertError } = await service.from("case_review_actions").insert(
    proposals.map((proposal) => ({
      organisation_id: loaded.organisationId,
      clinician_alert_id: clinicianAlertId,
      patient_id: loaded.patientId,
      action_type: proposal.actionType,
      proposed_payload: proposal.payload as unknown as Json,
      protocol_version_id: proposal.protocolVersionId,
      rationale: proposal.rationale,
      required_authority: proposal.requiredAuthority,
      engine_version: PROPOSAL_ENGINE_VERSION,
    }))
  );

  if (insertError) {
    console.error("case-cockpit: could not insert proposals", insertError);
    return { success: false, message: "Could not refresh suggested actions." };
  }

  return { success: true };
}

/**
 * Confirms a proposed action: performs the real platform write, then records
 * the attribution.
 *
 * ORDER MATTERS, AND THIS ORDER IS DELIBERATE. The write happens FIRST and the
 * action is marked confirmed only once it succeeded. The two failure modes are
 * not symmetric:
 *
 *   * Mark-then-write, if the write fails, leaves a signed, attributed record
 *     saying a doctor did something that never happened. That is a false
 *     clinical record -- the worst outcome available here.
 *   * Write-then-mark, if the mark fails, leaves a real write that IS already
 *     attributed by its own table (escalation_notes.author_id,
 *     escalations.reviewed_by, medications.last_confirmed_by, lab_orders
 *     .ordered_by) while the cockpit's proposal row stays 'proposed'. The
 *     patient record is correct and attributed; only the suggestion is stale,
 *     and the doctor is told so.
 *
 * So the residual risk is a doctor re-confirming and double-writing, which is
 * why the non-idempotent action (ordering an investigation) checks for an
 * existing open order first, and why the failure message says plainly that the
 * change may already have been saved rather than inviting a blind retry.
 *
 * Every write runs on the CALLER'S session. Their own RLS policies and tier
 * triggers are the real gate -- required_authority on the proposal is a
 * friendly early refusal, never the enforcement boundary.
 */
export async function confirmCaseActionAction(
  actionId: string,
  /** Present when the doctor edited the proposal — recorded as 'modified'. */
  modifiedPayload?: ProposedPayload
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "Not signed in." };

  const { data: action } = await supabase
    .from("case_review_actions")
    .select("*")
    .eq("id", actionId)
    .maybeSingle();

  if (!action) return { success: false, message: "This action is not available to you." };
  if (action.status !== "proposed") {
    return {
      success: false,
      message: `This action was already ${action.status}. Refresh to see the current suggestions.`,
    };
  }

  const payload = (modifiedPayload ??
    (action.proposed_payload as unknown as ProposedPayload)) as ProposedPayload;

  if (payload.kind !== actionKindFor(action.action_type)) {
    return { success: false, message: "That change does not match the suggested action." };
  }

  const written = await performWrite(supabase, action, payload);
  if (!written.success) return written;

  const { error: markError } = await supabase
    .from("case_review_actions")
    .update({
      status: modifiedPayload ? "modified" : "confirmed",
      // Only sent for 'modified'. For 'confirmed' the trigger copies the
      // original proposal over whatever the client sends, so a client cannot
      // claim verbatim acceptance while substituting a different payload.
      confirmed_payload: modifiedPayload ? (modifiedPayload as unknown as Json) : null,
      result_table: written.resultTable ?? null,
      result_id: written.resultId ?? null,
    })
    .eq("id", actionId)
    .eq("status", "proposed");

  if (markError) {
    console.error("case-cockpit: write succeeded but attribution failed", markError);
    return {
      success: false,
      message:
        "The change was saved to the patient's record, but this suggestion could not be marked done. Refresh before trying again so you do not repeat it.",
    };
  }

  return { success: true };
}

/** Records a doctor's rejection of a proposal, with their reason. Never deletes it. */
export async function dismissCaseActionAction(
  actionId: string,
  reason: string
): Promise<ActionResult> {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return { success: false, message: "Add a short reason so the record shows why." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("case_review_actions")
    .update({ status: "dismissed", dismissal_reason: trimmed })
    .eq("id", actionId)
    .eq("status", "proposed");

  if (error) {
    console.error("case-cockpit: dismiss failed", error);
    return { success: false, message: error.message };
  }
  return { success: true };
}

/**
 * The action_type -> payload.kind mapping, as an exhaustive switch. If a value
 * is added to case_review_action_type without a payload shape and a write to
 * go with it, this stops compiling -- which is the point. An action a doctor
 * can confirm that changes nothing would be worse than no action at all,
 * because it reads as done.
 */
function actionKindFor(
  actionType: Tables<"case_review_actions">["action_type"]
): ProposedPayload["kind"] {
  switch (actionType) {
    case "log_review_note":
      return "log_review_note";
    case "schedule_follow_up":
      return "schedule_follow_up";
    case "confirm_medication_refill":
      return "confirm_medication_refill";
    case "order_investigation":
      return "order_investigation";
    case "resolve_case":
      return "resolve_case";
  }
}

type WriteResult = ActionResult & { resultTable?: string; resultId?: string };

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function performWrite(
  supabase: Supabase,
  action: Tables<"case_review_actions">,
  payload: ProposedPayload
): Promise<WriteResult> {
  switch (payload.kind) {
    case "log_review_note":
    case "schedule_follow_up":
      return writeEscalationNote(supabase, action, payload);
    case "confirm_medication_refill":
      return writeRefillConfirmation(supabase, payload);
    case "order_investigation":
      return writeLabOrder(supabase, action, payload);
    case "resolve_case":
      return writeResolution(supabase, payload);
  }
}

/**
 * Notes and follow-ups share escalation_notes: a follow-up IS a note carrying
 * next_follow_up_at, which is the platform's existing follow-up primitive
 * (see useAddEscalationNote). Not a second scheduling mechanism.
 */
async function writeEscalationNote(
  supabase: Supabase,
  action: Tables<"case_review_actions">,
  payload: Extract<ProposedPayload, { kind: "log_review_note" | "schedule_follow_up" }>
): Promise<WriteResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "Not signed in." };

  const { data: escalation } = await supabase
    .from("escalations")
    .select("id")
    .eq("clinician_alert_id", action.clinician_alert_id)
    .maybeSingle();

  if (!escalation) {
    // escalation_notes hangs off an escalation. A case still on the clinician
    // worklist has none, so there is genuinely nowhere for this note to live --
    // said plainly rather than silently dropped.
    return {
      success: false,
      message:
        "This case has not been escalated to a doctor yet, so there is no case record to note against. Escalate it first.",
    };
  }

  const { data, error } = await supabase
    .from("escalation_notes")
    .insert({
      organisation_id: action.organisation_id,
      escalation_id: escalation.id,
      author_id: user.id,
      note: payload.note,
      next_follow_up_at:
        payload.kind === "schedule_follow_up" ? payload.nextFollowUpAt : null,
    })
    .select("id")
    .maybeSingle();

  if (error) return { success: false, message: error.message };
  return { success: true, resultTable: "escalation_notes", resultId: data?.id };
}

/**
 * Moves refill_date only. private.enforce_medication_confirm_only restricts
 * the write to that column whatever this sends, and derives last_confirmed_by
 * server-side -- so confirming can continue a prescription but can never
 * change drug, dose or frequency.
 */
async function writeRefillConfirmation(
  supabase: Supabase,
  payload: Extract<ProposedPayload, { kind: "confirm_medication_refill" }>
): Promise<WriteResult> {
  const { error } = await supabase
    .from("medications")
    .update({ refill_date: payload.refillDate })
    .eq("id", payload.medicationId);

  if (error) return { success: false, message: error.message };
  return { success: true, resultTable: "medications", resultId: payload.medicationId };
}

/**
 * Self-arranged clinician-originated order, identical in shape to
 * useOrderLabTest -- Tarragon does not book or bill the lab (see the
 * self-arranged-fulfilment change): the doctor decides what test is needed,
 * the patient takes the order to whichever lab suits them.
 *
 * The one non-idempotent write here, so it checks for an existing open order
 * first. See confirmCaseActionAction's ordering note for why that matters.
 */
async function writeLabOrder(
  supabase: Supabase,
  action: Tables<"case_review_actions">,
  payload: Extract<ProposedPayload, { kind: "order_investigation" }>
): Promise<WriteResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "Not signed in." };

  const { data: existing } = await supabase
    .from("lab_orders")
    .select("id")
    .eq("patient_id", action.patient_id)
    .eq("panel_bundle_id", payload.panelBundleId)
    .in("status", ["pending_payment", "payment_confirmed", "ordered", "sample_collected", "processing"])
    .maybeSingle();

  if (existing) {
    return {
      success: false,
      message: `${payload.panelName} is already on order for this patient.`,
    };
  }

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id")
    .eq("profile_id", user.id)
    .eq("organisation_id", action.organisation_id)
    .eq("active", true)
    .maybeSingle();

  if (!staff) {
    return {
      success: false,
      message: "Only an active clinical staff member of this organisation can order a test.",
    };
  }

  const { data, error } = await supabase
    .from("lab_orders")
    .insert({
      organisation_id: action.organisation_id,
      patient_id: action.patient_id,
      panel_bundle_id: payload.panelBundleId,
      screening_schedule_id: payload.screeningScheduleId,
      total_kobo: 0,
      status: "ordered",
      origin: "clinically_triggered",
      ordered_by: staff.id,
    })
    .select("id")
    .maybeSingle();

  if (error) return { success: false, message: error.message };
  return { success: true, resultTable: "lab_orders", resultId: data?.id };
}

/**
 * Closes the case. reviewed_by/reviewed_at are set here, once, to the
 * resolving doctor -- the same single write path useResolveEscalation uses,
 * which is what lets ReviewedByDoctor null-gate on them safely
 * (CLINICAL_TRUST_MODEL_SPEC §5, no retroactive attribution).
 *
 * The status guard means a case someone else already closed cannot be closed
 * twice with a second doctor's name on it.
 */
async function writeResolution(
  supabase: Supabase,
  payload: Extract<ProposedPayload, { kind: "resolve_case" }>
): Promise<WriteResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "Not signed in." };

  const { data, error } = await supabase
    .from("escalations")
    .update({
      status: "resolved",
      resolution_note: payload.resolutionNote,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", payload.escalationId)
    .in("status", ["open", "under_review"])
    .select("id")
    .maybeSingle();

  if (error) return { success: false, message: error.message };
  if (!data) {
    return {
      success: false,
      message: "This case is no longer open — someone may have resolved it already.",
    };
  }
  return { success: true, resultTable: "escalations", resultId: data.id };
}
