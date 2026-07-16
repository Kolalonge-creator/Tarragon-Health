"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { assessBpControlBestEffort } from "@/lib/ml/assess-bp-control";
import { assessHeartRateBestEffort } from "@/lib/vitals/assess-heart-rate";
import { assessHealthScoreBestEffort } from "@/lib/health-score/assess-health-score";
import { vitalsReadingSchema } from "@/lib/validation/vitals";
import { symptomLogSchema } from "@/lib/validation/symptoms";
import { patientLocationSchema } from "@/lib/validation/patient-location";
import { emergencyContactSchema } from "@/lib/validation/emergency-contact";
import { dangerReportSchema, dangerSignsSummary, type DangerSign } from "@/lib/validation/emergency";
import {
  riskAssessmentSchema,
  QUESTION_CATEGORY,
  type RiskAssessmentInput,
} from "@/lib/validation/risk-assessment";
import { computeRiskTiers } from "@/lib/rules/risk-scoring";
import { computeScreeningRecommendations } from "@/lib/rules/screening-recommendations";
import { computeCareProgrammeRecommendations } from "@/lib/rules/care-programme-recommendations";
import { ageFromDateOfBirth, mgDlToMmolL, type Json } from "@tarragon/shared";

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
    await assessBpControlBestEffort(supabase, user.id, profile.organisation_id);
  }
  if (row.vital_type === "pulse") {
    await assessHeartRateBestEffort(supabase, user.id, profile.organisation_id);
  }
  await assessHealthScoreBestEffort(supabase, user.id, profile.organisation_id);

  return { success: true };
}

export type UpdateLocationActionState = { error?: string; success?: boolean } | undefined;

/**
 * Saves the patient's own state/city/area on their profiles row (RLS-scoped —
 * a patient may update their own profile). Blank fields clear that part of the
 * saved location. These pre-fill the "choose a facility near me" pickers; no
 * value is ever inferred.
 */
