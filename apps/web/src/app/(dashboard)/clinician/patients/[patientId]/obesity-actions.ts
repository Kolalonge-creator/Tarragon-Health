"use server";

import { createClient } from "@/lib/supabase/server";
import {
  obesityAssessmentSchema,
  obesityEdScreenSchema,
  bariatricReferralSchema,
  OBESITY_COMPLICATIONS,
  OBESITY_SECONDARY_CAUSES,
  ED_DISORDERED_BEHAVIOURS,
} from "@/lib/validation/obesity";
import {
  classifyObesity,
  bariatricReferralEligible,
  type Sex,
} from "@/lib/obesity/classify";

export type ObesityActionState = { error?: string; success?: boolean; positive?: boolean } | undefined;

/** Complications that count as "weight-related" for AOM / bariatric eligibility. */
const WEIGHT_RELATED = new Set([
  "type2_diabetes",
  "hypertension",
  "osa",
  "nafld",
  "dyslipidaemia",
  "cardiovascular_disease",
  "osteoarthritis",
]);

async function loadPatient(patientId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("organisation_id, sex")
    .eq("id", patientId)
    .eq("role", "patient")
    .maybeSingle();
  return data;
}

/**
 * Record a structured obesity assessment (§6/§7). The objective classification
 * (BMI band, waist risk, WHtR, adiposity) is computed server-side from the raw
 * measurements + the patient's sex; the clinical-vs-preclinical status and
 * Edmonton stage are the doctor's own selections (nullable — software never
 * decides). `assessed_by` is stamped by the DB trigger.
 */
