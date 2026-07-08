"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { vitalsReadingSchema } from "@/lib/validation/vitals";
import {
  riskAssessmentSchema,
  QUESTION_CATEGORY,
  type RiskAssessmentInput,
} from "@/lib/validation/risk-assessment";
import { computeRiskTiers } from "@/lib/rules/risk-scoring";
import { computeScreeningRecommendations } from "@/lib/rules/screening-recommendations";
import { ageFromDateOfBirth, createMlClientFromEnv, mgDlToMmolL, type Json } from "@tarragon/shared";

/** Trailing window for BP-control assessment, matching services/ml's CONTROL_WINDOW_DAYS. */
const BP_CONTROL_WINDOW_DAYS = 30;

/**
 * Best-effort BP-control assessment after a blood_pressure vitals insert.
 * Never throws and never blocks `logVital`'s own success response — the ML
 * service is stateless/optional per CLAUDE.md ("platform must keep working
 * if ML is down"), so any failure here (client unconfigured, ML down,
 * insufficient history) is a silent no-op, not a user-facing error.
 */
async function assessBpControlBestEffort(
  patientId: string,
  organisationId: string
): Promise<void> {
  const mlClient = createMlClientFromEnv();
  if (!mlClient) return;

  const supabase = await createClient();
  const since = new Date(Date.now() - BP_CONTROL_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: readings } = await supabase
    .from("vitals_readings")
    .select("taken_at, systolic, diastolic")
    .eq("patient_id", patientId)
    .eq("vital_type", "blood_pressure")
    .gte("taken_at", since)
    .order("taken_at", { ascending: true });

  if (!readings || readings.length === 0) return;

  const assessment = await mlClient.bpControl({
    readings: readings
      .filter((r) => r.systolic !== null && r.diastolic !== null)
      .map((r) => ({
        taken_at: r.taken_at,
        systolic: r.systolic as number,
        diastolic: r.diastolic as number,
      })),
  });
  if (!assessment) return;

  // patient_risk_scores is staff-only-write by RLS (is_org_staff) — this is
  // a system computation, not the patient's own raw input, same reasoning
  // as prevention_risk_scores/screening_schedules below.
  await createServiceRoleClient()
    .from("patient_risk_scores")
    .insert({
      organisation_id: organisationId,
      patient_id: patientId,
      score_type: "bp_control",
      score: assessment.control_rate_percent,
      model_version: "bp_control_v1",
      inputs: assessment as unknown as Json,
    });
}

export type LogVitalActionState = { error?: string; success?: boolean } | undefined;

export async function logVital(
  _prevState: LogVitalActionState,
  formData: FormData
): Promise<LogVitalActionState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = vitalsReadingSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return { error: "No organisation on file" };
  }

  const { taken_at, ...reading } = parsed.data;

  // vitals_readings only has a glucose_mmol_l column — convert here if the
  // patient entered mg/dL, so the DB always stores the canonical unit.
  const row =
    reading.vital_type === "glucose"
      ? {
          ...reading,
          glucose_value: undefined,
          glucose_unit: undefined,
          glucose_mmol_l:
            reading.glucose_unit === "mg_dl"
              ? mgDlToMmolL(reading.glucose_value)
              : reading.glucose_value,
        }
      : reading;

  const { error } = await supabase.from("vitals_readings").insert({
    ...row,
    taken_at: taken_at ? new Date(taken_at).toISOString() : undefined,
    patient_id: user.id,
    organisation_id: profile.organisation_id,
  });
  if (error) {
    return { error: error.message };
  }

  if (row.vital_type === "blood_pressure") {
    await assessBpControlBestEffort(user.id, profile.organisation_id);
  }

  return { success: true };
}

export type SubmitRiskAssessmentState = { error?: string; success?: boolean } | undefined;

/**
 * Submits the risk assessment questionnaire, then recomputes and stores
 * rule-based tiers server-side (never trusting a client-supplied tier
 * value). Full response history is kept — retaking the assessment inserts
 * new rows rather than upserting (docs/FEATURE_SPEC.md §10).
 *
 * Also (re)generates screening_schedules from the freshly computed tiers,
 * per V1 spec §3.3 ("recommendations regenerate ... when risk tier
 * changes"). The engine only ever tightens an existing due date, never
 * loosens one, so a tier drop can't silently cancel a screening already due.
 */
