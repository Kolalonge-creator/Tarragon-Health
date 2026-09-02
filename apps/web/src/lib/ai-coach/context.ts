import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums } from "@tarragon/shared";
import { CONDITION_LABEL, getLifestyleState } from "@/lib/lifestyle/service";

/** One patient's lifestyle programme, as far as the coach needs to know.
 * Deliberately a different shape (and name-collision-avoiding name) from
 * @tarragon/lifestyle-engine's own, narrower `PatientContext` type
 * (isPregnant/hasEatingDisorderHistory/highRisk) — same name, different
 * package, different purpose; don't conflate them. */
export interface LifestyleProgrammeContext {
  /** Raw enum value (not just conditionLabel) so a caller can filter content
   * retrieval (find-relevant-content.ts) by it. */
  condition: Enums<"care_plan_condition">;
  conditionLabel: string;
  programmeName: string | null;
  currentPhaseName: string | null;
  status: string;
  goalTitles: string[];
  hasOpenRedFlag: boolean;
}

export interface PatientDemographics {
  ageYears: number | null;
  sex: string | null;
}

export interface ActiveConditionSummary {
  conditionName: string;
  status: string;
}

export interface ActiveMedicationSummary {
  drugName: string;
  dose: string | null;
  frequency: string | null;
}

export interface AllergySummary {
  allergen: string;
  reaction: string | null;
  severity: string | null;
}

export interface RecentVitalSummary {
  vitalType: string;
  value: string;
  unit: string | null;
  takenAt: string;
}

export interface RecentLabResultSummary {
  code: string;
  value: number | null;
  unit: string | null;
  takenAt: string;
}

export interface UpcomingAppointmentSummary {
  scheduledFor: string;
  status: string;
  reason: string | null;
}

/**
 * §36.3's 11 context items — the previous version of this function covered
 * only elevatedConditions and lifestyleProgrammes (2 of 11); see
 * docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md §4.2. Every field here reads a
 * table that already exists and is already RLS-scoped to the caller's own
 * session — this widening adds no new tables and no new access.
 */
export interface PatientContext {
  demographics: PatientDemographics;
  /** Prevention conditions currently tiered above 'low', for a personalised
   * (not generic) reply — e.g. so the coach can say "since your diabetes
   * risk is elevated" rather than nothing. */
  elevatedConditions: string[];
  /** The patient's active/paused/etc lifestyle programme enrolments, so a
   * reply can be grounded in their real condition/phase/goals rather than
   * generic health chat — see graph.ts's contextLine composition. */
  lifestyleProgrammes: LifestyleProgrammeContext[];
  /** Diagnosed problem-list entries, not currently resolved/historical. */
  activeConditions: ActiveConditionSummary[];
  activeMedications: ActiveMedicationSummary[];
  allergies: AllergySummary[];
  /** Latest reading per vital_type on file (at most one row per type). */
  recentVitals: RecentVitalSummary[];
  recentLabResults: RecentLabResultSummary[];
  /** Scheduled, not-yet-happened appointments, soonest first. */
  upcomingAppointments: UpcomingAppointmentSummary[];
}

function computeAgeYears(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const hasHadBirthdayThisYear =
    now.getUTCMonth() > dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() >= dob.getUTCDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age >= 0 ? age : null;
}

/** Mirrors patient-explainer/snapshot.ts's "read every candidate column,
 * report whichever is non-null" approach — vitals_readings stores the
 * actual value in a different column depending on vital_type. */
function formatVitalValue(row: {
  systolic: number | null;
  diastolic: number | null;
  pulse_bpm: number | null;
  glucose_mmol_l: number | null;
  weight_kg: number | null;
  spo2_pct: number | null;
  temperature_c: number | null;
}): { value: string; unit: string | null } {
  if (row.systolic !== null && row.diastolic !== null) {
    return { value: `${row.systolic}/${row.diastolic}`, unit: "mmHg" };
  }
  if (row.glucose_mmol_l !== null) return { value: String(row.glucose_mmol_l), unit: "mmol/L" };
  if (row.weight_kg !== null) return { value: String(row.weight_kg), unit: "kg" };
  if (row.spo2_pct !== null) return { value: String(row.spo2_pct), unit: "% SpO2" };
  if (row.temperature_c !== null) return { value: String(row.temperature_c), unit: "°C" };
  if (row.pulse_bpm !== null) return { value: String(row.pulse_bpm), unit: "bpm" };
  return { value: "unknown", unit: null };
}

/** Patient-wide (not per-enrollment) — matches the same scoping
 * coaching-run.ts already uses for its own red-flag check. RLS
 * (lpe_red_flag_events_select) permits a patient's own session to read
 * their own rows. */
async function hasOpenLpeRedFlag(
  supabase: SupabaseClient<Database>,
  profileId: string
): Promise<boolean> {
  const { count } = await supabase
    .from("lpe_red_flag_events")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", profileId)
    .eq("status", "open");
  return (count ?? 0) > 0;
}

/** One most-recent row per vital_type — a single ordered query, deduped in
 * application code rather than 6 separate per-type queries. */