export async function submitObesityAssessment(
  patientId: string,
  _prev: ObesityActionState,
  formData: FormData,
): Promise<ObesityActionState> {
  const parsed = obesityAssessmentSchema.safeParse({
    height_cm: formData.get("height_cm"),
    weight_kg: formData.get("weight_kg"),
    waist_cm: formData.get("waist_cm") || undefined,
    clinical_status: formData.get("clinical_status") || undefined,
    eoss_stage: formData.get("eoss_stage") || undefined,
    functional_limitation: formData.get("functional_limitation") === "on",
    complications: formData.getAll("complications").filter((c) =>
      (OBESITY_COMPLICATIONS as readonly string[]).includes(c as string),
    ),
    secondary_causes: formData.getAll("secondary_causes").filter((c) =>
      (OBESITY_SECONDARY_CAUSES as readonly string[]).includes(c as string),
    ),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const input = parsed.data;

  const patient = await loadPatient(patientId);
  if (!patient?.organisation_id) return { error: "Patient not found or has no organisation on file" };
  if (!patient.sex) return { error: "Patient is missing sex on file — set it before assessing" };

  const cls = classifyObesity({
    weightKg: input.weight_kg,
    heightCm: input.height_cm,
    waistCm: input.waist_cm ?? null,
    sex: patient.sex as Sex,
  });
  if (cls.bmi == null || cls.bmiCategory == null) {
    return { error: "Could not compute BMI from those measurements" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("obesity_assessments").insert({
    organisation_id: patient.organisation_id,
    patient_id: patientId,
    height_cm: input.height_cm,
    weight_kg: input.weight_kg,
    waist_cm: input.waist_cm ?? null,
    bmi: Math.round(cls.bmi * 10) / 10,
    bmi_category: cls.bmiCategory,
    waist_risk: cls.waistRisk,
    whtr: cls.whtr == null ? null : Math.round(cls.whtr * 1000) / 1000,
    adiposity_confirmed: cls.adiposityConfirmed,
    clinical_status: input.clinical_status ?? null,
    eoss_stage: input.eoss_stage ?? null,
    functional_limitation: input.functional_limitation ?? false,
    complications: input.complications,
    secondary_causes: input.secondary_causes,
    notes: input.notes ?? null,
  });
  if (error) return { error: error.message };
  return { success: true };
}

/**
 * Record the mandatory ED / mental-health screen (§6.5/§18). Scoring, alert
 * escalation and the weight-loss auto-pause are ALL handled by DB triggers —
 * this just inserts the answers. Returns whether the screen came back positive
 * so the UI can show the "paused, review & refer" state.
 */
export async function submitObesityEdScreen(
  patientId: string,
  _prev: ObesityActionState,
  formData: FormData,
): Promise<ObesityActionState> {
  const parsed = obesityEdScreenSchema.safeParse({
    scoff_sick: formData.get("scoff_sick") === "on",
    scoff_control: formData.get("scoff_control") === "on",
    scoff_one_stone: formData.get("scoff_one_stone") === "on",
    scoff_fat: formData.get("scoff_fat") === "on",
    scoff_food_dominates: formData.get("scoff_food_dominates") === "on",
    self_harm_risk: formData.get("self_harm_risk") === "on",
    low_mood: formData.get("low_mood") === "on",
    disordered_behaviours: formData.getAll("disordered_behaviours").filter((c) =>
      (ED_DISORDERED_BEHAVIOURS as readonly string[]).includes(c as string),
    ),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const input = parsed.data;

  const patient = await loadPatient(patientId);
  if (!patient?.organisation_id) return { error: "Patient not found or has no organisation on file" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("obesity_ed_screens")
    .insert({
      organisation_id: patient.organisation_id,
      patient_id: patientId,
      scoff_sick: input.scoff_sick ?? false,
      scoff_control: input.scoff_control ?? false,
      scoff_one_stone: input.scoff_one_stone ?? false,
      scoff_fat: input.scoff_fat ?? false,
      scoff_food_dominates: input.scoff_food_dominates ?? false,
      self_harm_risk: input.self_harm_risk ?? false,
      low_mood: input.low_mood ?? false,
      disordered_behaviours: input.disordered_behaviours,
      notes: input.notes ?? null,
    })
    .select("positive")
    .single();
  if (error) return { error: error.message };
  return { success: true, positive: data?.positive ?? false };
}

/**
 * Refer a patient for metabolic/bariatric surgery assessment (§14). Eligibility
 * (§14.1) is recomputed server-side from the latest assessment's BMI plus the
 * doctor's complication / uncontrolled-T2DM answers; the criterion met is
 * stored for audit. A referral can be raised even when not strictly eligible
 * (the doctor's call) — the `eligible` flag records which it was.
 */
export async function createBariatricReferral(
  patientId: string,
  _prev: ObesityActionState,
  formData: FormData,
): Promise<ObesityActionState> {
  const parsed = bariatricReferralSchema.safeParse({
    has_obesity_complication: formData.get("has_obesity_complication") === "on",
    has_uncontrolled_t2dm: formData.get("has_uncontrolled_t2dm") === "on",
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const input = parsed.data;

  const patient = await loadPatient(patientId);
  if (!patient?.organisation_id) return { error: "Patient not found or has no organisation on file" };

  const supabase = await createClient();
  const { data: latest } = await supabase
    .from("obesity_assessments")
    .select("id, bmi, complications")
    .eq("patient_id", patientId)
    .order("assessed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest?.bmi) {
    return { error: "Record an obesity assessment first — a referral needs a current BMI" };
  }

  const hasComplication =
    input.has_obesity_complication ??
    ((latest.complications as string[] | null) ?? []).some((c) => WEIGHT_RELATED.has(c));

  const eligible = bariatricReferralEligible({
    bmi: latest.bmi,
    hasObesityComplication: hasComplication,
    hasUncontrolledT2dm: input.has_uncontrolled_t2dm ?? false,
  });

  const criteria: string[] = [];
  if (latest.bmi >= 40) criteria.push("bmi_ge_40");
  if (latest.bmi >= 35 && hasComplication) criteria.push("bmi_ge_35_with_complication");
  if (latest.bmi >= 30 && latest.bmi < 35 && input.has_uncontrolled_t2dm) {
    criteria.push("bmi_30_34_uncontrolled_t2dm");
  }

  const { error } = await supabase.from("bariatric_referrals").insert({
    organisation_id: patient.organisation_id,
    patient_id: patientId,
    obesity_assessment_id: latest.id,
    bmi: latest.bmi,
    criteria,
    eligible,
    status: eligible ? "proposed" : "not_eligible",
    notes: input.notes ?? null,
  });
  if (error) return { error: error.message };
  return { success: true };
}

/**
 * A clinician signs the obesity red-flag attestation (§26). The signer is
 * server-derived from their own clinical_staff row (DB trigger); a caller with
 * no active clinical_staff row is rejected by the trigger.
 */
const OBESITY_ATTESTATION_STATEMENT =
  "I will practise non-stigmatising, person-first obesity care; I know and will act on the red flags in Section 16 — especially the eating-disorder and mental-health flags, where the correct action is to PAUSE weight-loss treatment and refer; and I understand a red flag overrides routine plans.";

export async function signObesityAttestation(): Promise<ObesityActionState> {
  const supabase = await createClient();
  const { error } = await supabase.from("pathway_attestations").insert({
    // organisation_id + clinical_staff_id are overwritten by the DB trigger.
    organisation_id: "00000000-0000-0000-0000-000000000000",
    clinical_staff_id: "00000000-0000-0000-0000-000000000000",
    protocol_slug: "chronic_obesity_who",
    pathway_version: 1,
    statement: OBESITY_ATTESTATION_STATEMENT,
  });
  if (error) {
    // Unique violation ⇒ already attested this version; treat as success.
    if (error.code === "23505") return { success: true };
    return { error: error.message };
  }
  return { success: true };
}
