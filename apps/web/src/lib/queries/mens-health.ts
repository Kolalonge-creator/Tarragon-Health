"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type EdAssessment = Tables<"erectile_dysfunction_assessments">;
export type ProstateSymptomAssessment = Tables<"prostate_symptom_assessments">;
export type MaleFertilityAssessment = Tables<"male_fertility_assessments">;

export const mensHealthKey = (patientId: string) => ["mens-health-assessments", patientId];

/**
 * The patient's most recent row from each Men's Health self-assessment
 * (§45.5/§45.6/§45.7), append-only history like mental_health_screens — RLS
 * limits this to the caller's own rows (or org staff viewing a patient).
 */
export function useLatestMensHealthAssessments(patientId: string) {
  return useQuery({
    queryKey: mensHealthKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const [ed, prostate, fertility] = await Promise.all([
        supabase
          .from("erectile_dysfunction_assessments")
          .select("*")
          .eq("patient_id", patientId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("prostate_symptom_assessments")
          .select("*")
          .eq("patient_id", patientId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("male_fertility_assessments")
          .select("*")
          .eq("patient_id", patientId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (ed.error) throw ed.error;
      if (prostate.error) throw prostate.error;
      if (fertility.error) throw fertility.error;
      return {
        ed: ed.data as EdAssessment | null,
        prostate: prostate.data as ProstateSymptomAssessment | null,
        fertility: fertility.data as MaleFertilityAssessment | null,
      };
    },
    enabled: !!patientId,
  });
}
