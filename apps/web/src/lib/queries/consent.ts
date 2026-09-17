import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ConsentVersion = Tables<"consent_versions">;
export type PatientConsent = Tables<"patient_consents">;

/** Shared with ConsentStatusPanel and ConsentStep so a consent_type never renders under two different names. */
export const CONSENT_TYPE_LABEL: Record<string, string> = {
  data_processing: "Data processing",
  telehealth: "Telehealth",
  terms_of_service: "Terms of service",
  device_data: "Device & wearable data",
  marketing: "Marketing communications",
  research: "Research use",
  wearable_device_data: "Wearable device data",
};

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

/**
 * Which of the patient's current consent types have no matching
 * patient_consents row for the CURRENT version — i.e. never accepted, or
 * accepted an older version that a subsequent consent_versions bump has
 * superseded. Shared by ConsentStatusPanel (the review UI) and
 * ConsentNudgeBanner (the dashboard-wide nudge) so the two can never
 * disagree about what counts as outstanding.
 */
export function useOutstandingConsentTypes(patientId: string) {
  const currentVersions = useCurrentConsentVersions();
  const patientConsents = usePatientConsents(patientId);

  const versions = currentVersions.data ?? [];
  const accepted = patientConsents.data ?? [];

  const outstanding = versions.filter(
    (version) =>
      !accepted.some(
        (consent) => consent.consent_type === version.consent_type && consent.version === version.version
      )
  );

  return {
    versions,
    accepted,
    outstanding,
    isLoading: currentVersions.isLoading || patientConsents.isLoading,
  };
}
