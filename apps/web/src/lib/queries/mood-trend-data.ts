import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { mergeMoodBpSleep, type MoodTrendDay } from "@tarragon/shared";
import { readPatientVitalsOrThrow } from "@/lib/clinical/vitals-audited";

/**
 * The patient's own check-ins, blood pressure readings and sleep log for the last `windowDays` days, merged per Lagos day. Reads go through the
 * caller's own session (the owner's row-level security), so this returns the signed-in person's data and nobody else's. Used by the
 * "mood next to your readings" table (30 days, in the browser) and the patterns view (90 days, on the server).
 */
export async function fetchMoodTrendDays(supabase: SupabaseClient<Database>, patientId: string, windowDays: number): Promise<MoodTrendDay[]> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();
  const [checkins, bp, sleep] = await Promise.all([
    supabase
      .from("wellbeing_checkins")
      .select("checked_in_at, mood_score, stress_score, tags")
      .eq("patient_id", patientId)
      .gte("checked_in_at", sinceIso)
      .order("checked_in_at", { ascending: true })
      .limit(2000),
    readPatientVitalsOrThrow(supabase, patientId, { vitalType: "blood_pressure", since: sinceIso, ascending: true, limit: 1000 }),
    supabase
      .from("sleep_log_entries")
      .select("logged_on, duration_hours")
      .eq("patient_id", patientId)
      .gte("logged_on", sinceIso.slice(0, 10))
      .order("logged_on", { ascending: true })
      .limit(400),
  ]);
  if (checkins.error) throw checkins.error;
  if (sleep.error) throw sleep.error;
  return mergeMoodBpSleep(
    checkins.data ?? [],
    bp.map((r) => ({ taken_at: r.taken_at, systolic: r.systolic, diastolic: r.diastolic })),
    (sleep.data ?? []).map((r) => ({ day: r.logged_on, minutes: Math.round(Number(r.duration_hours) * 60) })),
  );
}
