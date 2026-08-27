import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type PatientCareGap = Tables<"patient_care_gaps">;

/**
 * A single patient's own open care gaps (spec §2.13's "Care gaps: N" line
 * on the clinician risk view) — distinct from lib/care-gaps/load-care-gaps.ts,
 * which is the small-cell-suppressed COHORT count for the employer/HMO
 * aggregate dashboard (I9). Here there's no suppression concern: this is a
 * clinician looking at one patient in their own org, the same RLS-gated
 * per-patient access every other clinician query on this page already has.
 * patient_care_gaps is `security_invoker = true`, so this only ever returns
 * what the caller's own RLS already allows.
 */
export function usePatientCareGaps(patientId: string) {
  return useQuery({
    queryKey: ["patient-care-gaps", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_care_gaps")
        .select("*")
        .eq("patient_id", patientId)
        .order("opened_at", { ascending: true });
      if (error) throw error;
      return data as PatientCareGap[];
    },
    enabled: !!patientId,
  });
}
