import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type CarePlan = Tables<"care_plans"> & {
  assigned_clinician: { full_name: string | null } | null;
};

/**
 * The clinician's name no longer comes from an embedded `profiles` read —
 * that RLS path was removed (see the clinician_phone_admin_only_visibility
 * migration) because it exposed the clinician's entire profiles row (phone,
 * DOB, HIV/HBV/HCV status, emergency contacts...) for what was only ever a
 * name lookup. `my_care_plan_clinicians()` is a name-only SECURITY DEFINER
 * RPC scoped to the caller's own care plans; results are merged in here.
 */
export function useCarePlans(patientId: string) {
  return useQuery({
    queryKey: ["care-plans", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const [{ data: plans, error: plansError }, { data: names, error: namesError }] =
        await Promise.all([
          supabase
            .from("care_plans")
            .select("*")
            .eq("patient_id", patientId)
            .eq("status", "active")
            .order("created_at", { ascending: false }),
          supabase.rpc("my_care_plan_clinicians"),
        ]);
      if (plansError) throw plansError;
      if (namesError) throw namesError;

      const nameByPlanId = new Map(
        (names ?? []).map((n) => [n.care_plan_id, n.clinician_full_name])
      );
      return (plans ?? []).map((plan) => ({
        ...plan,
        assigned_clinician: plan.assigned_clinician_id
          ? { full_name: nameByPlanId.get(plan.id) ?? null }
          : null,
      })) as CarePlan[];
    },
    enabled: !!patientId,
  });
}
