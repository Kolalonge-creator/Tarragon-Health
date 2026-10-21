import { getProposedConfig } from "@tarragon/shared";
import { assessReadiness, type ReadinessBandsConfig, type ReadinessResult, type WearableReadingPoint } from "@tarragon/clinical/activity-readiness";
import { supabase } from "./supabase";
import { enqueue, flushOutbox, type ActivityPayload } from "./outbox";
import { recordSyncError } from "./sync-diagnostics";
import { parseWeeklyGoal } from "./activity-movement-model";

/**
 * Movement on the phone (S48b): save a workout on the phone first (offline outbox), edit the weekly goal, and read the device bands.
 * Logging something that already happened is never blocked by the activity safety gate.
 */
export async function queueActivity(subjectId: string, payload: ActivityPayload): Promise<{ queued: true }> {
  await enqueue({ kind: "activity", subjectId, payload });
  void flushOutbox().catch((error) => recordSyncError("offline_outbox", "flushAfterActivity", error));
  return { queued: true };
}

/** The weekly goal needs a connection (it is a setting, not a log); a failure says so plainly. */
export async function saveWeeklyGoal(patientId: string, raw: string): Promise<{ error?: string }> {
  const parsed = parseWeeklyGoal(raw);
  if (!parsed.ok) return { error: parsed.error };
  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", patientId).maybeSingle();
  if (!profile?.organisation_id) return { error: "We could not save your goal just now. Please try again when you are online." };
  const { error } = await supabase
    .from("patient_activity_goals")
    .upsert({ organisation_id: profile.organisation_id, patient_id: patientId, weekly_active_minutes_goal: parsed.minutes }, { onConflict: "patient_id" });
  return error ? { error: "We could not save your goal just now. Please try again when you are online." } : {};
}

/**
 * Training load, recovery and sleep bands from the person's own stored device readings (spec 5.6). Returns null (say nothing) when there is no
 * device data, too little to compare, or the read fails. Deterministic, an estimate, never compared with other people.
 */
export async function loadReadiness(nowMs: number): Promise<ReadinessResult | null> {
  const since = new Date(nowMs - 36 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("wearable_readings")
    .select("reading_type, value, recorded_at")
    .in("reading_type", ["recovery_score", "hrv_ms", "sleep_minutes", "strain", "steps"])
    .gte("recorded_at", since)
    .limit(2000);
  if (error || !data) return null;
  const points: WearableReadingPoint[] = data.flatMap((r) =>
    r.value === null ? [] : [{ readingType: r.reading_type, value: Number(r.value), recordedAt: r.recorded_at }],
  );
  const cfg = getProposedConfig("activity.readiness_bands").value as unknown as ReadinessBandsConfig;
  const result = assessReadiness(points, new Date(nowMs), cfg);
  return result.state === "no_data" ? null : result;
}
