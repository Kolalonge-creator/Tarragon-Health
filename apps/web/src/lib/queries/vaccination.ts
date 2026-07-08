import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { LogVaccinationInput } from "@/lib/validation/vaccination";

export type VaccinationCatalogEntry = Tables<"vaccination_catalog">;
export type VaccinationRecord = Tables<"vaccination_records">;

function vaccinationRecordsKey(patientId: string) {
  return ["vaccination-records", patientId];
}

/** Global reference catalogue — same for every patient, no patientId scoping. */
export function useVaccinationCatalog() {
  return useQuery({
    queryKey: ["vaccination-catalog"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("vaccination_catalog")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as VaccinationCatalogEntry[];
    },
  });
}

export function useVaccinationRecords(patientId: string) {
  return useQuery({
    queryKey: vaccinationRecordsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("vaccination_records")
        .select("*")
        .eq("profile_id", patientId)
        .order("date_administered", { ascending: true });
      if (error) throw error;
      return data as VaccinationRecord[];
    },
    enabled: !!patientId,
  });
}

/**
 * Self-reported entries are explicitly in scope (spec §3.5) — this writes
 * through the patient's own RLS-scoped session, same as vitals_readings,
 * since a vaccination record is the patient's own reported history, not a
 * value the app computes on their behalf.
 */
export function useLogVaccination() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: LogVaccinationInput & { patientId: string }) => {
      const supabase = createClient();
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", input.patientId)
        .single();
      if (profileError) throw profileError;
      if (!profile?.organisation_id) {
        throw new Error("This patient has no organisation on file");
      }

      const { patientId, provider, ...rest } = input;
      const { error } = await supabase.from("vaccination_records").insert({
        ...rest,
        profile_id: patientId,
        organisation_id: profile.organisation_id,
        provider: provider || null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: vaccinationRecordsKey(variables.patientId) });
    },
  });
}
