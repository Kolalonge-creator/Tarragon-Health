import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type StiCaseEpisode = Tables<"sti_case_episodes">;

const OPEN_EXCLUDED_STATUSES = ["closed", "declined_care"];

export const openStiCaseEpisodesKey = (patientId: string) => ["sti-case-episodes", "open", patientId];

/**
 * The patient's own open (not closed/declined) curable-STI case episodes,
 * newest first (spec §47.5) — result received through treatment/follow-up.
 * Confidential-by-construction table, patient-self or org staff only (see
 * migration 20260829090200); no profile_access/sponsor visibility.
 */
export function useOpenStiCaseEpisodes(patientId: string) {
  return useQuery({
    queryKey: openStiCaseEpisodesKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("sti_case_episodes")
        .select("*")
        .eq("patient_id", patientId)
        .not("status", "in", `(${OPEN_EXCLUDED_STATUSES.join(",")})`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as StiCaseEpisode[];
    },
    enabled: !!patientId,
  });
}
