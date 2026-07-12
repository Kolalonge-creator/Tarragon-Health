import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ClinicalStaff = Tables<"clinical_staff">;

/** Active clinicians in the caller's org (RLS-scoped) — populates the care-team assignment select. */
export function useOrgClinicians() {
  return useQuery({
    queryKey: ["clinical-staff", "clinicians"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinical_staff")
        .select("*")
        .eq("role", "clinician")
        .eq("active", true)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return data as ClinicalStaff[];
    },
  });
}

/**
 * Assigns (or reassigns) a patient's care team: the chosen clinician plus
 * whichever clinical_staff row is the org's active Clinical Director — the
 * caller never picks the director directly, since per
 * CLINICAL_TRUST_MODEL_SPEC.md §1 that's a single named role supervising
 * protocols org-wide, not a per-patient choice. One row per patient
 * (upsert on patient_id), assigned_at always reset to now().
 */
export function useAssignCareTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      patientId,
      organisationId,
      clinicianProfileId,
    }: {
      patientId: string;
      organisationId: string;
      clinicianProfileId: string;
    }) => {
      const supabase = createClient();

      const { data: director } = await supabase
        .from("clinical_staff")
        .select("profile_id")
        .eq("organisation_id", organisationId)
        .eq("role", "clinical_director")
        .eq("active", true)
        .not("profile_id", "is", null)
        .maybeSingle();

      const { error } = await supabase.from("care_team_assignment").upsert(
        {
          organisation_id: organisationId,
          patient_id: patientId,
          clinician_id: clinicianProfileId,
          clinical_director_id: director?.profile_id ?? null,
          assigned_at: new Date().toISOString(),
        },
        { onConflict: "patient_id" }
      );
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["care-team", variables.patientId] });
    },
  });
}
