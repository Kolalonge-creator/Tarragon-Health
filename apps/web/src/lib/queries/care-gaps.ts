import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import { rankCareGaps, type AttemptResult, type ManualClosureReason } from "@/lib/care-gaps/gap-model";

/**
 * S90: the care gaps a staff member may read. Row level security (private.care_gap_visible) is the whole access rule: a coordinator sees the gaps
 * assigned to them, a clinician sees the gaps of patients they are tied to, and everyone else sees nothing. This hook adds no filter of its own to widen
 * or narrow that, it only asks for the open ones. Writes go through two definer functions, never a table update.
 */
export type CareGap = Tables<"care_gaps">;
export type CareGapAttempt = Tables<"care_gap_attempts">;

export type CareGapWithPeople = CareGap & {
  patient: { full_name: string | null; patient_number: string | null } | null;
  owner: { full_name: string | null } | null;
};

const GAP_SELECT =
  "*, patient:profiles!care_gaps_patient_id_fkey(full_name, patient_number), owner:profiles!care_gaps_owner_id_fkey(full_name)";

export const careGapKeys = {
  open: ["care-gaps", "open"] as const,
  attempts: (gapId: string) => ["care-gaps", "attempts", gapId] as const,
};

export function useOpenCareGaps() {
  return useQuery({
    queryKey: careGapKeys.open,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("care_gaps").select(GAP_SELECT).eq("status", "open");
      if (error) throw error;
      return rankCareGaps((data ?? []) as CareGapWithPeople[]);
    },
  });
}

/** The contact log of one gap, newest first (system sends and staff calls). */
export function useCareGapAttempts(gapId: string, enabled: boolean) {
  return useQuery({
    queryKey: careGapKeys.attempts(gapId),
    enabled,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_gap_attempts")
        .select("id, attempted_at, step, channel, result, note, actor_id, outcome")
        .eq("gap_id", gapId)
        .order("attempted_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useLogCareGapAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { gapId: string; result: AttemptResult; note: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("log_care_gap_attempt", { p_gap: input.gapId, p_result: input.result, p_note: input.note });
      if (error) throw error;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: careGapKeys.open });
      queryClient.invalidateQueries({ queryKey: careGapKeys.attempts(input.gapId) });
    },
  });
}

/** Close as declined, unreachable or wrong. The database refuses `closed` (it needs a recorded outcome) and refuses `unreachable` before enough logged attempts. */
export function useCloseCareGap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { gapId: string; reason: ManualClosureReason; note: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("close_care_gap_manual", { p_gap: input.gapId, p_reason: input.reason, p_note: input.note });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: careGapKeys.open });
      queryClient.invalidateQueries({ queryKey: ["care-outreach", "org"] });
    },
  });
}
