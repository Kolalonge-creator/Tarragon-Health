import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type CarePlanReviewPrompt = Tables<"care_plan_review_prompts">;

export type CarePlanReviewPromptWithPatient = CarePlanReviewPrompt & {
  patient: { id: string; full_name: string | null; patient_number: string | null } | null;
};

export const orgCarePlanReviewPromptsKey = ["care-plan-review-prompts", "org"] as const;

/**
 * Org-staff worklist of open "care plan may need review" prompts, raised by
 * upstream structural triggers (abnormal result, missed-medication escalation,
 * new diagnosis, risk-tier change, hospital discharge). RLS
 * (private.is_org_staff) scopes to the caller's organisation; there is no
 * patient-facing read at all — this is clinician-internal.
 */
export function useOrgCarePlanReviewPrompts() {
  return useQuery({
    queryKey: orgCarePlanReviewPromptsKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_plan_review_prompts")
        .select(
          "*, patient:profiles!care_plan_review_prompts_patient_id_fkey(id, full_name, patient_number)",
        )
        .eq("status", "open")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as CarePlanReviewPromptWithPatient[];
    },
  });
}

/**
 * Resolve a prompt as reviewed or dismissed. actioned_by/actioned_at are
 * stamped server-side by private.stamp_care_plan_review_prompt_action from
 * the caller's own clinical_staff row — never sent from here. This never
 * writes to care_plans; any actual plan change happens separately, on the
 * patient's own clinician page.
 */
export function useResolveCarePlanReviewPrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      promptId,
      status,
    }: {
      promptId: string;
      status: "actioned" | "dismissed";
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("care_plan_review_prompts")
        .update({ status })
        .eq("id", promptId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orgCarePlanReviewPromptsKey });
    },
  });
}
