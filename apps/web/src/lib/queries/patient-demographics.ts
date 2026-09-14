import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { ageFromDateOfBirth } from "@/lib/rules/biological-age";

/**
 * The patient's chronological age, derived from profiles.date_of_birth.
 * RLS-scoped by patientId like health-score.ts's hooks — works when a
 * caregiver is acting for a dependent, not just for the signed-in user's
 * own record. Null when date_of_birth isn't on file yet (never inferred).
 */
export function usePatientChronologicalAge(patientId: string) {
  return useQuery({
    queryKey: ["patient-chronological-age", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("profiles")
        .select("date_of_birth")
        .eq("id", patientId)
        .maybeSingle();
      if (error) throw error;
      if (!data?.date_of_birth) return null;
      return ageFromDateOfBirth(data.date_of_birth);
    },
    enabled: !!patientId,
  });
}
