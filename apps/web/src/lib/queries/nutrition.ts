import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type NutritionEntry = Tables<"nutrition_log_entries">;
export type NutritionReferral = Tables<"nutrition_referrals">;
export type NutritionMealPlanRow = Tables<"nutrition_meal_plans">;

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

/** The patient's most recent nutrition-support request, if any (spec 19.11's
 * pathway: requested -> scheduled -> consultation complete -> plan issued). */
export function useNutritionReferral(patientId: string) {
  return useQuery({
    queryKey: ["nutrition-referral", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("nutrition_referrals")
        .select("*")
        .eq("patient_id", patientId)
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as NutritionReferral | null;
    },
    enabled: !!patientId,
  });
}

/** The patient's most recently generated 7-day meal plan, if any (spec
 * 19.8). Regenerating inserts a new row rather than editing this one. */
export function useMealPlan(patientId: string) {
  return useQuery({
    queryKey: ["nutrition-meal-plan", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("nutrition_meal_plans")
        .select("*")
        .eq("patient_id", patientId)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as NutritionMealPlanRow | null;
    },
    enabled: !!patientId,
  });
}
