import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@tarragon/shared";

/**
 * The 90-Day Health Reset — a real, tracked version of the "free to every
 * patient" pricing-page promise. Progress is computed live from data the
 * platform already has (see 20260730120518_health_reset_90_day.sql):
 * derived read-model, no invented progress, same discipline as
 * patient_timeline / patient_care_gaps.
 *
 * The milestone "30-day Complete Care trial" claim that used to live here
 * (useClaimHealthResetTrial → claim_health_reset_trial RPC) was removed with
 * the 2026-09-02 retirement of subscription plans — Complete Care no longer
 * exists, so the RPC targeted a plan the platform no longer sells. The app is
 * simply free now; there is nothing to trial (see FREE_TRIAL_INTRO in
 * app/(marketing)/_content/pricing.ts).
 */
export type HealthResetProgress =
  Database["public"]["Functions"]["patient_health_reset_progress"]["Returns"][number];

const progressKey = (patientId: string) => ["health-reset-progress", patientId] as const;

/** The caller's own reset — day count, milestones, completion. */
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
