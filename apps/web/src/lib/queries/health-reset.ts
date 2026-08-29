import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@tarragon/shared";

/**
 * The 90-Day Health Reset — a real, tracked version of the "INCLUDED on every
 * plan" pricing-page promise. Progress is computed live from data the
 * platform already has (see 20260730120518_health_reset_90_day.sql):
 * derived read-model, no invented progress, same discipline as
 * patient_timeline / patient_care_gaps.
 */
export type HealthResetProgress =
  Database["public"]["Functions"]["patient_health_reset_progress"]["Returns"][number];

const progressKey = (patientId: string) => ["health-reset-progress", patientId] as const;

/** The caller's own reset — day count, milestones, completion, trial claim state. */
export function usePatientHealthResetProgress(patientId: string) {
  return useQuery({
    queryKey: progressKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("patient_health_reset_progress");
      if (error) throw error;
      return (data?.[0] ?? null) as HealthResetProgress | null;
    },
    enabled: !!patientId,
  });
}

/**
 * Claims the milestone 30-day Care Pass trial once the reset is
 * complete. Server-side gated (completion + not-already-claimed +
 * not-already-on-a-paid-plan) — this is a thin wrapper, all the real
 * enforcement is in claim_health_reset_trial().
 */
export function useClaimHealthResetTrial(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("claim_health_reset_trial");
      if (error) throw error;
      return data as { subscription_id: string; current_period_end: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: progressKey(patientId) });
    },
  });
}
