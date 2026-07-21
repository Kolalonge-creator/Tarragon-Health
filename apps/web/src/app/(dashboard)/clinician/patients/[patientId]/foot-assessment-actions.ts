"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  footAssessmentSchema,
  footReviewIntervalMonths,
  complicationCheckSchema,
} from "@/lib/validation/foot-assessment";

export type FootAssessmentState = { error?: string; success?: boolean } | undefined;

/**
 * Records a clinician-performed diabetic foot-risk classification (§18.1).
 * assessed_by is server-derived from the caller's own clinical_staff row —
 * never trusted from the client — and gated on an active clinical_staff record
 * (a Care Coordinator cannot classify foot risk), the same app-layer clinical-
 * authority pattern as vaccination verification.
 */
export async function recordFootAssessment(
  _prev: FootAssessmentState,
  formData: FormData
): Promise<FootAssessmentState> {
  const parsed = footAssessmentSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id, organisation_id")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff) return { error: "Only a Tarragon care-team doctor can record a foot assessment" };

  // Patient's org (RLS-scoped read; staff share the org). Falls back to the
  // caller's own org if the patient row can't be read.
  const { data: patient } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", parsed.data.patient_id)
    .maybeSingle();
  const organisationId = patient?.organisation_id ?? staff.organisation_id;

  const months = footReviewIntervalMonths(parsed.data.risk_class);
  const nextDue = new Date();
  nextDue.setMonth(nextDue.getMonth() + months);

  const pulsesPresent =
    parsed.data.pulses === "yes" ? true : parsed.data.pulses === "no" ? false : null;

  const { error } = await supabase.from("diabetic_foot_assessments").insert({
    patient_id: parsed.data.patient_id,
    organisation_id: organisationId,
    assessed_by: staff.id,
    risk_class: parsed.data.risk_class,
    sensation_left: parsed.data.sensation_left ?? null,
    sensation_right: parsed.data.sensation_right ?? null,
    pulses_present: pulsesPresent,
    findings: parsed.data.findings ?? null,
    next_due_at: nextDue.toISOString().slice(0, 10),
  });
  if (error) return { error: error.message };

  revalidatePath(`/clinician/patients/${parsed.data.patient_id}`);
  return { success: true };
}

/**
 * Records a retinal (§18.2) or renal (§18.3) surveillance check. recorded_by is
 * server-derived from the caller's clinical_staff row; gated on an active
 * clinical_staff record. Sets the next-due date from the chosen interval.
 * Abnormal RESULTS still flow the existing abnormal-result handler — this just
 * records that the check happened and when the next one is due.
 */
export async function recordComplicationCheck(
  _prev: FootAssessmentState,
  formData: FormData
): Promise<FootAssessmentState> {
  const parsed = complicationCheckSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id, organisation_id")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff) return { error: "Only a Tarragon care-team doctor can record a complication check" };

  const { data: patient } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", parsed.data.patient_id)
    .maybeSingle();
  const organisationId = patient?.organisation_id ?? staff.organisation_id;

  const nextDue = new Date();
  nextDue.setMonth(nextDue.getMonth() + parsed.data.interval_months);

  const { error } = await supabase.from("diabetes_complication_checks").insert({
    patient_id: parsed.data.patient_id,
    organisation_id: organisationId,
    recorded_by: staff.id,
    check_type: parsed.data.check_type,
    outcome: parsed.data.outcome ?? null,
    abnormal: parsed.data.abnormal,
    next_due_at: nextDue.toISOString().slice(0, 10),
  });
  if (error) return { error: error.message };

  revalidatePath(`/clinician/patients/${parsed.data.patient_id}`);
  return { success: true };
}

/**
 * Sets (upserts) a patient's individualised glycaemic target (§9). set_by is
 * server-derived from the caller's clinical_staff row; gated on active
 * clinical_staff. One target per patient (unique) — re-setting updates it.
 */
export async function setGlucoseTarget(
  _prev: FootAssessmentState,
  formData: FormData
): Promise<FootAssessmentState> {
  const { glucoseTargetSchema } = await import("@/lib/validation/glucose-target");
  const parsed = glucoseTargetSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id, organisation_id")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff) return { error: "Only a Tarragon care-team doctor can set a glucose target" };

  const { data: patient } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", parsed.data.patient_id)
    .maybeSingle();
  const organisationId = patient?.organisation_id ?? staff.organisation_id;

  const { error } = await supabase
    .from("patient_glucose_targets")
    .upsert(
      {
        patient_id: parsed.data.patient_id,
        organisation_id: organisationId,
        category: parsed.data.category,
        hba1c_target_percent: parsed.data.hba1c_target_percent ?? null,
        fasting_min: parsed.data.fasting_min,
        fasting_max: parsed.data.fasting_max,
        upper_target: parsed.data.upper_target,
        set_by: staff.id,
        note: parsed.data.note ?? null,
      },
      { onConflict: "patient_id" }
    );
  if (error) return { error: error.message };

  revalidatePath(`/clinician/patients/${parsed.data.patient_id}`);
  return { success: true };
}