async function loadRecentVitals(
  supabase: SupabaseClient<Database>,
  profileId: string
): Promise<RecentVitalSummary[]> {
  const { data } = await supabase
    .from("vitals_readings")
    .select("vital_type, systolic, diastolic, pulse_bpm, glucose_mmol_l, weight_kg, spo2_pct, temperature_c, taken_at")
    .eq("patient_id", profileId)
    .order("taken_at", { ascending: false })
    .limit(30);
  if (!data) return [];

  const seen = new Set<string>();
  const result: RecentVitalSummary[] = [];
  for (const row of data) {
    if (seen.has(row.vital_type)) continue;
    seen.add(row.vital_type);
    const { value, unit } = formatVitalValue(row);
    result.push({ vitalType: row.vital_type, value, unit, takenAt: row.taken_at });
  }
  return result;
}

/** Best-effort grounding snapshot. Never throws — a coach turn should still
 * proceed on generic advice if any of these lookups fail. Each read is
 * independently try/caught (via Promise.allSettled) so one bad query
 * degrades only its own field, not the whole context. */
export async function loadPatientContext(
  supabase: SupabaseClient<Database>,
  profileId: string
): Promise<PatientContext> {
  const nowIso = new Date().toISOString();

  const [
    riskScoresResult,
    profileResult,
    conditionsResult,
    medicationsResult,
    allergiesResult,
    vitalsResult,
    labsResult,
    appointmentsResult,
    lifestyleResult,
  ] = await Promise.allSettled([
    supabase.from("prevention_risk_scores").select("condition, tier").eq("profile_id", profileId).neq("tier", "low"),
    supabase.from("profiles").select("date_of_birth, sex").eq("id", profileId).maybeSingle(),
    supabase
      .from("patient_conditions")
      .select("condition_name, status")
      .eq("patient_id", profileId)
      .not("status", "in", "(resolved,historical)")
      .order("date_identified", { ascending: false })
      .limit(20),
    supabase
      .from("medications")
      .select("drug_name, dose, frequency")
      .eq("patient_id", profileId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("patient_allergies").select("allergen, reaction, severity").eq("patient_id", profileId),
    loadRecentVitals(supabase, profileId),
    supabase
      .from("lab_analyte_readings")
      .select("code, value, unit, taken_at")
      .eq("patient_id", profileId)
      .order("taken_at", { ascending: false })
      .limit(5),
    supabase
      .from("appointments")
      .select("scheduled_for, status, reason")
      .eq("patient_id", profileId)
      .eq("status", "scheduled")
      .gte("scheduled_for", nowIso)
      .order("scheduled_for", { ascending: true })
      .limit(3),
    (async () => {
      const [enrollments, hasOpenRedFlag] = await Promise.all([
        getLifestyleState(supabase, profileId),
        hasOpenLpeRedFlag(supabase, profileId),
      ]);
      return enrollments.map((e) => ({
        condition: e.condition,
        conditionLabel: CONDITION_LABEL[e.condition] ?? e.condition,
        programmeName: e.programmeName,
        currentPhaseName: e.currentPhaseName,
        status: e.status,
        goalTitles: e.goals.map((g) => g.title),
        hasOpenRedFlag,
      }));
    })(),
  ]);

  const elevatedConditions =
    riskScoresResult.status === "fulfilled" ? (riskScoresResult.value.data ?? []).map((row) => row.condition) : [];

  const profileRow = profileResult.status === "fulfilled" ? profileResult.value.data : null;
  const demographics: PatientDemographics = {
    ageYears: computeAgeYears(profileRow?.date_of_birth ?? null),
    sex: profileRow?.sex ?? null,
  };

  const activeConditions: ActiveConditionSummary[] =
    conditionsResult.status === "fulfilled"
      ? (conditionsResult.value.data ?? []).map((row) => ({ conditionName: row.condition_name, status: row.status }))
      : [];

  const activeMedications: ActiveMedicationSummary[] =
    medicationsResult.status === "fulfilled"
      ? (medicationsResult.value.data ?? []).map((row) => ({
          drugName: row.drug_name,
          dose: row.dose,
          frequency: row.frequency,
        }))
      : [];

  const allergies: AllergySummary[] =
    allergiesResult.status === "fulfilled"
      ? (allergiesResult.value.data ?? []).map((row) => ({
          allergen: row.allergen,
          reaction: row.reaction,
          severity: row.severity,
        }))
      : [];

  const recentVitals: RecentVitalSummary[] = vitalsResult.status === "fulfilled" ? vitalsResult.value : [];

  const recentLabResults: RecentLabResultSummary[] =
    labsResult.status === "fulfilled"
      ? (labsResult.value.data ?? []).map((row) => ({
          code: row.code,
          value: row.value,
          unit: row.unit,
          takenAt: row.taken_at,
        }))
      : [];

  const upcomingAppointments: UpcomingAppointmentSummary[] =
    appointmentsResult.status === "fulfilled"
      ? (appointmentsResult.value.data ?? []).map((row) => ({
          scheduledFor: row.scheduled_for,
          status: row.status,
          reason: row.reason,
        }))
      : [];

  const lifestyleProgrammes: LifestyleProgrammeContext[] =
    lifestyleResult.status === "fulfilled" ? lifestyleResult.value : [];

  return {
    demographics,
    elevatedConditions,
    lifestyleProgrammes,
    activeConditions,
    activeMedications,
    allergies,
    recentVitals,
    recentLabResults,
    upcomingAppointments,
  };
}
