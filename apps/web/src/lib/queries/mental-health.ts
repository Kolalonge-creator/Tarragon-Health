"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type MentalHealthScreen = Tables<"mental_health_screens">;

export const mentalHealthKey = (patientId: string) => ["mental-health-screens", patientId];

/**
 * The patient's most recent screen per instrument (AHC pathway §11). RLS
 * limits this to the caller's own rows (or org staff viewing a patient).
 */
export function useLatestMentalHealthScreens(patientId: string) {
  return useQuery({
    queryKey: mentalHealthKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("mental_health_screens")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const latest: Partial<Record<string, MentalHealthScreen>> = {};
      for (const row of data ?? []) {
        if (!(row.instrument in latest)) latest[row.instrument] = row;
      }
      return latest;
    },
  });
}
