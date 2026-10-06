import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  parseAllowance,
  parseWrittenQuestions,
  type WrittenQuestionCategory,
} from "@/lib/written-questions/types";
import type { WrittenQuestionGateway } from "@/lib/written-questions/submit";
import { sendWrittenQuestion, type SubmitInput } from "@/lib/written-questions/submit";

export const PHOTO_BUCKET = "async-consult-attachments";

export const writtenQuestionKeys = {
  list: ["written-questions", "mine"] as const,
  allowance: ["written-questions", "allowance"] as const,
};

/** Patients cannot read the table any more; everything goes through the audited RPCs. */
export function useMyWrittenQuestions() {
  return useQuery({
    queryKey: writtenQuestionKeys.list,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("my_written_questions");
      if (error) throw error;
      return parseWrittenQuestions(data);
    },
  });
}

export function useWrittenQuestionAllowance() {
  return useQuery({
    queryKey: writtenQuestionKeys.allowance,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("my_written_question_allowance");
      if (error) throw error;
      return parseAllowance(data);
    },
  });
}

/** Storage answers 409 / "already exists" when the first attempt's upload did land. That is done, not a failure. */
function isAlreadyThere(error: { message?: string; statusCode?: string | number }): boolean {
  return String(error.statusCode ?? "") === "409" || /already exists/i.test(error.message ?? "");
}

function browserGateway(): WrittenQuestionGateway {
  const supabase = createClient();
  return {
    async submitQuestion({ category, question, durationNote, clientId }) {
      const { data, error } = await supabase.rpc("submit_written_question", {
        p_category: category satisfies WrittenQuestionCategory,
        p_question: question,
        p_duration_note: durationNote ?? undefined,
        p_client_id: clientId,
      });
      return { id: typeof data === "string" ? data : null, error: error?.message ?? null };
    },
    async uploadPhoto(consultId, { id, blob }) {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) return { path: null, error: "not signed in" };
      // The photo's own stable id, not a fresh one: a retry after a lost reply writes the same path.
      const path = `${userId}/${consultId}/${id}.jpg`;
      const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, {
        contentType: "image/jpeg",
        upsert: false,
      });
      if (error && isAlreadyThere(error)) return { path, error: null };
      return { path: error ? null : path, error: error?.message ?? null };
    },
    async attachPhoto({ consultId, path, mime, bytes }) {
      const { error } = await supabase.rpc("attach_written_question_photo", {
        p_consult: consultId,
        p_path: path,
        p_mime: mime,
        p_bytes: bytes,
      });
      return { error: error?.message ?? null };
    },
  };
}

export function useSendWrittenQuestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitInput) => sendWrittenQuestion(browserGateway(), input),
    onSuccess: (outcome) => {
      if (outcome.kind === "sent") {
        queryClient.invalidateQueries({ queryKey: writtenQuestionKeys.list });
        queryClient.invalidateQueries({ queryKey: writtenQuestionKeys.allowance });
      }
    },
  });
}

export function usePostWrittenQuestionMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ consultId, body }: { consultId: string; body: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("post_written_question_message", { p_consult: consultId, p_body: body });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: writtenQuestionKeys.list }),
  });
}
