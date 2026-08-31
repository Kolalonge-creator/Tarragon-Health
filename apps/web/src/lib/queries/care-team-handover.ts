import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type CareTeamHandover = Tables<"care_team_handovers"> & {
  from_profile: { full_name: string | null } | null;
  to_profile: { full_name: string | null } | null;
};

function handoversKey(patientId: string) {
  return ["care-team-handovers", patientId];
}

/** Care Team / Provider Workspace §5.15 — every reassignment of who holds
 * clinician_id/care_coordinator_id for this patient, whether done through
 * hand_over_care (carries a note) or a plain CareTeamForm upsert (logged
 * automatically, note null). See 20260827210136_care_team_handover_audit.sql. */
export function useCareTeamHandovers(patientId: string) {
  return useQuery({
    queryKey: handoversKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_team_handovers")
        .select(
          "*, from_profile:profiles!care_team_handovers_from_profile_id_fkey(full_name), to_profile:profiles!care_team_handovers_to_profile_id_fkey(full_name)",
        )
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CareTeamHandover[];
    },
    enabled: !!patientId,
  });
}

export function useHandOverCare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      patientId,
      role,
      newProfileId,
      note,
    }: {
      patientId: string;
      role: "clinician" | "care_coordinator";
      newProfileId: string;
      note: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("hand_over_care", {
        p_patient_id: patientId,
        p_role: role,
        p_new_profile_id: newProfileId,
        p_note: note,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: handoversKey(variables.patientId) });
    },
  });
}