export async function updatePatientLocation(
  _prevState: UpdateLocationActionState,
  formData: FormData
): Promise<UpdateLocationActionState> {
  const parsed = patientLocationSchema.safeParse({
    state: formData.get("state") ?? undefined,
    city: formData.get("city") ?? undefined,
    area: formData.get("area") ?? undefined,
  });
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

  // Empty string → null so a cleared field doesn't store "".
  const norm = (value: string | undefined) => (value && value.length > 0 ? value : null);
  const { error } = await supabase
    .from("profiles")
    .update({
      state: norm(parsed.data.state),
      city: norm(parsed.data.city),
      area: norm(parsed.data.area),
    })
    .eq("id", user.id);
  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export type LogSymptomActionState = { error?: string; success?: boolean } | undefined;

/**
 * Logs a patient-reported symptom. Deliberately does not accept or compute
 * is_red_flag here — the private.handle_symptom_red_flag() trigger derives
 * it server-side from symptom_type/severity and raises the clinician_alerts
 * escalation, so this action can't accidentally under-report a red flag.
 */
export async function logSymptom(
  _prevState: LogSymptomActionState,
  formData: FormData
): Promise<LogSymptomActionState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = symptomLogSchema.safeParse(raw);
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

  const { error } = await supabase.from("symptoms").insert({
    symptom_type: parsed.data.symptom_type,
    severity: parsed.data.severity,
    description: parsed.data.description || null,
    patient_id: user.id,
    organisation_id: profile.organisation_id,
  });
  if (error) {
    return { error: error.message };
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

  // Recommended care programme(s) — the risk assessment's care-plan output.
  // These are *suggestions* (never doctor-reviewed) that a clinician later
  // promotes into a real care_plans row. Written via the service-role client
  // for the same reason as prevention_risk_scores: the tier/rationale are the
  // server's own computation, not values a patient session should set.
  const programmeRecommendations = computeCareProgrammeRecommendations(
    scores,
    responses,
    responses.weight_kg ?? latestWeight?.weight_kg ?? null,
  );
  if (programmeRecommendations.length > 0) {
    // Skip conditions that already have an open (proposed) or accepted
    // recommendation — retaking the assessment shouldn't pile up duplicates
    // or re-propose something the care team already actioned.
    const { data: existingRecs } = await serviceRoleClient
      .from("care_plan_recommendations")
      .select("condition, status")
      .eq("patient_id", user.id)
      .in("status", ["proposed", "accepted"]);
    const alreadyOpen = new Set((existingRecs ?? []).map((row) => row.condition));

    const newRecs = programmeRecommendations.filter((rec) => !alreadyOpen.has(rec.condition));
    if (newRecs.length > 0) {
      const { error: recError } = await serviceRoleClient
        .from("care_plan_recommendations")
        .insert(
          newRecs.map((rec) => ({
            organisation_id: organisationId,
            patient_id: user.id,
            condition: rec.condition,
            tier: rec.tier,
            rationale: rec.rationale,
            inputs_snapshot: { tiers: Object.fromEntries(tiersByCondition) } as Json,
          })),
        );
      if (recError) {
        return { error: recError.message };
      }
    }
  }

  // Smoking status/height/weight just (re)submitted feed the Health Score's
  // smoking and BMI components directly.
  await assessHealthScoreBestEffort(supabase, user.id, organisationId);

  return { success: true };
}

export type UpdateEmergencyContactState = { error?: string; success?: boolean } | undefined;

/**
 * Saves the patient's emergency contact + next of kin on their own profiles row
 * (RLS-scoped). Blank fields clear that part. The emergency-contact phone is
 * what the acknowledge-gated auto-notify messages if the patient does not
 * respond to an active emergency — mirrors updatePatientLocation.
 */
export async function updateEmergencyContact(
  _prevState: UpdateEmergencyContactState,
  formData: FormData
): Promise<UpdateEmergencyContactState> {
  const parsed = emergencyContactSchema.safeParse({
    emergency_contact_name: formData.get("emergency_contact_name") ?? undefined,
    emergency_contact_phone: formData.get("emergency_contact_phone") ?? undefined,
    emergency_contact_relationship: formData.get("emergency_contact_relationship") ?? undefined,
    emergency_contact_consent: formData.get("emergency_contact_consent") === "on",
    next_of_kin_name: formData.get("next_of_kin_name") ?? undefined,
    next_of_kin_phone: formData.get("next_of_kin_phone") ?? undefined,
  });
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

  const norm = (value: string | undefined) => (value && value.length > 0 ? value : null);
  const consent = parsed.data.emergency_contact_consent;
  const { error } = await supabase
    .from("profiles")
    .update({
      emergency_contact_name: norm(parsed.data.emergency_contact_name),
      emergency_contact_phone: norm(parsed.data.emergency_contact_phone),
      emergency_contact_relationship: norm(parsed.data.emergency_contact_relationship),
      emergency_contact_consent: consent,
      // Stamp when consent was given; clear it if consent is withdrawn.
      emergency_contact_consent_at: consent ? new Date().toISOString() : null,
      next_of_kin_name: norm(parsed.data.next_of_kin_name),
      next_of_kin_phone: norm(parsed.data.next_of_kin_phone),
    })
    .eq("id", user.id);
  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export type ReportDangerState = { error?: string; success?: boolean; eventId?: string } | undefined;

/**
 * Records a one-touch danger-symptom report as an emergency_events row. The DB
 * trigger raises the emergency-tier clinician_alert (2-hour SLA) — this action
 * never decides urgency itself, so it can't under-report. The patient then sees
 * the acknowledge-gated "go to the nearest hospital now" alert.
 */
export async function reportDangerSymptoms(
  _prevState: ReportDangerState,
  formData: FormData
): Promise<ReportDangerState> {
  const parsed = dangerReportSchema.safeParse({
    signs: formData.getAll("signs"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Select at least one sign" };
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

  const { data, error } = await supabase
    .from("emergency_events")
    .insert({
      patient_id: user.id,
      organisation_id: profile.organisation_id,
      source: "danger_symptom_checklist",
      trigger_detail: dangerSignsSummary(parsed.data.signs as DangerSign[]),
      status: "active",
    })
    .select("id")
    .single();
  if (error) {
    return { error: error.message };
  }

  return { success: true, eventId: data.id };
}

export type EmergencyEventActionState = { error?: string; success?: boolean } | undefined;

/**
 * Patient acknowledges their own active emergency ("I'm getting help"). The DB
 * update guard forces acknowledged_by to the caller and prevents spoofing any
 * staff-owned field. Acknowledging in-window suppresses the auto-notify.
 */
export async function acknowledgeEmergency(eventId: string): Promise<EmergencyEventActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  const { error } = await supabase
    .from("emergency_events")
    .update({ acknowledged_at: new Date().toISOString(), status: "acknowledged" })
    .eq("id", eventId)
    .eq("patient_id", user.id)
    .is("acknowledged_at", null);
  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

/**
 * Immediately messages the patient's saved emergency contact (SMS + WhatsApp)
 * for one of their own active events, without waiting for the acknowledge-gated
 * timeout. Ownership is verified via the patient's own RLS-scoped session
 * before any service-role write (same pattern as the AI-coach escalation) —
 * notifications is queue-write only, so the send itself is off-session.
 */
export async function alertEmergencyContactNow(eventId: string): Promise<EmergencyEventActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  // Ownership + contact are read under the patient's own RLS session first.
  const { data: event } = await supabase
    .from("emergency_events")
    .select("id, organisation_id, contact_notified_at")
    .eq("id", eventId)
    .eq("patient_id", user.id)
    .single();
  if (!event) {
    return { error: "Emergency not found" };
  }
  if (event.contact_notified_at) {
    return { success: true };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "full_name, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, emergency_contact_consent"
    )
    .eq("id", user.id)
    .single();
  if (!profile?.emergency_contact_phone) {
    return { error: "Add an emergency contact number first so we can alert them." };
  }
  // Never message a contact without the patient's recorded consent.
  if (!profile.emergency_contact_consent) {
    return {
      error: "Confirm your emergency contact has agreed to be contacted before we alert them.",
    };
  }

  const payload = {
    to_phone: profile.emergency_contact_phone,
    contact_name: profile.emergency_contact_name ?? "there",
    contact_relationship: profile.emergency_contact_relationship,
    patient_name: profile.full_name ?? "someone who lists you as their emergency contact",
  } as Json;

  // notifications is queue-write only; the deployed dispatcher sends off-session.
  const serviceRole = createServiceRoleClient();
  const { error: notifyError } = await serviceRole.from("notifications").insert([
    {
      organisation_id: event.organisation_id,
      recipient_id: user.id,
      channel: "sms",
      status: "pending",
      template: "emergency_contact_alert",
      payload,
    },
    {
      organisation_id: event.organisation_id,
      recipient_id: user.id,
      channel: "whatsapp",
      status: "pending",
      template: "emergency_contact_alert",
      payload,
    },
  ]);
  if (notifyError) {
    return { error: notifyError.message };
  }

  await serviceRole
    .from("emergency_events")
    .update({ contact_notified_at: new Date().toISOString() })
    .eq("id", eventId);

  return { success: true };
}
