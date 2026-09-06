import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type StiCaseEpisode = Tables<"sti_case_episodes">;

const OPEN_EXCLUDED_STATUSES = ["closed", "declined_care"];

export const openStiCaseEpisodesKey = (patientId: string) => ["sti-case-episodes", "open", patientId];

/** An open episode plus the (null-gated) patient identity and the triggering
 * screening result's own status/summary/date — used by the clinician
 * worklist (spec §47.5). */
export type StiCaseEpisodeWithDetails = StiCaseEpisode & {
  patient: { full_name: string | null; patient_number: string | null } | null;
  screening_result: {
    result_status: Tables<"screening_results">["result_status"];
    result_summary: string | null;
    created_at: string;
  } | null;
};

const CASE_WITH_DETAILS_SELECT =
  "*, patient:profiles!sti_case_episodes_patient_id_fkey(full_name, patient_number), screening_result:screening_results!sti_case_episodes_screening_result_id_fkey(result_status, result_summary, created_at)";

export const orgOpenStiCaseEpisodesKey = ["sti-case-episodes", "org", "open"];

/**
 * Every open (not closed/declined) STI case episode across the caller's org
 * (clinician worklist, spec §47.5) — RLS (is_org_staff) does the org
 * scoping, same shape as useOrgSpecialistReferrals/useOrgCareThreads.
 */
export function useOrgOpenStiCaseEpisodes() {
  return useQuery({
    queryKey: orgOpenStiCaseEpisodesKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("sti_case_episodes")
        .select(CASE_WITH_DETAILS_SELECT)
        .not("status", "in", `(${OPEN_EXCLUDED_STATUSES.join(",")})`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as StiCaseEpisodeWithDetails[];
    },
  });
}

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
