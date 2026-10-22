import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { parsePatientSummaries } from "@/lib/visit-summary/schemas";

export const visitSummaryKeys = {
  mine: (patientId: string | null) => ["visit-summaries", patientId ?? "mine"] as const,
};

/** Only approved summaries of signed, unwithdrawn, unamended notes come back; the database decides, not this code. */
export function useMyVisitSummaries(patientId: string | null = null) {
  return useQuery({
    queryKey: visitSummaryKeys.mine(patientId),
    queryFn: async () => {
      const supabase = createClient();
      // A caregiver passes the person they act for; the database checks the grant (view care plan) and hides protected notes.
      const { data, error } = await supabase.rpc("my_visit_summaries", patientId ? { p_patient: patientId } : {});
      if (error) throw error;
      return parsePatientSummaries(data);
    },
  });
}

export function useSetVisitItemDone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, done }: { itemId: string; done: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("set_visit_summary_item_done", { p_item: itemId, p_done: done });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["visit-summaries"] }),
  });
}

export function useAddVisitItemToTasks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("add_visit_summary_item_to_tasks", { p_item: itemId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["visit-summaries"] }),
  });
}

/** Records that a summary was opened. The database writes one audit row and one event per summary, viewer and day, so calling it again is harmless. */
export async function recordVisitSummaryOpened(summaryId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("record_visit_summary_opened", { p_summary: summaryId });
  if (error) throw error;
}
