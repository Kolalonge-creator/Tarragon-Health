import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { respondCaregiverInviteAction } from "@/lib/consultations/actions";
import { parseCaregiverInvites } from "@/lib/consultations/caregivers";

export const caregiverInviteKeys = { mine: ["caregiver-call-invites", "mine"] as const };

/**
 * The signed-in person's own invites to join a call (CGJ). The in-app notice and opening the page are the fast paths; the slow refresh
 * only covers an invite arriving while the page is already open (React Query does not poll a hidden tab).
 */
export function useMyConsultationInvites() {
  return useQuery({
    queryKey: caregiverInviteKeys.mine,
    refetchInterval: 60_000,
    queryFn: async () => {
      // the generated types predate this function, so the call is typed by hand
      const { data, error } = await createClient().rpc("my_consultation_invites" as never);
      if (error) throw new Error("caregiver_invites_failed");
      return parseCaregiverInvites(data);
    },
  });
}

/** One path for answering an invite, the same server action the room page uses. */
export function useAnswerConsultationInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { passId: string; accept: boolean }) => {
      const r = await respondCaregiverInviteAction(input.passId, input.accept);
      if (!r.ok) throw new Error("caregiver_invite_answer_failed");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: caregiverInviteKeys.mine }),
  });
}
