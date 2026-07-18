import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ConsentVersion = Tables<"consent_versions">;
export type PatientConsent = Tables<"patient_consents">;

/** The consent text every new patient must accept, one row per consent type. */
export function useCurrentConsentVersions() {
  return useQuery({
    queryKey: ["consent-versions", "current"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("consent_versions")
        .select("*")
        .eq("is_current", true)
        .order("consent_type", { ascending: true });
      if (error) throw error;
      return data as ConsentVersion[];
    },
  });
}

/** The caller's own recorded consents — used to gate the onboarding step. */
export function usePatientConsents(patientId: string) {
  return useQuery({
    queryKey: ["patient-consents", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_consents")
        .select("*")
        .eq("patient_id", patientId);
      if (error) throw error;
      return data as PatientConsent[];
    },
    enabled: !!patientId,
  });
}
