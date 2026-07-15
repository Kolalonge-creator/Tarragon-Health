import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type OutcomeReport = Tables<"outcome_reports">;

function reportsKey(organisationId: string) {
  return ["outcome-reports", organisationId];
}

export function useOutcomeReports(organisationId: string) {
  return useQuery({
    queryKey: reportsKey(organisationId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("outcome_reports")
        .select("*")
        .eq("organisation_id", organisationId)
        .order("period_end", { ascending: false });
      if (error) throw error;
      return data as OutcomeReport[];
    },
    enabled: !!organisationId,
  });
}

export function useTogglePublished(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, published }: { id: string; published: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase.from("outcome_reports").update({ published }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reportsKey(organisationId) });
    },
  });
}
