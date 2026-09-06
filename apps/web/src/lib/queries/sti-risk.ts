import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type StiRiskCheck = Tables<"sti_risk_checks">;

export const stiRiskChecksKey = (patientId: string) => ["sti-risk-checks", patientId];

/**
 * The patient's own STI risk/symptom checks, newest first (spec §47.3).
 * Confidential-by-construction table (RLS: patient-self or org staff only,
 * no profile_access/sponsor path — see migration 20260829090100) — no extra
 * scoping needed here beyond patient_id, RLS does the rest.
 */
export function useStiRiskChecks(patientId: string) {
  return useQuery({
    queryKey: stiRiskChecksKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("sti_risk_checks")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as StiRiskCheck[];
    },
    enabled: !!patientId,
  });
}
