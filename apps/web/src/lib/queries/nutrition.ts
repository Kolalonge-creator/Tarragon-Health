import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type NutritionEntry = Tables<"nutrition_log_entries">;

/** A patient's meal log, newest first. Coaching telemetry — never clinical. */
export function useNutritionEntries(patientId: string, limit = 30) {
  return useQuery({
    queryKey: ["nutrition-entries", patientId, limit],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("nutrition_log_entries")
        .select("*")
        .eq("patient_id", patientId)
        .order("logged_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as NutritionEntry[];
    },
    enabled: !!patientId,
  });
}
