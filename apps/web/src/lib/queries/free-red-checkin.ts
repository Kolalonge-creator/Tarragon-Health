import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/** Two-tier (CMO 2026-10-08): the follow-up after a red event on the Free plan. The answer is stored for the patient and is never shown to a doctor. */
export const FREE_RED_CHECKIN_ANSWERS = ["got_care", "going_now", "not_yet"] as const;
export type FreeRedCheckinAnswer = (typeof FREE_RED_CHECKIN_ANSWERS)[number];

export const freeRedCheckinKey = (patientId: string) => ["free-red-checkin", patientId];

/** The newest check-in that is due and unanswered for the signed-in patient, or null. */
export function useFreeRedCheckin(patientId: string) {
  return useQuery({
    queryKey: freeRedCheckinKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("my_free_red_checkin");
      if (error) throw error;
      return data?.[0] ?? null;
    },
    enabled: !!patientId,
    refetchInterval: 60_000,
  });
}

export function useAnswerFreeRedCheckin(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; answer: FreeRedCheckinAnswer }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("answer_free_red_checkin", { p_id: input.id, p_answer: input.answer });
      if (error) throw error;
      return input.answer;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: freeRedCheckinKey(patientId) }),
  });
}
