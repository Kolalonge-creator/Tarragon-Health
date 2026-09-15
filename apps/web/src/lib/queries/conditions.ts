import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type PatientCondition = Tables<"patient_conditions">;

/**
 * Patient's structured problem list (spec §76.3 / §1.7,
 * 20260827195615_patient_conditions_problem_list.sql) — the first reader of
 * `patient_conditions` anywhere in the app. Read-only for the patient by
 * design: RLS gives the patient SELECT on their own rows only, only org
 * clinical staff may insert/update/delete (a patient must never edit their
 * own diagnosis) — so there is no mutation hook here, unlike allergies.ts.
 * Ordered by most-recently-identified first so an active, newly-noted
 * condition surfaces above an old, resolved one.
 */
export function useConditions(patientId: string) {
  return useQuery({
    queryKey: ["patient-conditions", patientId],
    queryFn: async (): Promise<PatientCondition[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_conditions")
        .select("*")
        .eq("patient_id", patientId)
        .order("date_identified", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!patientId,
  });
}
