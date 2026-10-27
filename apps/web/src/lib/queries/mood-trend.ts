"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { fetchMoodTrendDays } from "@/lib/queries/mood-trend-data";
import type { MoodTrendDay } from "@tarragon/shared";

const WINDOW_DAYS = 30;

export const moodTrendKey = (patientId: string) => ["mood-beside-readings", patientId] as const;

/**
 * Mood beside blood pressure and sleep (function 10.1): the patient's own check-ins, blood pressure readings and sleep log merged per Lagos
 * day. It describes what happened on the same day and never says one caused the other; mood is never fed into any score.
 */
export function useMoodBesideReadings(patientId: string) {
  return useQuery({
    queryKey: moodTrendKey(patientId),
    queryFn: async (): Promise<MoodTrendDay[]> => fetchMoodTrendDays(createClient(), patientId, WINDOW_DAYS),
    enabled: !!patientId,
  });
}
