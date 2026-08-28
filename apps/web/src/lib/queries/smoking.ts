import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type SmokingProfile = Tables<"patient_smoking_profiles">;
export type SmokingCheckIn = Tables<"smoking_check_ins">;

export function useSmokingProfile(patientId: string) {
  return useQuery({
    queryKey: ["smoking-profile", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_smoking_profiles")
        .select("*")
        .eq("patient_id", patientId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

export function useSmokingCheckIns(patientId: string, limit = 30) {
  return useQuery({
    queryKey: ["smoking-check-ins", patientId, limit],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("smoking_check_ins")
        .select("*")
        .eq("patient_id", patientId)
        .order("logged_on", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as SmokingCheckIn[];
    },
    enabled: !!patientId,
  });
}

/** Consecutive smoke-free days counted back from the most recent check-in —
 * the "progress" spec §18.9 asks for, computed from real logged rows, never
 * inferred from the quit_date alone (a patient may relapse and re-quit). */
export function smokeFreeStreak(checkIns: SmokingCheckIn[]): number {
  const sorted = [...checkIns].sort((a, b) => (a.logged_on < b.logged_on ? 1 : -1));
  let streak = 0;
  for (const entry of sorted) {
    if (entry.cigarettes_smoked === 0) streak += 1;
    else break;
  }
  return streak;
}
