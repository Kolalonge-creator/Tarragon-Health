import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { screeningSchedulesKey } from "@/lib/queries/screening";

/** T2 Phase 3: the baseline assessment and the personal plan, plus moving a test later. All through audited database functions. */

export type BaselineItem = { code: string; required: boolean; done: boolean };
export type PlanItem = {
  schedule_id: string;
  code: string;
  name: string;
  due_date: string;
  status: string;
  sensitive: boolean;
  needs_choice: boolean;
  deferred: boolean;
  defer_count: number;
  original_due_date: string | null;
  reason_code: string | null;
};
export type MyPreventiveBaseline = {
  eligible: boolean;
  baseline: { id: string; state: "submitted" | "authorised" | "adjusted"; submitted_at: string; reviewed_at: string | null; review_note: string | null } | null;
  items: BaselineItem[];
  plan: PlanItem[];
};

export function parseMyPreventiveBaseline(data: unknown): MyPreventiveBaseline | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.eligible !== "boolean" || !Array.isArray(d.items) || !Array.isArray(d.plan)) return null;
  return d as unknown as MyPreventiveBaseline;
}

export const myPreventiveBaselineKey = (patientId: string) => ["preventive-baseline", patientId] as const;

export function useMyPreventiveBaseline(patientId: string) {
  return useQuery({
    queryKey: myPreventiveBaselineKey(patientId),
    queryFn: async () => {
      const { data, error } = await createClient().rpc("my_preventive_baseline");
      if (error) throw error;
      return parseMyPreventiveBaseline(data);
    },
  });
}

/** Turns the database's refusal into a sentence for the patient. */
export function baselineSubmitError(message: string): string {
  if (message.includes("members_only")) return "The doctor-reviewed plan is part of Membership.";
  if (message.includes("baseline_incomplete")) return "A few items are still missing. Add them, then send your assessment again.";
  return "We could not send your assessment. Please try again.";
}

export function useSubmitPreventiveBaseline(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await createClient().rpc("submit_my_preventive_baseline");
      if (error) throw new Error(baselineSubmitError(error.message));
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: myPreventiveBaselineKey(patientId) });
      queryClient.invalidateQueries({ queryKey: screeningSchedulesKey(patientId) });
    },
  });
}

export function deferError(message: string): string {
  if (message.includes("defer_limit_reached")) return "You have moved this test the most times allowed. Your care team can move it for you.";
  if (message.includes("new_date_out_of_range")) return "Choose a later date, within the allowed range.";
  if (message.includes("note_required")) return "Tell us a little about the reason.";
  if (message.includes("not_open")) return "This test is no longer open.";
  return "We could not move this test. Please try again.";
}

export function useDeferScreening(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { schedule_id: string; new_due: string; reason_code: string; note?: string }) => {
      const { error } = await createClient().rpc("defer_screening", {
        p_schedule: input.schedule_id,
        p_new_due: input.new_due,
        p_reason_code: input.reason_code,
        p_note: input.note || undefined,
      });
      if (error) throw new Error(deferError(error.message));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: screeningSchedulesKey(patientId) });
      queryClient.invalidateQueries({ queryKey: myPreventiveBaselineKey(patientId) });
    },
  });
}
