import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Enums, Tables } from "@tarragon/shared";

export type CarePlanVersion = Tables<"care_plan_versions">;

export type CarePlan = Tables<"care_plans"> & {
  assigned_clinician: { full_name: string | null } | null;
  /** False only when this condition's scheduled-review cadence is gated
   * behind Complete Care (multi_condition_review) — see
   * private.ensure_medication_review(). A plan that has simply never had a
   * review row can't otherwise happen: the scheduling trigger runs
   * synchronously in the same transaction that activates the care plan. */
  hasScheduledReview: boolean;
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

      const planIds = (plans ?? []).map((p) => p.id);
      const { data: reviews, error: reviewsError } =
        planIds.length > 0
          ? await supabase.from("medication_reviews").select("care_plan_id").in("care_plan_id", planIds)
          : { data: [], error: null };
      if (reviewsError) throw reviewsError;
      const planIdsWithReview = new Set((reviews ?? []).map((r) => r.care_plan_id));

      const nameByPlanId = new Map(
        (names ?? []).map((n) => [n.care_plan_id, n.clinician_full_name])
      );
      return (plans ?? []).map((plan) => ({
        ...plan,
        assigned_clinician: plan.assigned_clinician_id
          ? { full_name: nameByPlanId.get(plan.id) ?? null }
          : null,
        hasScheduledReview: planIdsWithReview.has(plan.id),
      })) as CarePlan[];
    },
    enabled: !!patientId,
  });
}

/**
 * Every one of a patient's care plans, any status — the clinician
 * management view (unlike useCarePlans, which deliberately shows only
 * 'active' plans for the patient-facing display) needs to see and change a
 * plan that's already paused/completed/etc., not just the live ones.
 */
export function useAllCarePlans(patientId: string) {
  return useQuery({
    queryKey: ["care-plans", "all", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_plans")
        .select("id, condition, status, notes")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

/**
 * §3.18: "Old versions remain accessible." Every clinically meaningful
 * change to a care plan (condition, status, target_ranges, notes,
 * assigned_clinician_id) snapshots the row it's about to overwrite into
 * care_plan_versions — this reads that history, newest first.
 */
export function useCarePlanVersions(carePlanId: string | null) {
  return useQuery({
    queryKey: ["care-plans", "versions", carePlanId ?? ""],
    enabled: !!carePlanId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_plan_versions")
        .select("*")
        .eq("care_plan_id", carePlanId as string)
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return data as CarePlanVersion[];
    },
  });
}

/**
 * Moves a plan into one of §3.19's programme-completion states — ongoing
 * ('active', unchanged), completed, paused, transferred, declined, or
 * discharged. "Completed does not necessarily mean cured; it means the
 * programme's defined episode has ended." Every prior state is preserved
 * automatically in care_plan_versions (see that migration) the instant this
 * write lands, so nothing about the plan's history is lost by changing its
 * status here.
 */
export function useUpdateCarePlanStatus(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      carePlanId,
      status,
    }: {
      carePlanId: string;
      status: Enums<"care_plan_status">;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("care_plans").update({ status }).eq("id", carePlanId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["care-plans", patientId] });
      queryClient.invalidateQueries({ queryKey: ["care-plans", "all", patientId] });
    },
  });
}
