"use server";

import { createClient } from "@/lib/supabase/server";
import { resolveSubjectId } from "@/lib/acting/acting-for";
import {
  breastSymptomReportSchema,
  menopauseSymptomLogSchema,
  fertilityAssessmentRequestSchema,
  postnatalProfileSchema,
  postnatalCheckinSchema,
  pregnancyDangerReportSchema,
  pregnancyDangerSignsSummary,
  type PregnancyDangerSign,
} from "@/lib/validation/womens-health";

export type WomensHealthActionState = { error?: string; success?: boolean } | undefined;

async function currentSubjectOrg(): Promise<
  { supabase: Awaited<ReturnType<typeof createClient>>; subjectId: string; organisationId: string } | { error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const subjectId = await resolveSubjectId(user.id);
  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", subjectId)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };
  return { supabase, subjectId, organisationId: profile.organisation_id };
}

// --- Menstrual cycle log (§44.3/44.4) ---------------------------------------
//
// Superseded by the dedicated cycle tracker (menstrual_cycles /
// menstrual_daily_logs, lib/queries/menstrual-cycle.ts, /patient/cycle) —
// see the reconciliation note in the menstrual_cycle_tracking migration.
// This file no longer owns any menstrual-cycle write path.

// --- Contraception (§44.5) --------------------------------------------------

export async function saveContraceptionMethod(
  _prev: WomensHealthActionState,
  formData: FormData
): Promise<WomensHealthActionState> {
  const method = (formData.get("current_contraception_method") as string | null)?.trim() || null;

  const ctx = await currentSubjectOrg();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase.from("reproductive_health_profiles").upsert(
    {
      patient_id: ctx.subjectId,
      organisation_id: ctx.organisationId,
      current_contraception_method: method,
    },
    { onConflict: "patient_id" }
  );
  if (error) return { error: error.message };
  return { success: true };
}

// --- Pregnancy / antenatal (§44.6/44.7) -------------------------------------

