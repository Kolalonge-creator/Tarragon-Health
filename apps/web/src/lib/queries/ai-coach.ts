import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { sendCoachMessage } from "@/app/(dashboard)/patient/ai-coach-actions";
import type { CoachChatMessage } from "@tarragon/shared";

export function useAiConversation(patientId: string) {
  return useQuery({
    queryKey: ["ai-conversation", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("ai_conversations")
        .select("id, messages")
        .eq("profile_id", patientId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return {
        conversationId: data?.id,
        messages: ((data?.messages as CoachChatMessage[] | null) ?? []),
      };
    },
    enabled: !!patientId,
  });
}

export function useSendCoachMessage(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sendCoachMessage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-conversation", patientId] });
    },
  });
}
