import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Enums, Tables } from "@tarragon/shared";

export type ReproductiveHealthProfile = Tables<"reproductive_health_profiles">;
export type ReproductiveLifeStage = Enums<"reproductive_life_stage">;

function key(patientId: string) {
  return ["reproductive-health-profile", patientId];
}

export function useReproductiveHealthProfile(patientId: string) {
  return useQuery({
    queryKey: key(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("reproductive_health_profiles")
        .select("*")
        .eq("patient_id", patientId)
        .maybeSingle();
      if (error) throw error;
      return data as ReproductiveHealthProfile | null;
    },
    enabled: !!patientId,
  });
}

export interface SaveReproductiveHealthInput {
  patientId: string;
  organisationId: string;
  life_stage: ReproductiveLifeStage;
  last_period_date: string | null;
  average_cycle_length_days: number | null;
}

/** Upserts the caller's own reproductive_health_profiles row (or a managed
 * dependent's, via profile_access — same RLS shape as the vaccination
 * tables). One row per patient (unique on patient_id). */
export function useSaveReproductiveHealthProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveReproductiveHealthInput) => {
      const supabase = createClient();
      const { error } = await supabase.from("reproductive_health_profiles").upsert(
        {
          patient_id: input.patientId,
          organisation_id: input.organisationId,
          life_stage: input.life_stage,
          last_period_date: input.last_period_date,
          average_cycle_length_days: input.average_cycle_length_days,
        },
        { onConflict: "patient_id" }
      );
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: key(variables.patientId) });
    },
  });
}

export interface ReproductiveHealthAnalytics {
  generated_at: string;
  min_cohort_size: number;
  reproductive_health_profiles: {
    reportable: boolean;
    total: number | null;
    by_life_stage: Partial<Record<ReproductiveLifeStage, number>>;
  };
  menstrual_cycle_tracking: {
    reportable: boolean;
    patients_tracking: number | null;
    total_cycles_logged: number | null;
    avg_cycle_length_days: number | null;
  };
  symptom_frequency: Record<string, number>;
  mood_frequency: Record<string, number>;
}

/** Superadmin-only, platform-wide aggregate stats for internal research use — every
 * figure is suppressed to null/false below a 10-person floor, never a per-patient row.
 * See the reproductive_health_analytics_rpc migration for the consent/scope decisions. */
export function useReproductiveHealthAnalytics() {
  return useQuery({
    queryKey: ["reproductive-health-analytics"] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("reproductive_health_analytics");
      if (error) throw error;
      return data as unknown as ReproductiveHealthAnalytics;
    },
  });
}