export async function setLastMenstrualPeriod(
  _prev: WomensHealthActionState,
  formData: FormData
): Promise<WomensHealthActionState> {
  const lmpRaw = (formData.get("last_menstrual_period_date") as string | null) ?? null;
  const lmp = lmpRaw && !Number.isNaN(Date.parse(lmpRaw)) ? lmpRaw : null;
  if (!lmp) return { error: "Enter a valid date" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", user.id).single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

  const { error } = await supabase.from("patient_pregnancy").upsert(
    {
      patient_id: user.id,
      organisation_id: profile.organisation_id,
      is_pregnant: true,
      last_menstrual_period_date: lmp,
    },
    { onConflict: "patient_id" }
  );
  if (error) return { error: error.message };
  return { success: true };
}

/**
 * Pregnancy red-flag safety pathway (§44.8) — dedicated pregnancy-specific
 * report, kept separate from reportDangerSymptoms (validation/emergency.ts)
 * so the general one-touch emergency pathway is never touched by this
 * addition. Inserts into the same emergency_events table with source
 * 'pregnancy_symptom_checklist' -- the existing handle_emergency_event
 * trigger raises the Priority-1 clinician_alerts row exactly as it does for
 * every other emergency source, and the same acknowledge-gated
 * "go to the nearest hospital now" guidance (EmergencyAlert) picks it up.
 */
export async function reportPregnancyDangerSymptoms(
  _prev: WomensHealthActionState,
  formData: FormData
): Promise<WomensHealthActionState> {
  const parsed = pregnancyDangerReportSchema.safeParse({ signs: formData.getAll("signs") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Select at least one sign" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", user.id).single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

  const { error } = await supabase.from("emergency_events").insert({
    patient_id: user.id,
    organisation_id: profile.organisation_id,
    source: "pregnancy_symptom_checklist",
    trigger_detail: pregnancyDangerSignsSummary(parsed.data.signs as PregnancyDangerSign[]),
    status: "active",
  });
  if (error) return { error: error.message };
  return { success: true };
}

// --- Breast health (§44.11) -------------------------------------------------

export async function reportBreastSymptoms(
  _prev: WomensHealthActionState,
  formData: FormData
): Promise<WomensHealthActionState> {
  const parsed = breastSymptomReportSchema.safeParse({
    symptom_types: formData.getAll("symptom_types"),
    laterality: formData.get("laterality") || undefined,
    duration_note: formData.get("duration_note") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Select at least one symptom" };

  const ctx = await currentSubjectOrg();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase.from("breast_symptom_reports").insert({
    patient_id: ctx.subjectId,
    organisation_id: ctx.organisationId,
    symptom_types: parsed.data.symptom_types,
    laterality: parsed.data.laterality,
    duration_note: parsed.data.duration_note,
    notes: parsed.data.notes,
  });
  if (error) return { error: error.message };
  return { success: true };
}

// --- Menopause (§44.12) -----------------------------------------------------

export async function logMenopauseSymptoms(
  _prev: WomensHealthActionState,
  formData: FormData
): Promise<WomensHealthActionState> {
  const parsed = menopauseSymptomLogSchema.safeParse({
    symptom_types: formData.getAll("symptom_types"),
    severity: formData.get("severity") || undefined,
    postmenopausal_bleeding: formData.get("postmenopausal_bleeding") === "true",
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  if (parsed.data.symptom_types.length === 0 && !parsed.data.postmenopausal_bleeding) {
    return { error: "Select at least one symptom, or report bleeding" };
  }

  const ctx = await currentSubjectOrg();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase.from("menopause_symptom_logs").insert({
    patient_id: ctx.subjectId,
    organisation_id: ctx.organisationId,
    symptom_types: parsed.data.symptom_types,
    severity: parsed.data.severity,
    postmenopausal_bleeding: parsed.data.postmenopausal_bleeding,
    notes: parsed.data.notes,
  });
  if (error) return { error: error.message };
  return { success: true };
}

// --- Fertility (§44.13) -----------------------------------------------------

export async function requestFertilityAssessment(
  _prev: WomensHealthActionState,
  formData: FormData
): Promise<WomensHealthActionState> {
  const parsed = fertilityAssessmentRequestSchema.safeParse({
    trying_duration_months: formData.get("trying_duration_months") || undefined,
    concern_notes: formData.get("concern_notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const ctx = await currentSubjectOrg();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase.from("fertility_assessment_requests").insert({
    patient_id: ctx.subjectId,
    organisation_id: ctx.organisationId,
    trying_duration_months: parsed.data.trying_duration_months,
    concern_notes: parsed.data.concern_notes,
  });
  if (error) return { error: error.message };
  return { success: true };
}

// --- Postnatal (§44.9) -------------------------------------------------------

/**
 * "I delivered" transition: flips patient_pregnancy.is_pregnant off and
 * opens the postnatal record. patient_pregnancy is a current-status snapshot
 * (unique per patient) — the delivery itself becomes its own
 * postnatal_profiles row so the patient's postnatal history survives across
 * however many pregnancies they log over time.
 */
export async function recordDelivery(
  _prev: WomensHealthActionState,
  formData: FormData
): Promise<WomensHealthActionState> {
  const parsed = postnatalProfileSchema.safeParse({
    delivery_date: formData.get("delivery_date"),
    delivery_mode: formData.get("delivery_mode") || undefined,
    complications: formData.get("complications") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", user.id).single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

  const { error: pregnancyError } = await supabase.from("patient_pregnancy").upsert(
    { patient_id: user.id, organisation_id: profile.organisation_id, is_pregnant: false },
    { onConflict: "patient_id" }
  );
  if (pregnancyError) return { error: pregnancyError.message };

  const { error } = await supabase.from("postnatal_profiles").insert({
    patient_id: user.id,
    organisation_id: profile.organisation_id,
    delivery_date: parsed.data.delivery_date,
    delivery_mode: parsed.data.delivery_mode,
    complications: parsed.data.complications,
  });
  if (error) return { error: error.message };
  return { success: true };
}

export async function logPostnatalCheckin(
  postnatalProfileId: string,
  _prev: WomensHealthActionState,
  formData: FormData
): Promise<WomensHealthActionState> {
  const parsed = postnatalCheckinSchema.safeParse({
    checkin_window: formData.get("checkin_window"),
    breastfeeding_status: formData.get("breastfeeding_status") || undefined,
    maternal_recovery_notes: formData.get("maternal_recovery_notes") || undefined,
    contraception_discussed: formData.get("contraception_discussed") === "true",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", user.id).single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

  const { error } = await supabase.from("postnatal_checkins").insert({
    patient_id: user.id,
    organisation_id: profile.organisation_id,
    postnatal_profile_id: postnatalProfileId,
    checkin_window: parsed.data.checkin_window,
    breastfeeding_status: parsed.data.breastfeeding_status,
    maternal_recovery_notes: parsed.data.maternal_recovery_notes,
    contraception_discussed: parsed.data.contraception_discussed,
    completed_at: new Date().toISOString(),
  });
  if (error) return { error: error.message };
  return { success: true };
}
