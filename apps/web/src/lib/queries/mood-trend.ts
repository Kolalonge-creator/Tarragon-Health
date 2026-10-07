"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { readPatientVitalsOrThrow } from "@/lib/clinical/vitals-audited";
import { mergeMoodBpSleep, type MoodTrendDay } from "@tarragon/shared";

const WINDOW_DAYS = 30;

export const moodTrendKey = (patientId: string) => ["mood-beside-readings", patientId] as const;

/**
 * Mood beside blood pressure and sleep (function 10.1): the patient's own check-ins, blood pressure readings and sleep log merged per
 * Lagos day. It describes what happened on the same day and never says one caused the other; mood is never fed into any score.
 */
export function useMoodBesideReadings(patientId: string) {
  return useQuery({
    queryKey: moodTrendKey(patientId),
    queryFn: async (): Promise<MoodTrendDay[]> => {
      const supabase = createClient();
      const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const sinceIso = since.toISOString();
      const [checkins, bp, sleep] = await Promise.all([
        supabase
          .from("wellbeing_checkins")
          .select("checked_in_at, mood_score, stress_score, tags")
          .eq("patient_id", patientId)
          .gte("checked_in_at", sinceIso)
          .order("checked_in_at", { ascending: true }),
        readPatientVitalsOrThrow(supabase, patientId, { vitalType: "blood_pressure", since: sinceIso, ascending: true, limit: 200 }),
        supabase
          .from("sleep_log_entries")
          .select("logged_on, duration_hours")
          .eq("patient_id", patientId)
          .gte("logged_on", since.toISOString().slice(0, 10))
          .order("logged_on", { ascending: true }),
      ]);
      if (checkins.error) throw checkins.error;
      if (sleep.error) throw sleep.error;
      return mergeMoodBpSleep(
        checkins.data ?? [],
        bp.map((r) => ({ taken_at: r.taken_at, systolic: r.systolic, diastolic: r.diastolic })),
        (sleep.data ?? []).map((r) => ({ day: r.logged_on, minutes: Math.round(Number(r.duration_hours) * 60) })),
      );
    },
    enabled: !!patientId,
  });
}
