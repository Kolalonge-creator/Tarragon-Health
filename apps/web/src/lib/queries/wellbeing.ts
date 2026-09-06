"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type WellbeingCheckin = Tables<"wellbeing_checkins">;
export type WellbeingCheckinPreference = Tables<"wellbeing_checkin_preferences">;

export const wellbeingCheckinsKey = (patientId: string) => ["wellbeing-checkins", patientId] as const;

/** Most recent check-in only — powers the Mood/Stress/Sleep dashboard tiles
 * (§46.2) and the "Wellbeing check: Due" state. */
export function useLatestWellbeingCheckin(patientId: string) {
  return useQuery({
    queryKey: wellbeingCheckinsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("wellbeing_checkins")
        .select("*")
        .eq("patient_id", patientId)
        .order("checked_in_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as WellbeingCheckin | null;
    },
    enabled: !!patientId,
  });
}

export const wellbeingPreferenceKey = (patientId: string) =>
  ["wellbeing-checkin-preference", patientId] as const;

/** Defaults to a 7-day reminder cadence when the patient hasn't set one yet
 * — §46.13 "the patient controls how frequently they track". */
export function useWellbeingCheckinPreference(patientId: string) {
  return useQuery({
    queryKey: wellbeingPreferenceKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("wellbeing_checkin_preferences")
        .select("*")
        .eq("patient_id", patientId)
        .maybeSingle();
      if (error) throw error;
      return (data as WellbeingCheckinPreference | null) ?? { reminder_frequency_days: 7 };
    },
    enabled: !!patientId,
  });
}

/**
 * The patient's nearest upcoming pending medication review, if any — one of
 * two sources for the dashboard's "Next review" tile (§46.2), the other
 * being useNextMentalHealthScreeningDue below.
 */
export function useNextMedicationReview(patientId: string) {
  return useQuery({
    queryKey: ["next-medication-review", patientId] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_reviews")
        .select("id, due_date")
        .eq("patient_id", patientId)
        .eq("status", "pending")
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

/**
 * The patient's nearest upcoming mental-health screening due date, if any —
 * rolled forward automatically by private.schedule_next_mental_health_screen
 * after each screen submission, per the governed cadence in
 * mental_health_screening_cadences (§46.4/§46.5).
 */
export function useNextMentalHealthScreeningDue(patientId: string) {
  return useQuery({
    queryKey: ["next-mental-health-screening-due", patientId] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("mental_health_screening_schedules")
        .select("instrument, due_date")
        .eq("patient_id", patientId)
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}
