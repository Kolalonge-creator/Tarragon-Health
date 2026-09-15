import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";

/** The only metric keys the Weekly Plan card's goal templates use — see
 * MEASUREMENT_TYPE_BY_METRIC_KEY in lib/lpe/weekly-plan.ts. */
export type WeeklyPlanMetric = Extract<
  Database["public"]["Enums"]["lpe_measurement_type"],
  "food_log" | "activity_minutes" | "weight" | "bp" | "glucose"
>;

export interface RecordWeeklyPlanProgressParams {
  /** Must equal the CALLER's own auth.uid() — lpe_measurements RLS only
   * lets a patient insert their own rows (no supporter-acting-for-dependent
   * path, unlike vitals_readings). A caller resolving a different subject
   * (e.g. logVital's acting-for) must check this before calling. */
  patientId: string;
  organisationId: string;
  metric: WeeklyPlanMetric;
  valueNum?: number | null;
  valueJson?: Json | null;
  unit: string;
  /** Defaults to now. */
  takenAt?: string;
}

/**
 * Bridges a REAL logging action (a meal, a workout, a vitals reading) into
 * the Weekly Plan card's own completion tracking (lib/lpe/weekly-plan.ts),
 * which reads only `lpe_measurements`. Without this, a patient who
 * genuinely logs a meal/activity/reading through the real feature still saw
 * their weekly-plan goal as "not done" — only the card's own manual "Mark
 * done" button (or the separate lifestyle check-in flow) ever wrote there.
 *
 * Best-effort and additive: never throws, never blocks the caller's own
 * insert, and writes nothing when the patient has no active LPE goal for
 * this metric (most patients — the card itself self-hides without an
 * active enrolment, so most calls are a same-shaped no-op).
 *
 * Deliberately does NOT go through lib/lifestyle/ingest.ts's
 * ingestMeasurement() — that also runs red-flag evaluation, which for
 * weight/bp/glucose would duplicate the dedicated pipeline the calling
 * action already runs (logVital's assessBpControlBestEffort /
 * assessGlucoseBestEffort). This is a plain persistence-only mirror, the
 * same shape as ingestMeasurement's own best-effort vitals_readings mirror.
 */
export async function recordWeeklyPlanProgress(
  db: SupabaseClient<Database>,
  params: RecordWeeklyPlanProgressParams
): Promise<void> {
  try {
    const { patientId, organisationId, metric, valueNum, valueJson, unit, takenAt } = params;

    const { data: enrollments } = await db
      .from("lpe_enrollments")
      .select("id")
      .eq("patient_id", patientId)
      .eq("status", "active");
    if (!enrollments?.length) return;

    const { data: programmeInstances } = await db
      .from("lpe_programme_instances")
      .select("id, enrollment_id")
      .in(
        "enrollment_id",
        enrollments.map((e) => e.id)
      );
    if (!programmeInstances?.length) return;

    const { data: goalInstances } = await db
      .from("lpe_goal_instances")
      .select("programme_instance_id")
      .in(
        "programme_instance_id",
        programmeInstances.map((p) => p.id)
      )
      .eq("status", "active")
      .eq("metric_key", metric);
    if (!goalInstances?.length) return;

    const instanceToEnrollment = new Map(programmeInstances.map((p) => [p.id, p.enrollment_id]));
    const enrollmentIds = new Set(
      goalInstances
        .map((g) => instanceToEnrollment.get(g.programme_instance_id))
        .filter((id): id is string => Boolean(id))
    );
    if (!enrollmentIds.size) return;

    const rows = [...enrollmentIds].map((enrollmentId) => ({
      organisation_id: organisationId,
      patient_id: patientId,
      enrollment_id: enrollmentId,
      type: metric,
      value_num: valueNum ?? null,
      value_json: (valueJson ?? null) as Json,
      unit,
      taken_at: takenAt ?? new Date().toISOString(),
      source: "web" as const,
    }));

    const { error } = await db.from("lpe_measurements").insert(rows);
    if (error) {
      console.error("recordWeeklyPlanProgress: insert failed", error);
    }
  } catch (err) {
    console.error("recordWeeklyPlanProgress: unexpected error", err);
  }
}
