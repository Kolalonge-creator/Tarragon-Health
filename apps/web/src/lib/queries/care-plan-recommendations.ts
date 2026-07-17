import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type CarePlanRecommendation = Tables<"care_plan_recommendations">;

export type CarePlanRecommendationWithPatient = CarePlanRecommendation & {
  patient: { full_name: string | null; patient_number: string | null } | null;
};

export const carePlanRecommendationsKey = (patientId: string) =>
  ["care-plan-recommendations", patientId] as const;

export const orgCarePlanRecommendationsKey = ["care-plan-recommendations", "org"] as const;

/**
 * Care-team worklist of open (proposed) recommendations across the org.
 * RLS (private.is_org_staff) scopes to the caller's organisation.
 */
export function useOrgCareProgrammeRecommendations() {
  return useQuery({
    queryKey: orgCarePlanRecommendationsKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_plan_recommendations")
        .select(
          "*, patient:profiles!care_plan_recommendations_patient_id_fkey(full_name, patient_number)",
        )
        .eq("status", "proposed")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as CarePlanRecommendationWithPatient[];
    },
  });
}

/**
 * The patient's own *open* (proposed) care-programme suggestions. These are
 * suggestions pending the care team's review — never presented as a
 * doctor-signed plan.
 */
export function useCareProgrammeRecommendations(patientId: string) {
  return useQuery({
    queryKey: carePlanRecommendationsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_plan_recommendations")
        .select("*")
        .eq("patient_id", patientId)
        .eq("status", "proposed")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CarePlanRecommendation[];
    },
    enabled: !!patientId,
  });
}