export async function submitRiskAssessment(
  _prevState: SubmitRiskAssessmentState,
  formData: FormData
): Promise<SubmitRiskAssessmentState> {
  const raw = {
    family_diabetes: formData.get("family_diabetes"),
    family_hypertension: formData.get("family_hypertension"),
    family_heart_disease: formData.get("family_heart_disease"),
    family_sickle_cell: formData.get("family_sickle_cell"),
    family_cancer_types: formData.getAll("family_cancer_types"),
    family_cancer_other_detail: formData.get("family_cancer_other_detail") || undefined,
    smoking_status: formData.get("smoking_status"),
    cigarettes_per_day: formData.get("cigarettes_per_day") || undefined,
    alcohol_use: formData.get("alcohol_use"),
    exercise_days_per_week: formData.get("exercise_days_per_week"),
    exercise_minutes_per_session: formData.get("exercise_minutes_per_session"),
    diet_pattern: formData.getAll("diet_pattern"),
    sleep_hours: formData.get("sleep_hours"),
    stress_level: formData.get("stress_level"),
    height_cm: formData.get("height_cm"),
    weight_kg: formData.get("weight_kg") || undefined,
    existing_diagnoses: formData.getAll("existing_diagnoses"),
    existing_diagnoses_other_detail: formData.get("existing_diagnoses_other_detail") || undefined,
    current_medications: formData.get("current_medications") || undefined,
    hpv_vaccinated: formData.get("hpv_vaccinated"),
    other_vaccines_detail: formData.get("other_vaccines_detail") || undefined,
    prior_abnormal_result: formData.get("prior_abnormal_result"),
  };

  const parsed = riskAssessmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const responses = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id, sex, date_of_birth")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return { error: "No organisation on file" };
  }
  const organisationId = profile.organisation_id;

  // response is jsonb not null — skip unanswered optional fields (e.g.
  // current_medications left blank) rather than writing a null row.
  const responseRows = (Object.keys(responses) as Array<keyof RiskAssessmentInput>)
    .filter((key) => responses[key] !== undefined)
    .map((key) => ({
      organisation_id: organisationId,
      profile_id: user.id,
      category: QUESTION_CATEGORY[key],
      question_key: key,
      response: responses[key] as Json,
    }));

  const { error: responsesError } = await supabase
    .from("risk_assessment_responses")
    .insert(responseRows);
  if (responsesError) {
    return { error: responsesError.message };
  }

  // Keep the assessment's weight part of the same longitudinal vitals
  // record the "Log a reading" widget writes to, not a form-only value.
  if (responses.weight_kg !== undefined) {
    const { error: weightInsertError } = await supabase.from("vitals_readings").insert({
      patient_id: user.id,
      organisation_id: organisationId,
      vital_type: "weight",
      weight_kg: responses.weight_kg,
    });
    if (weightInsertError) {
      return { error: weightInsertError.message };
    }
  }

  const { data: latestWeight } = await supabase
    .from("vitals_readings")
    .select("weight_kg")
    .eq("patient_id", user.id)
    .eq("vital_type", "weight")
    .order("taken_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ageYears = ageFromDateOfBirth(profile.date_of_birth);

  const scores = computeRiskTiers(responses, {
    sex: profile.sex,
    ageYears,
    // Prefer what the patient just entered; fall back to their last logged
    // vitals weight if they left it blank this time.
    weightKg: responses.weight_kg ?? latestWeight?.weight_kg ?? null,
  });

  // prevention_risk_scores is written through the service-role client, not
  // the patient's own RLS-scoped session: the tier is meant to always be
  // the server's own computation, and a table-level RLS check can only ever
  // verify row ownership, not that a given tier value actually came from
  // computeRiskTiers. Identity/org are already verified above via the
  // patient's own session before we reach this point.
  const { error: scoresError } = await createServiceRoleClient()
    .from("prevention_risk_scores")
    .insert(
      scores.map((score) => ({
        organisation_id: organisationId,
        profile_id: user.id,
        condition: score.condition,
        tier: score.tier,
        inputs_snapshot: score.inputsSnapshot as Json,
      }))
    );
  if (scoresError) {
    return { error: scoresError.message };
  }

  const { data: screenTypes } = await supabase
    .from("screen_types")
    .select("id, code, sex_applicability, age_from, age_to, frequency_months")
    .eq("is_active", true);

  const { data: existingSchedules } = await supabase
    .from("screening_schedules")
    .select("id, screen_type_id, status, due_date")
    .eq("patient_id", user.id);

  const lastCompletedByScreenTypeId = new Map<string, string>();
  const activeByScreenTypeId = new Map<string, { id: string; due_date: string }>();
  for (const row of existingSchedules ?? []) {
    if (row.status === "completed") {
      const latest = lastCompletedByScreenTypeId.get(row.screen_type_id);
      if (!latest || row.due_date > latest) {
        lastCompletedByScreenTypeId.set(row.screen_type_id, row.due_date);
      }
    } else if (row.status === "pending" || row.status === "booked") {
      activeByScreenTypeId.set(row.screen_type_id, { id: row.id, due_date: row.due_date });
    }
  }

  const tiersByCondition = new Map(scores.map((score) => [score.condition, score.tier]));

  const recommendations = computeScreeningRecommendations(
    screenTypes ?? [],
    tiersByCondition,
    { sex: profile.sex, ageYears },
    lastCompletedByScreenTypeId
  );

  // screening_schedules is written through the service-role client, same
  // reasoning as prevention_risk_scores above: due_date/status here are the
  // engine's own tighten-only computation, not values a patient's own RLS-
  // scoped session should be able to set directly (an arbitrary due_date or
  // a self-marked 'completed' status would defeat the recommendation engine
  // entirely). Identity/org are already verified above via the patient's
  // own session.
  const serviceRoleClient = createServiceRoleClient();

  const newSchedules = recommendations.filter((rec) => !activeByScreenTypeId.has(rec.screenTypeId));
  if (newSchedules.length > 0) {
    const { error: scheduleInsertError } = await serviceRoleClient.from("screening_schedules").insert(
      newSchedules.map((rec) => ({
        organisation_id: organisationId,
        patient_id: user.id,
        screen_type_id: rec.screenTypeId,
        due_date: rec.dueDate,
        status: "pending" as const,
      }))
    );
    if (scheduleInsertError) {
      return { error: scheduleInsertError.message };
    }
  }

  for (const rec of recommendations) {
    const existing = activeByScreenTypeId.get(rec.screenTypeId);
    if (existing && rec.dueDate < existing.due_date) {
      const { error: scheduleUpdateError } = await serviceRoleClient
        .from("screening_schedules")
        .update({ due_date: rec.dueDate })
        .eq("id", existing.id);
      if (scheduleUpdateError) {
        return { error: scheduleUpdateError.message };
      }
    }
  }

  return { success: true };
}
